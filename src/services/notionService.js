const { Client } = require('@notionhq/client');
const config = require('../config');

class NotionService {
  constructor() {
    this.notion = new Client({
      auth: config.notion.token,
      notionVersion: config.notion.apiVersion
    });
    this.databaseId = config.notion.databaseId;
    this.dataSourceId = null;
    this.MAX_RICH_TEXT_LENGTH = 1990;
  }

  async initialize() {
    const database = await this.notion.databases.retrieve({
      database_id: this.databaseId
    });
    
    if (database.data_sources && database.data_sources.length > 0) {
      this.dataSourceId = database.data_sources[0].id;
      console.log(`📊 Using data source: ${database.data_sources[0].name} (${this.dataSourceId})`);
    } else {
      throw new Error('No data sources found in database');
    }
  }

async getTasks() {
  try {
    if (!this.dataSourceId) {
      await this.initialize();
    }

    const response = await this.notion.request({
      path: `data_sources/${this.dataSourceId}/query`,
      method: 'POST',
      body: {
        sorts: [
          {
            property: 'Name',
            direction: 'descending'
          }
        ],
        page_size: 100
      }
    });

    // For each page, get the full page content to read the comments/sub-items
    const tasksWithContent = await Promise.all(
      response.results.map(async (page) => {
        const task = this.formatNotionTask(page);
        // Get the page content to read the comments section
        const comments = await this.getPageComments(page.id);
        task.comments = comments;
        task.notes = comments; // Make both fields available
        return task;
      })
    );

    return tasksWithContent;
  } catch (error) {
    console.error('Error fetching Notion tasks:', error);
    throw error;
  }
}


  async getPageComments(pageId) {
    try {
      // Get the page content (blocks)
      const blocks = await this.notion.blocks.children.list({
        block_id: pageId,
        page_size: 50
      });

      let comments = [];
      
      // Look for to_do blocks (checkboxes) and other text content
      for (const block of blocks.results) {
        if (block.type === 'to_do') {
          const text = block.to_do.rich_text.map(rt => rt.plain_text).join('');
          const checked = block.to_do.checked;
          comments.push(`${checked ? '☑' : '☐'} ${text}`);
        } else if (block.type === 'paragraph') {
          const text = block.paragraph.rich_text.map(rt => rt.plain_text).join('');
          if (text.trim()) {
            comments.push(text);
          }
        } else if (block.type === 'bulleted_list_item') {
          const text = block.bulleted_list_item.rich_text.map(rt => rt.plain_text).join('');
          if (text.trim()) {
            comments.push(`• ${text}`);
          }
        }
      }
      
      return comments.join('\n');
    } catch (error) {
      console.error('Error getting page comments:', error);
      return '';
    }
  }

  async updatePageComments(pageId, commentsText) {
    try {
      // First, get existing blocks
      const blocks = await this.notion.blocks.children.list({
        block_id: pageId,
        page_size: 50
      });

      // Delete existing content blocks (but keep properties)
      for (const block of blocks.results) {
        if (['to_do', 'paragraph', 'bulleted_list_item'].includes(block.type)) {
          await this.notion.blocks.delete({
            block_id: block.id
          });
        }
      }

      // Add new comment blocks
      if (commentsText && commentsText.trim()) {
        const lines = commentsText.split('\n').filter(line => line.trim());
        const newBlocks = [];

        for (const line of lines) {
          if (line.startsWith('☑') || line.startsWith('☐')) {
            // Convert to checkbox
            const checked = line.startsWith('☑');
            const text = line.substring(2).trim();
            newBlocks.push({
              object: 'block',
              type: 'to_do',
              to_do: {
                rich_text: [{
                  type: 'text',
                  text: { content: text }
                }],
                checked: checked
              }
            });
          } else {
            // Convert to paragraph
            newBlocks.push({
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{
                  type: 'text',
                  text: { content: line.trim() }
                }]
              }
            });
          }
        }

        if (newBlocks.length > 0) {
          await this.notion.blocks.children.append({
            block_id: pageId,
            children: newBlocks
          });
        }
      }
    } catch (error) {
      console.error('Error updating page comments:', error);
      throw error;
    }
  }

  async createTask(taskData) {
    try {
      const properties = {
        Name: {
          title: [
            {
              text: {
                content: taskData.title
              }
            }
          ]
        },
        Status: {
          status: {
            name: taskData.completed ? 'Done' : 'To Do'
          }
        }
      };

      // Add due date if provided
      if (taskData.due) {
        properties['Due Date'] = {
          date: {
            start: taskData.due
          }
        };
      }

      console.log(`📝 Creating Notion task with status: "${properties.Status.status.name}"`);

      const response = await this.notion.pages.create({
        parent: {
          type: "database_id",
          database_id: this.databaseId
        },
        properties
      });

      // Add comments/notes as page content
      if (taskData.notes) {
        await this.updatePageComments(response.id, taskData.notes);
      }

      return this.formatNotionTask(response);
    } catch (error) {
      console.error('Error creating Notion task:', error);
      throw error;
    }
  }

  async updateTask(pageId, updates) {
    try {
      const properties = {};

      if (updates.title !== undefined) {
        properties.Name = {
          title: [
            {
              text: {
                content: updates.title
              }
            }
          ]
        };
      }

      if (updates.completed !== undefined) {
        properties.Status = {
          status: {
            name: updates.completed ? 'Done' : 'To Do'
          }
        };
        console.log(`📝 Updating task status to: "${properties.Status.status.name}"`);
      }

      if (updates.due !== undefined) {
        properties['Due Date'] = updates.due ? {
          date: {
            start: updates.due
          }
        } : { date: null };
      }

      // Update page properties
      if (Object.keys(properties).length > 0) {
        await this.notion.pages.update({
          page_id: pageId,
          properties
        });
      }

      // Update comments if provided
      if (updates.notes !== undefined) {
        await this.updatePageComments(pageId, updates.notes);
      }

      // Get updated task
      const updatedPage = await this.notion.pages.retrieve({ page_id: pageId });
      const task = this.formatNotionTask(updatedPage);
      task.comments = await this.getPageComments(pageId);
      
      return task;
    } catch (error) {
      console.error('Error updating Notion task:', error);
      throw error;
    }
  }

        formatNotionTask(page) {
        const properties = page.properties;
        
        return {
            id: page.id,
            title: properties.Name?.title?.[0]?.text?.content || '',
            completed: properties.Status?.status?.name === 'Done',
            due: properties['Due Date']?.date?.start || null,
            notes: '', // This will be populated with comments later
            comments: '', // Add this field
            lastModified: page.last_edited_time,
            created: page.created_time
        };
        }

}

module.exports = new NotionService();
