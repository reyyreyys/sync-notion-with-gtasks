const { google } = require('googleapis');
const config = require('../config');
const logger = require('../utils/logger');

class GoogleTasksService {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );

    this.oauth2Client.setCredentials({
      refresh_token: config.google.refreshToken
    });

    this.tasks = google.tasks({ version: 'v1', auth: this.oauth2Client });
    this.taskListId = config.google.taskListId;

    // Recent window setting (days); can be overridden by ENV (e.g., 7)
    this.recentDays = Number(process.env.RECENT_DAYS || 7);
  }

  // Full, paginated fetch of all tasks (completed + hidden), sorted by updated desc.
  async getTasks() {
    try {
      let pageToken = undefined;
      const allItems = [];
      let page = 0;

      do {
        const response = await this.tasks.tasks.list({
          tasklist: this.taskListId,
          showCompleted: true,
          showDeleted: false,
          showHidden: true, // include hidden completed tasks
          maxResults: 100,
          pageToken
        });

        const items = response.data.items || [];
        allItems.push(...items);

        pageToken = response.data.nextPageToken || undefined;
        page += 1;
        logger.debug('Google tasks page', {
          page,
          pageItems: items.length,
          accumulated: allItems.length,
          hasNext: !!pageToken
        });
      } while (pageToken);

      // Sort by updated desc for predictability
      allItems.sort((a, b) => new Date(b.updated) - new Date(a.updated));

      const formatted = allItems.map(task => this.formatGoogleTask(task));
      logger.debug('Google tasks fetched (all pages)', { count: formatted.length });
      return formatted;
    } catch (error) {
      logger.error('Error fetching Google Tasks', { message: error.message });
      throw error;
    }
  }

  // Faster fetch: last N days by updated OR any active (needsAction) tasks.
  async getTasksRecent(days = this.recentDays) {
    const all = await this.getTasks();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const recentOrActive = all.filter(t => {
      const updatedMs = t.lastModified ? Date.parse(t.lastModified) : 0;
      const isRecent = updatedMs >= cutoff;
      const isActive = !t.completed;
      return isRecent || isActive;
    });
    logger.debug('Google tasks filtered (recent window + active)', {
      days,
      total: all.length,
      returned: recentOrActive.length
    });
    return recentOrActive;
  }

  formatGoogleTask(task) {
    // status: 'completed' | 'needsAction'
    const completed = task.status === 'completed';

    const formatted = {
      id: task.id,
      title: task.title || '',
      completed,
      due: task.due ? new Date(task.due).toISOString().split('T')[0] : null,
      notes: task.notes || '',
      lastModified: task.updated,
      created: task.updated
    };

    logger.debug('Google task formatted', { id: formatted.id, title: formatted.title, completed: formatted.completed });
    return formatted;
  }

  async createTask(taskData) {
    try {
      const task = {
        title: taskData.title,
        notes: taskData.notes || '',
        status: taskData.completed ? 'completed' : 'needsAction'
      };

      if (taskData.due) {
        task.due = new Date(taskData.due).toISOString();
      }

      const response = await this.tasks.tasks.insert({
        tasklist: this.taskListId,
        resource: task
      });

      logger.info('Google task created', { title: taskData.title, completed: taskData.completed });
      return this.formatGoogleTask(response.data);
    } catch (error) {
      logger.error('Error creating Google Task', { message: error.message });
      throw error;
    }
  }

  async updateTask(taskId, updates) {
    try {
      const current = await this.tasks.tasks.get({
        tasklist: this.taskListId,
        task: taskId
      });

      const resource = {
        id: taskId,
        title: updates.title ?? current.data.title,
        notes: updates.notes ?? current.data.notes,
        status: updates.completed !== undefined
          ? (updates.completed ? 'completed' : 'needsAction')
          : current.data.status,
        due: updates.due !== undefined
          ? (updates.due ? new Date(updates.due).toISOString() : null)
          : current.data.due
      };

      const resp = await this.tasks.tasks.update({
        tasklist: this.taskListId,
        task: taskId,
        resource
      });

      logger.info('Google task updated', { id: taskId, fields: Object.keys(updates) });
      return this.formatGoogleTask(resp.data);
    } catch (error) {
      logger.error('Error updating Google Task', { message: error.message, taskId });
      throw error;
    }
  }

  async deleteTask(taskId) {
    try {
      await this.tasks.tasks.delete({
        tasklist: this.taskListId,
        task: taskId
      });
      logger.info('Google task deleted', { id: taskId });
      return true;
    } catch (error) {
      logger.error('Error deleting Google Task', { message: error.message, taskId });
      throw error;
    }
  }
}

module.exports = new GoogleTasksService();
