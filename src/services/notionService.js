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
                    sorts: [{
                        property: 'Name',
                        direction: 'descending'
                    }],
                    page_size: 100
                }
            });

            console.log(`📋 Processing ${response.results.length} tasks with optimized rate limiting...`);

            // OPTIMIZED: Process tasks in batches of 12 with shorter delays
            const tasksWithContent = [];
            const batchSize = 12; // Increased from 5
            
            for (let i = 0; i < response.results.length; i += batchSize) {
                const batch = response.results.slice(i, i + batchSize);
                console.log(`📋 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(response.results.length/batchSize)}`);
                
                const batchTasks = await Promise.all(
                    batch.map(async (page) => {
                        const task = this.formatNotionTask(page);
                        try {
                            // Get comments with retry logic
                            const comments = await this.getPageCommentsWithRetry(page.id);
                            task.comments = comments;
                            task.notes = comments;
                            
                            // Debug log for comment length
                            console.log(`📝 DEBUG: Retrieved ${comments.length} characters of comments for "${task.title}"`);
                            if (comments.length > 100) {
                                console.log(`   Preview: "${comments.substring(0, 100)}..."`);
                            }
                            
                            return task;
                        } catch (error) {
                            console.error(`❌ Failed to get comments for "${task.title}":`, error.message);
                            // Return task without comments instead of failing completely
                            task.comments = '';
                            task.notes = '';
                            return task;
                        }
                    })
                );
                
                tasksWithContent.push(...batchTasks);
                
                // Reduced delay between batches - much faster now
                if (i + batchSize < response.results.length) {
                    await this.delay(350); // Reduced from 1000ms to 350ms
                }
            }

            console.log(`✅ Successfully processed ${tasksWithContent.length} tasks`);
            return tasksWithContent;
        } catch (error) {
            console.error('Error fetching Notion tasks:', error);
            throw error;
        }
    }

    // Add retry logic for getting page comments with optimized delays
    async getPageCommentsWithRetry(pageId, maxRetries = 2) { // Reduced from 3 to 2
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.getPageComments(pageId);
            } catch (error) {
                console.error(`❌ Attempt ${attempt}/${maxRetries} failed for page comments:`, error.message);
                
                if (attempt === maxRetries) {
                    console.error(`❌ All ${maxRetries} attempts failed, returning empty comments`);
                    return ''; // Return empty instead of failing
                }

                // Linear backoff instead of exponential - much faster
                const delay = attempt * 400; // 400ms, 800ms instead of 2s, 4s, 8s
                console.log(`⏳ Waiting ${delay}ms before retry...`);
                await this.delay(delay);
            }
        }
    }

    // Helper method for delays
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // RECURSIVE method to get all page comments including nested content
    async getPageComments(pageId) {
        try {
            return await this.getAllBlocksRecursively(pageId, 0);
        } catch (error) {
            console.error('Error getting page comments:', error);
            return '';
        }
    }

    // Recursive function to get all nested blocks
    async getAllBlocksRecursively(blockId, depth = 0) {
        try {
            // Get blocks for this level
            const blocks = await this.notion.blocks.children.list({
                block_id: blockId,
                page_size: 100
            });

            let comments = [];
            const indent = '  '.repeat(depth); // Indentation for nested items

            // Process each block at this level
            for (const block of blocks.results) {
                let blockText = '';
                
                if (block.type === 'to_do') {
                    const text = block.to_do.rich_text.map(rt => rt.plain_text).join('');
                    const checked = block.to_do.checked;
                    blockText = `${indent}${checked ? '[x]' : '[ ]'} ${text}`;
                } else if (block.type === 'paragraph') {
                    const text = block.paragraph.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) {
                        blockText = `${indent}${text}`;
                    }
                } else if (block.type === 'bulleted_list_item') {
                    const text = block.bulleted_list_item.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) {
                        blockText = `${indent}• ${text}`;
                    }
                } else if (block.type === 'numbered_list_item') {
                    const text = block.numbered_list_item.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) {
                        blockText = `${indent}1. ${text}`;
                    }
                } else if (block.type === 'heading_1') {
                    const text = block.heading_1.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) {
                        blockText = `${indent}# ${text}`;
                    }
                } else if (block.type === 'heading_2') {
                    const text = block.heading_2.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) {
                        blockText = `${indent}## ${text}`;
                    }
                } else if (block.type === 'heading_3') {
                    const text = block.heading_3.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) {
                        blockText = `${indent}### ${text}`;
                    }
                }

                // Add the block text if it exists
                if (blockText) {
                    comments.push(blockText);
                }

                // CRITICAL: Check for nested children recursively
                if (block.has_children) {
                    console.log(`🔍 Found nested content in block: "${blockText.substring(0, 50)}..."`);
                    try {
                        const childComments = await this.getAllBlocksRecursively(block.id, depth + 1);
                        if (childComments.trim()) {
                            comments.push(childComments);
                        }
                    } catch (error) {
                        console.error(`❌ Error getting child blocks for depth ${depth + 1}:`, error.message);
                        // Continue processing other blocks even if one fails
                    }
                }
            }

            return comments.join('\n');
        } catch (error) {
            console.error(`❌ Error getting blocks at depth ${depth}:`, error.message);
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
                if (['to_do', 'paragraph', 'bulleted_list_item', 'numbered_list_item', 'heading_1', 'heading_2', 'heading_3'].includes(block.type)) {
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
                    const trimmedLine = line.trim();
                    
                    if (trimmedLine.startsWith('[x]') || trimmedLine.startsWith('[ ]')) {
                        // Convert to checkbox
                        const checked = trimmedLine.startsWith('[x]');
                        const text = trimmedLine.substring(3).trim();
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
                    } else if (trimmedLine.startsWith('# ')) {
                        // Convert to heading 1
                        const text = trimmedLine.substring(2).trim();
                        newBlocks.push({
                            object: 'block',
                            type: 'heading_1',
                            heading_1: {
                                rich_text: [{
                                    type: 'text',
                                    text: { content: text }
                                }]
                            }
                        });
                    } else if (trimmedLine.startsWith('## ')) {
                        // Convert to heading 2
                        const text = trimmedLine.substring(3).trim();
                        newBlocks.push({
                            object: 'block',
                            type: 'heading_2',
                            heading_2: {
                                rich_text: [{
                                    type: 'text',
                                    text: { content: text }
                                }]
                            }
                        });
                    } else if (trimmedLine.startsWith('• ')) {
                        // Convert to bulleted list
                        const text = trimmedLine.substring(2).trim();
                        newBlocks.push({
                            object: 'block',
                            type: 'bulleted_list_item',
                            bulleted_list_item: {
                                rich_text: [{
                                    type: 'text',
                                    text: { content: text }
                                }]
                            }
                        });
                    } else if (trimmedLine) {
                        // Convert to paragraph
                        newBlocks.push({
                            object: 'block',
                            type: 'paragraph',
                            paragraph: {
                                rich_text: [{
                                    type: 'text',
                                    text: { content: trimmedLine }
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
                    title: [{
                        text: {
                            content: taskData.title
                        }
                    }]
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
                    title: [{
                        text: {
                            content: updates.title
                        }
                    }]
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
            task.notes = task.comments;
            return task;
        } catch (error) {
            console.error('Error updating Notion task:', error);
            throw error;
        }
    }

    formatNotionTask(page) {
        const properties = page.properties;
        const statusName = properties.Status?.status?.name;
        
        // Debug log to see actual status values
        console.log(`🔍 DEBUG: Notion status for "${properties.Name?.title?.[0]?.text?.content}": "${statusName}"`);
        
        return {
            id: page.id,
            title: properties.Name?.title?.[0]?.text?.content || '',
            completed: statusName === 'Done', // Make sure this matches your actual Notion status options
            due: properties['Due Date']?.date?.start || null,
            notes: '', // This will be populated with comments later
            comments: '', // Add this field
            lastModified: page.last_edited_time,
            created: page.created_time
        };
    }
}

module.exports = new NotionService();
