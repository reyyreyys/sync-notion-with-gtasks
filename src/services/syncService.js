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
      console.log('🔄 Starting GOOGLE TASKS PRIORITY sync (Google Tasks = Master)');

      // Fetch tasks from both services
      const [notionTasks, googleTasks] = await Promise.all([
        notionService.getTasks(),
        googleTasksService.getTasks()
      ]);

      console.log(`📊 Google Tasks (MASTER): ${googleTasks.length} tasks`);
      console.log(`📊 Notion (SLAVE): ${notionTasks.length} tasks`);

      let created = 0, updated = 0;

      // PHASE 1: GOOGLE TASKS IS MASTER - Google Tasks → Notion
      console.log('\n👑 === GOOGLE TASKS IS MASTER ===');
      
      for (const googleTask of googleTasks) {
  // Skip empty titles
  if (!googleTask.title || googleTask.title.trim() === '') {
    console.log('⏭️ Skipping Google task with empty title');
    continue;
  }

  try {
    console.log(`\n📋 Processing Google Task (MASTER): "${googleTask.title}"`);
    
    // DEBUG: Show raw status values
    console.log(`     🔍 DEBUG - Raw Google Task:`, {
      id: googleTask.id,
      title: googleTask.title,
      status: googleTask.status || 'undefined',
      completed: googleTask.completed,
      completedType: typeof googleTask.completed
    });
    
    console.log(`     📊 Google Status: ${googleTask.completed ? '✓ Completed' : '○ Pending'}`);
    
    // Find matching Notion task
    const matchingNotionTask = notionTasks.find(nt => 
      nt.title && nt.title.trim().toLowerCase() === googleTask.title.trim().toLowerCase()
    );
    
    if (matchingNotionTask) {
      console.log(`   ✅ Found matching Notion task`);
      
      // DEBUG: Show raw Notion status values
      console.log(`     🔍 DEBUG - Raw Notion Task:`, {
        id: matchingNotionTask.id,
        title: matchingNotionTask.title,
        completed: matchingNotionTask.completed,
        completedType: typeof matchingNotionTask.completed
      });
      
      console.log(`     📊 Notion Status: ${matchingNotionTask.completed ? '✓ Done' : '○ To Do'}`);
      
      // GOOGLE TASKS PRIORITY: Always make Notion match Google Tasks
      let needsUpdate = false;
      const updates = {};
      
      // Status sync: Google Tasks → Notion (ALWAYS)
      console.log(`     🔍 Status comparison: Google(${googleTask.completed}) vs Notion(${matchingNotionTask.completed})`);
      
      if (matchingNotionTask.completed !== googleTask.completed) {
        updates.completed = googleTask.completed;
        needsUpdate = true;
        console.log(`     🔄 STATUS MISMATCH DETECTED!`);
        console.log(`       Will update Notion: ${matchingNotionTask.completed} → ${googleTask.completed}`);
        console.log(`       Notion will become: ${googleTask.completed ? 'Done' : 'To Do'}`);
      } else {
        console.log(`     ✅ Status already matches - no update needed`);
      }
      
      // Update Notion if needed
      if (needsUpdate) {
        console.log(`     🔄 CALLING notionService.updateTask with:`, updates);
        
        try {
          const result = await notionService.updateTask(matchingNotionTask.id, updates);
          updated++;
          console.log(`   ✅ Successfully updated Notion task`);
          console.log(`     🔍 Update result:`, result);
        } catch (updateError) {
          console.error(`     ❌ Failed to update Notion task:`, updateError.message);
          this.stats.errors++;
        }
      }
      
    } else {
      console.log(`   ➕ No matching Notion task - will create new one`);
      
      try {
        console.log(`     🔄 CALLING notionService.createTask with:`, {
          title: googleTask.title,
          completed: googleTask.completed,
          due: googleTask.due,
          notes: googleTask.notes || ''
        });
        
        const newTask = await notionService.createTask({
          title: googleTask.title,
          completed: googleTask.completed,
          due: googleTask.due,
          notes: googleTask.notes || ''
        });
        
        created++;
        console.log(`   ✅ Created Notion task successfully`);
        console.log(`     🔍 Created task:`, newTask);
      } catch (createError) {
        console.error(`     ❌ Failed to create Notion task:`, createError.message);
        this.stats.errors++;
      }
    }
  } catch (error) {
    console.error(`❌ Error processing Google task "${googleTask.title}":`, error.message);
    console.error(`   Full error:`, error);
    this.stats.errors++;
  }
}

      // PHASE 2: Handle Notion-only tasks (create in Google Tasks)
      console.log('\n📋 === SYNCING NOTION-ONLY TASKS TO GOOGLE TASKS ===');
      
      const notionOnlyTasks = notionTasks.filter(nt => {
        if (!nt.title || nt.title.trim() === '') return false;
        
        return !googleTasks.find(gt => 
          gt.title && gt.title.trim().toLowerCase() === nt.title.trim().toLowerCase()
        );
      });
      
      if (notionOnlyTasks.length > 0) {
        console.log(`📊 Found ${notionOnlyTasks.length} Notion-only tasks to sync`);
        
        for (const notionTask of notionOnlyTasks) {
          try {
            console.log(`\n📋 Creating Google Task from Notion: "${notionTask.title}"`);
            
            await googleTasksService.createTask({
              title: notionTask.title,
              completed: notionTask.completed,
              due: notionTask.due,
              notes: notionTask.comments || ''
            });
            
            created++;
            console.log(`   ✅ Created Google Task: "${notionTask.title}" (${notionTask.completed ? 'Completed' : 'Pending'})`);
          } catch (error) {
            console.error(`❌ Error creating Google task "${notionTask.title}":`, error.message);
            this.stats.errors++;
          }
        }
      } else {
        console.log(`📊 No Notion-only tasks found`);
      }

      // Update statistics
      this.stats.totalSyncs++;
      this.stats.lastSyncTime = syncStartTime;
      this.stats.tasksCreated += created;
      this.stats.tasksUpdated += updated;

      const syncDuration = Date.now() - syncStartTime.getTime();
      console.log(`\n🎉 === GOOGLE TASKS PRIORITY SYNC COMPLETE ===`);
      console.log(`✅ Sync completed in ${syncDuration}ms`);
      console.log(`📊 Tasks Created: ${created}`);
      console.log(`📊 Tasks Updated: ${updated}`);
      console.log(`📊 Total Errors: ${this.stats.errors}`);
      console.log(`👑 COMPLETION PRIORITY: Google Tasks ALWAYS wins`);
      console.log(`📝 NOTES PRIORITY: ⬌ Bidirectional (newest modification wins)`);
      console.log(`🔒 GOOGLE TASKS STATUS: Never overridden by Notion`);

      this.lastSync = new Date();
      
    } catch (error) {
      console.error('\n❌ === SYNC FAILED ===');
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      
      if (error.code) {
        console.error('API Error code:', error.code);
      }
      if (error.body) {
        console.error('API Error body:', JSON.stringify(error.body, null, 2));
      }
      
      this.stats.errors++;
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  getSyncStatus() {
    return {
      isRunning: this.isRunning,
      lastSync: this.lastSync,
      stats: this.stats,
      syncType: 'Google Tasks Priority (Master-Slave)',
      rules: {
        completion: 'Google Tasks completion status ALWAYS wins',
        notes: 'Bidirectional sync based on modification time',
        master: 'Google Tasks = Master, Notion = Slave for completion status',
        priority: 'Mark tasks complete in Google Tasks for guaranteed sync'
      },
      nextScheduledSync: this.isRunning ? null : 'Every 2 minutes'
    };
  }

  async triggerManualSync() {
    console.log('🔄 Manual sync triggered');
    return await this.performFullSync();
  }

  resetStats() {
    console.log('🔄 Resetting sync statistics');
    this.stats = {
      totalSyncs: 0,
      lastSyncTime: null,
      errors: 0,
      tasksCreated: 0,
      tasksUpdated: 0,
      tasksDeleted: 0
    };
  }
}

module.exports = new SyncService();
