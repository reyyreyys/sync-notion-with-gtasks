const { Client } = require('@notionhq/client');
const config = require('../config');
const logger = require('../utils/logger');

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
            logger.debug('Using Notion data source', { name: database.data_sources[0].name, id: this.dataSourceId });
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

            const tasksWithContent = [];
            const batchSize = 12;

            for (let i = 0; i < response.results.length; i += batchSize) {
                const batch = response.results.slice(i, i + batchSize);

                const batchTasks = await Promise.all(
                    batch.map(async (page) => {
                        const task = this.formatNotionTask(page);
                        try {
                            const comments = await this.getPageCommentsWithRetry(page.id);
                            task.comments = comments;
                            task.notes = comments;
                            return task;
                        } catch {
                            task.comments = '';
                            task.notes = '';
                            return task;
                        }
                    })
                );

                tasksWithContent.push(...batchTasks);

                if (i + batchSize < response.results.length) {
                    await this.delay(350);
                }
            }

            logger.debug('Notion tasks fetched', { count: tasksWithContent.length });
            return tasksWithContent;
        } catch (error) {
            logger.error('Error fetching Notion tasks', { message: error.message });
            throw error;
        }
    }

    async getPageCommentsWithRetry(pageId, maxRetries = 2) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.getPageComments(pageId);
            } catch (error) {
                logger.warn('Get comments attempt failed', { attempt, maxRetries, message: error.message });
                if (attempt === maxRetries) {
                    logger.error('All comment attempts failed; returning empty', { pageId });
                    return '';
                }
                const delay = attempt * 400;
                await this.delay(delay);
            }
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getPageComments(pageId) {
        try {
            return await this.getAllBlocksRecursively(pageId, 0);
        } catch (error) {
            logger.error('Error getting page comments', { message: error.message, pageId });
            return '';
        }
    }

    async getAllBlocksRecursively(blockId, depth = 0) {
        try {
            const blocks = await this.notion.blocks.children.list({
                block_id: blockId,
                page_size: 100
            });

            let comments = [];
            const indent = '  '.repeat(depth);

            for (const block of blocks.results) {
                let blockText = '';

                if (block.type === 'to_do') {
                    const text = block.to_do.rich_text.map(rt => rt.plain_text).join('');
                    const checked = block.to_do.checked;
                    blockText = `${indent}${checked ? '[x]' : '[ ]'} ${text}`;
                } else if (block.type === 'paragraph') {
                    const text = block.paragraph.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) blockText = `${indent}${text}`;
                } else if (block.type === 'bulleted_list_item') {
                    const text = block.bulleted_list_item.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) blockText = `${indent}• ${text}`;
                } else if (block.type === 'numbered_list_item') {
                    const text = block.numbered_list_item.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) blockText = `${indent}1. ${text}`;
                } else if (block.type === 'heading_1') {
                    const text = block.heading_1.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) blockText = `${indent}# ${text}`;
                } else if (block.type === 'heading_2') {
                    const text = block.heading_2.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) blockText = `${indent}## ${text}`;
                } else if (block.type === 'heading_3') {
                    const text = block.heading_3.rich_text.map(rt => rt.plain_text).join('');
                    if (text.trim()) blockText = `${indent}### ${text}`;
                }

                if (blockText) comments.push(blockText);

                if (block.has_children) {
                    const childComments = await this.getAllBlocksRecursively(block.id, depth + 1);
                    if (childComments.trim()) comments.push(childComments);
                }
            }

            return comments.join('\n');
        } catch (error) {
            logger.error('Error getting blocks at depth', { message: error.message, depth });
            return '';
        }
    }

    async updatePageComments(pageId, commentsText) {
        try {
            const blocks = await this.notion.blocks.children.list({
                block_id: pageId,
                page_size: 50
            });

            for (const block of blocks.results) {
                if (['to_do', 'paragraph', 'bulleted_list_item', 'numbered_list_item', 'heading_1', 'heading_2', 'heading_3'].includes(block.type)) {
                    await this.notion.blocks.delete({ block_id: block.id });
                }
            }

            if (commentsText && commentsText.trim()) {
                const lines = commentsText.split('\n').filter(line => line.trim());
                const newBlocks = [];

                for (const line of lines) {
                    const trimmedLine = line.trim();

                    if (trimmedLine.startsWith('[x]') || trimmedLine.startsWith('[ ]')) {
                        const checked = trimmedLine.startsWith('[x]');
                        const text = trimmedLine.substring(3).trim();
                        newBlocks.push({
                            object: 'block',
                            type: 'to_do',
                            to_do: {
                                rich_text: [{ type: 'text', text: { content: text } }],
                                checked
                            }
                        });
                    } else if (trimmedLine.startsWith('# ')) {
                        const text = trimmedLine.substring(2).trim();
                        newBlocks.push({
                            object: 'block',
                            type: 'heading_1',
                            heading_1: { rich_text: [{ type: 'text', text: { content: text } }] }
                        });
                    } else if (trimmedLine.startsWith('## ')) {
                        const text = trimmedLine.substring(3).trim();
                        newBlocks.push({
                            object: 'block',
                            type: 'heading_2',
                            heading_2: { rich_text: [{ type: 'text', text: { content: text } }] }
                        });
                    } else if (trimmedLine.startsWith('• ')) {
                        const text = trimmedLine.substring(2).trim();
                        newBlocks.push({
                            object: 'block',
                            type: 'bulleted_list_item',
                            bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] }
                        });
                    } else if (trimmedLine) {
                        newBlocks.push({
                            object: 'block',
                            type: 'paragraph',
                            paragraph: { rich_text: [{ type: 'text', text: { content: trimmedLine } }] }
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
            logger.error('Error updating page comments', { message: error.message, pageId });
            throw error;
        }
    }

    async createTask(taskData) {
        try {
            const properties = {
                Name: { title: [{ text: { content: taskData.title } }] },
                Status: { status: { name: taskData.completed ? 'Done' : 'To Do' } }
            };

            if (taskData.due) {
                properties['Due Date'] = { date: { start: taskData.due } };
            }

            const response = await this.notion.pages.create({
                parent: { type: 'database_id', database_id: this.databaseId },
                properties
            });

            if (taskData.notes) {
                await this.updatePageComments(response.id, taskData.notes);
            }

            const result = this.formatNotionTask(response);
            logger.info('Notion task created', { title: result.title, completed: result.completed });
            return result;
        } catch (error) {
            logger.error('Error creating Notion task', { message: error.message });
            throw error;
        }
    }

    async updateTask(pageId, updates) {
        try {
            const properties = {};

            if (updates.title !== undefined) {
                properties.Name = { title: [{ text: { content: updates.title } }] };
            }

            if (updates.completed !== undefined) {
                const currentPage = await this.notion.pages.retrieve({ page_id: pageId });
                const currentStatus = currentPage.properties.Status?.status?.name;

                if (updates.completed) {
                    properties.Status = { status: { name: 'Done' } };
                } else {
                    let incompleteStatus = currentStatus === 'Done' ? 'To Do' : (currentStatus || 'To Do');
                    properties.Status = { status: { name: incompleteStatus } };
                }
                logger.info('Notion task status set', { pageId, completed: updates.completed });
            }

            if (updates.due !== undefined) {
                properties['Due Date'] = updates.due ? { date: { start: updates.due } } : { date: null };
            }

            if (Object.keys(properties).length > 0) {
                await this.notion.pages.update({ page_id: pageId, properties });
            }

            if (updates.notes !== undefined) {
                await this.updatePageComments(pageId, updates.notes);
            }

            const updatedPage = await this.notion.pages.retrieve({ page_id: pageId });
            const task = this.formatNotionTask(updatedPage);
            task.comments = await this.getPageComments(pageId);
            task.notes = task.comments;
            return task;
        } catch (error) {
            logger.error('Error updating Notion task', { message: error.message, pageId, updates });
            throw error;
        }
    }

    formatNotionTask(page) {
        const properties = page.properties;
        const statusName = properties.Status?.status?.name;
        const isCompleted = statusName === 'Done';

        return {
            id: page.id,
            title: properties.Name?.title?.[0]?.text?.content || '',
            completed: isCompleted,
            due: properties['Due Date']?.date?.start || null,
            notes: '',
            comments: '',
            lastModified: page.last_edited_time,
            created: page.created_time,
            originalStatus: statusName
        };
    }
}

module.exports = new NotionService();
