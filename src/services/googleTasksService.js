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
  }

  async getTasks() {
    try {
      const response = await this.tasks.tasks.list({
        tasklist: this.taskListId,
        showCompleted: true,
        showDeleted: false,
        maxResults: 100
      });

      console.log('🔍 DEBUG - Raw Google API response:', JSON.stringify(response.data, null, 2));

      return response.data.items?.map(task => this.formatGoogleTask(task)) || [];
    } catch (error) {
      logger.error('Error fetching Google Tasks:', error);
      throw error;
    }
  }

  formatGoogleTask(task) {
    console.log(`🔍 DEBUG formatGoogleTask - Raw Google API response:`, task);
    
    // Google Tasks API returns 'completed' or 'needsAction' in the status field
    const completed = task.status === 'completed';
    
    console.log(`🔍 DEBUG - Status field: "${task.status}"`);
    console.log(`🔍 DEBUG - Calculated completed: ${completed}`);
    
    // Extract Notion ID marker from notes (optional)
    const notionIdMatch = task.notes?.match(/\[Notion ID: ([^\]]+)\]/);
    const notionPageId = notionIdMatch ? notionIdMatch[1] : null;
    
    // Clean notes by removing the Notion ID tag
    const cleanNotes = task.notes ? task.notes.replace(/\[Notion ID: [^\]]+\]/, '').trim() : '';
    
    const formatted = {
      id: task.id,
      title: task.title || '',
      completed: completed, // Use the status-based calculation
      due: task.due ? new Date(task.due).toISOString().split('T')[0] : null,
      notes: cleanNotes,
      notionPageId,
      lastModified: task.updated,
      created: task.updated
    };
    
    console.log(`🔍 DEBUG formatGoogleTask - Final formatted:`, formatted);
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

      // Add Notion page ID in notes for mapping
      if (taskData.notionPageId) {
        task.notes = `${task.notes}\n[Notion ID: ${taskData.notionPageId}]`.trim();
      }

      const response = await this.tasks.tasks.insert({
        tasklist: this.taskListId,
        resource: task
      });

      return this.formatGoogleTask(response.data);
    } catch (error) {
      logger.error('Error creating Google Task:', error);
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

      console.log(`🔍 DEBUG updateTask - Sending to Google:`, resource);

      const resp = await this.tasks.tasks.update({
        tasklist: this.taskListId,
        task: taskId,
        resource
      });

      console.log(`🔍 DEBUG updateTask - Google response:`, resp.data);

      return this.formatGoogleTask(resp.data);
    } catch (error) {
      logger.error('Error updating Google Task:', error);
      throw error;
    }
  }

  async deleteTask(taskId) {
    try {
      await this.tasks.tasks.delete({
        tasklist: this.taskListId,
        task: taskId
      });
      return true;
    } catch (error) {
      logger.error('Error deleting Google Task:', error);
      throw error;
    }
  }
}

module.exports = new GoogleTasksService();
