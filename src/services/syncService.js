const notionService = require('./notionService');
const googleTasksService = require('./googleTasksService');

class SyncService {
    constructor() {
        this.lastSync = null;
        this.isRunning = false;
        this.stats = {
            totalSyncs: 0,
            lastSyncTime: null,
            errors: 0,
            tasksCreated: 0,
            tasksUpdated: 0,
            tasksDeleted: 0
        };
    }

    async performFullSync() {
        if (this.isRunning) {
            console.log('⚠️ Sync already in progress, skipping');
            return;
        }

        this.isRunning = true;
        const syncStartTime = new Date();
        
        try {
            console.log('🔄 Starting HYBRID sync (Completion: Timestamp-based, Notes: Notion → Google)');
            
            // Fetch tasks from both services
            const [notionTasks, googleTasks] = await Promise.all([
                notionService.getTasks(),
                googleTasksService.getTasks()
            ]);

            console.log(`📊 Google Tasks: ${googleTasks.length} tasks`);
            console.log(`📊 Notion Tasks: ${notionTasks.length} tasks`);

            // Debug: Show all tasks for comparison
            console.log('\n📋 GOOGLE TASKS:');
            googleTasks.forEach((task, index) => {
                console.log(`${index + 1}. "${task.title}" (completed: ${task.completed}) [modified: ${task.lastModified}]`);
            });

            console.log('\n📋 NOTION TASKS:');
            notionTasks.forEach((task, index) => {
                console.log(`${index + 1}. "${task.title}" (completed: ${task.completed}) [modified: ${task.lastModified}]`);
                console.log(`    Notes preview: "${task.notes?.substring(0, 100) || 'empty'}..." (${task.notes?.length || 0} chars)`);
            });

            let created = 0, updated = 0;
            const SYNC_BUFFER = 5000; // 5 second buffer to avoid sync conflicts

            // Process each Google task for sync comparison
            for (const googleTask of googleTasks) {
                if (!googleTask.title?.trim()) {
                    console.log('⏭️ Skipping Google task with empty title');
                    continue;
                }

                console.log(`\n🔍 Processing Google Task: "${googleTask.title}"`);
                console.log(`   Normalized: "${googleTask.title.trim().toLowerCase().replace(/\s+/g, ' ')}"`);

                // More robust task matching with debug output
                const matchingNotionTask = notionTasks.find(nt => {
                    if (!nt.title?.trim()) {
                        console.log(`   ❌ Skipping Notion task with empty title`);
                        return false;
                    }
                    
                    const notionTitle = nt.title.trim().toLowerCase().replace(/\s+/g, ' ');
                    const googleTitle = googleTask.title.trim().toLowerCase().replace(/\s+/g, ' ');
                    
                    console.log(`   🔍 Comparing with Notion: "${nt.title}" → "${notionTitle}"`);
                    
                    const matches = notionTitle === googleTitle;
                    if (matches) {
                        console.log(`   ✅ MATCH FOUND!`);
                    }
                    
                    return matches;
                });

                if (matchingNotionTask) {
                    // Compare timestamps for completion status only
                    const googleTime = new Date(googleTask.lastModified);
                    const notionTime = new Date(matchingNotionTask.lastModified);
                    const timeDifferenceMs = googleTime.getTime() - notionTime.getTime();
                    
                    console.log(`✅ Found matching Notion task: "${matchingNotionTask.title}"`);
                    console.log(`📅 Google timestamp: ${googleTime.toISOString()} (completed: ${googleTask.completed})`);
                    console.log(`📅 Notion timestamp: ${notionTime.toISOString()} (completed: ${matchingNotionTask.completed})`);
                    console.log(`⏱️ Time difference: ${timeDifferenceMs}ms (buffer: ${SYNC_BUFFER}ms)`);

                    let needsUpdate = false;

                    if (timeDifferenceMs > SYNC_BUFFER) {
                        // Google is newer - update Notion completion status only
                        console.log('🟦 Google Tasks is newer - checking for completion updates');
                        if (matchingNotionTask.completed !== googleTask.completed) {
                            console.log(`   🔄 Will update Notion completion: ${matchingNotionTask.completed} → ${googleTask.completed}`);
                            await this.updateNotionCompletion(matchingNotionTask, googleTask.completed);
                            needsUpdate = true;
                        } else {
                            console.log(`   ✅ Completion status already matches`);
                        }
                    } else if (timeDifferenceMs < -SYNC_BUFFER) {
                        // Notion is newer - update Google completion status only  
                        console.log('🟪 Notion is newer - checking for completion updates');
                        if (googleTask.completed !== matchingNotionTask.completed) {
                            console.log(`   🔄 Will update Google completion: ${googleTask.completed} → ${matchingNotionTask.completed}`);
                            await this.updateGoogleCompletion(googleTask, matchingNotionTask.completed);
                            needsUpdate = true;
                        } else {
                            console.log(`   ✅ Completion status already matches`);
                        }
                    } else {
                        console.log('⚖️ Timestamps within buffer - checking completion status anyway');
                        if (matchingNotionTask.completed !== googleTask.completed) {
                            console.log(`   ⚠️ Completion mismatch within buffer: Notion(${matchingNotionTask.completed}) vs Google(${googleTask.completed})`);
                        } else {
                            console.log('✅ Completion status is in sync (within buffer)');
                        }
                    }

                    // Handle notes sync from Notion → Google with smart truncation
                    const notionNotes = matchingNotionTask.notes?.trim() || '';
                    const googleNotes = googleTask.notes?.trim() || '';
                    
                    console.log(`📝 Checking notes sync (Notion → Google):`);
                    console.log(`   Google notes: "${googleNotes.substring(0, 100)}..." (${googleNotes.length} chars)`);
                    console.log(`   Notion notes: "${notionNotes.substring(0, 100)}..." (${notionNotes.length} chars)`);
                    
                    if (notionNotes !== googleNotes) {
                        const MAX_SYNC_LENGTH = 8000;
                        
                        if (notionNotes.length > MAX_SYNC_LENGTH) {
                            console.log(`⚠️ Notion content too large (${notionNotes.length} chars > ${MAX_SYNC_LENGTH})`);
                            console.log(`📝 Will sync truncated version to Google Tasks`);
                            await this.updateGoogleNotes(googleTask, notionNotes);
                            needsUpdate = true;
                        } else {
                            console.log('📝 Notes differ - syncing Notion → Google (Notion always wins)');
                            await this.updateGoogleNotes(googleTask, notionNotes);
                            needsUpdate = true;
                        }
                    } else {
                        console.log('✅ Notes are already in sync');
                    }

                    if (needsUpdate) {
                        updated++;
                        console.log(`✅ Task "${googleTask.title}" updated successfully`);
                    } else {
                        console.log(`⏭️ No updates needed for "${googleTask.title}"`);
                    }
                } else {
                    // Create new task in Notion
                    console.log('❌ NO MATCHING NOTION TASK FOUND');
                    console.log('🆕 Creating new Notion task from Google task');
                    console.log(`   Title: "${googleTask.title}"`);
                    console.log(`   Completed: ${googleTask.completed}`);
                    console.log(`   Notes: "${googleTask.notes?.substring(0, 50) || 'empty'}..."`);
                    
                    await notionService.createTask({
                        title: googleTask.title,
                        completed: googleTask.completed,
                        due: googleTask.due,
                        notes: googleTask.notes || ''
                    });
                    created++;
                }
            }

            // Handle Notion-only tasks (create in Google Tasks) with content handling
            console.log('\n🔍 Checking for Notion-only tasks...');
            const notionOnlyTasks = notionTasks.filter(nt => {
                if (!nt.title?.trim()) return false;
                
                const hasGoogleMatch = googleTasks.find(gt => {
                    if (!gt.title?.trim()) return false;
                    const notionTitle = nt.title.trim().toLowerCase().replace(/\s+/g, ' ');
                    const googleTitle = gt.title.trim().toLowerCase().replace(/\s+/g, ' ');
                    return notionTitle === googleTitle;
                });
                
                return !hasGoogleMatch;
            });

            console.log(`📊 Found ${notionOnlyTasks.length} Notion-only tasks`);

            for (const notionTask of notionOnlyTasks) {
                console.log(`\n🆕 Creating Google task from Notion: "${notionTask.title}"`);
                console.log(`   Completed: ${notionTask.completed}`);
                console.log(`   Notes: "${notionTask.notes?.substring(0, 50) || 'empty'}..." (${notionTask.notes?.length || 0} chars)`);
                
                // Handle large content when creating new Google tasks
                let notesToSync = notionTask.notes || '';
                const MAX_CREATE_LENGTH = 8000;
                
                if (notesToSync.length > MAX_CREATE_LENGTH) {
                    notesToSync = this.createSmartTruncation(notesToSync, MAX_CREATE_LENGTH);
                    console.log(`   ⚠️ Truncated notes to ${notesToSync.length} characters for Google Tasks`);
                }
                
                await googleTasksService.createTask({
                    title: notionTask.title,
                    completed: notionTask.completed,
                    due: notionTask.due,
                    notes: notesToSync
                });
                created++;
            }

            await this.updateSyncStats(created, updated, syncStartTime);
            
        } catch (error) {
            console.error('❌ SYNC FAILED:', error.message);
            console.error('❌ Stack trace:', error.stack);
            this.stats.errors++;
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    // Smart truncation that preserves structure
    createSmartTruncation(content, maxLength) {
        if (content.length <= maxLength) return content;
        
        // Try to truncate at a natural break point
        const truncateAt = maxLength - 100; // Leave room for suffix
        const lines = content.substring(0, truncateAt).split('\n');
        
        // Remove the last partial line to avoid cutting mid-sentence
        if (lines.length > 1) {
            lines.pop();
        }
        
        const truncated = lines.join('\n');
        const suffix = `\n\n[... ${content.length - truncated.length} more characters in full Notion content ...]`;
        
        return truncated + suffix;
    }

    // Update only Notion completion status
    async updateNotionCompletion(notionTask, completed) {
        try {
            console.log(`🔄 Updating Notion completion: ${notionTask.completed} → ${completed}`);
            await notionService.updateTask(notionTask.id, { completed });
            console.log(`✅ Notion completion status updated successfully`);
        } catch (error) {
            console.error('❌ Error updating Notion completion:', error.message);
            throw error;
        }
    }

    // Update only Google completion status
    async updateGoogleCompletion(googleTask, completed) {
        try {
            console.log(`🔄 Updating Google completion: ${googleTask.completed} → ${completed}`);
            await googleTasksService.updateTask(googleTask.id, { completed });
            console.log(`✅ Google completion status updated successfully`);
        } catch (error) {
            console.error('❌ Error updating Google completion:', error.message);
            throw error;
        }
    }

    // Update only Google notes with intelligent content handling
    async updateGoogleNotes(googleTask, notes) {
        try {
            const MAX_GOOGLE_NOTES_LENGTH = 8000; // Safe limit for Google Tasks
            let processedNotes = notes;
            
            if (notes.length > MAX_GOOGLE_NOTES_LENGTH) {
                processedNotes = this.createSmartTruncation(notes, MAX_GOOGLE_NOTES_LENGTH);
                console.log(`⚠️ Notes intelligently truncated from ${notes.length} to ${processedNotes.length} characters`);
            }
            
            console.log(`📝 Updating Google notes from Notion (${processedNotes.length} characters)`);
            
            // Validate the content before sending
            if (processedNotes.length === 0) {
                console.log(`⚠️ Processed notes are empty, skipping update`);
                return;
            }
            
            await googleTasksService.updateTask(googleTask.id, { notes: processedNotes });
            console.log(`✅ Google notes updated from Notion successfully`);
        } catch (error) {
            console.error('❌ Error updating Google notes:', error.message);
            console.error('❌ Content length:', notes.length);
            console.error('❌ Content preview:', notes.substring(0, 200));
            
            // Try one more time with even more aggressive truncation
            try {
                const emergencyNotes = this.createSmartTruncation(notes, 4000);
                console.log(`🆘 Attempting emergency truncation to ${emergencyNotes.length} characters`);
                await googleTasksService.updateTask(googleTask.id, { notes: emergencyNotes });
                console.log(`✅ Google notes updated with emergency truncation`);
            } catch (secondError) {
                console.error('❌ Emergency truncation also failed:', secondError.message);
                throw error; // Throw original error
            }
        }
    }

    async updateSyncStats(created, updated, syncStartTime) {
        this.stats.totalSyncs++;
        this.stats.lastSyncTime = syncStartTime;
        this.stats.tasksCreated += created;
        this.stats.tasksUpdated += updated;
        
        const syncDuration = Date.now() - syncStartTime.getTime();
        
        console.log('\n✅ SYNC COMPLETE');
        console.log(`⏱️ Sync completed in ${syncDuration}ms`);
        console.log(`📈 Tasks Created: ${created}`);
        console.log(`📝 Tasks Updated: ${updated}`);
        console.log(`📊 Total Syncs: ${this.stats.totalSyncs}`);
        console.log(`❌ Total Errors: ${this.stats.errors}`);
        
        this.lastSync = new Date();
    }

    getSyncStatus() {
        return {
            isRunning: this.isRunning,
            lastSync: this.lastSync,
            stats: this.stats,
            syncType: 'Hybrid Sync Strategy',
            rules: {
                completion: 'Latest timestamp wins for completion status',
                notes: 'Notion always wins for notes/comments (Notion → Google only)',
                direction: 'Completion: Bidirectional | Notes: Notion → Google only',
                buffer: '5-second buffer to prevent sync conflicts',
                priority: 'Completion status: timestamp-based | Notes: Notion master',
                contentHandling: 'Smart truncation for large content (8000 char limit)'
            }
        };
    }
}

module.exports = new SyncService();
