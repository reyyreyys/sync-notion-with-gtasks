const { app } = require('@azure/functions');

// Import your existing services
const syncService = require('../services/syncService');

app.timer('syncNotionTasks', {
    schedule: '0 */15 * * * *', // Every 15 minutes
    handler: async (myTimer, context) => {
        context.log('⏰ Notion-Google Tasks sync triggered at:', new Date().toISOString());
        
        try {
            // Use your existing sync logic
            await syncService.performFullSync();
            
            context.log('✅ Sync completed successfully');
            
            // Optional: Log some stats
            const stats = syncService.getSyncStatus();
            context.log('📊 Sync stats:', {
                tasksCreated: stats.stats.tasksCreated,
                tasksUpdated: stats.stats.tasksUpdated,
                errors: stats.stats.errors
            });
            
        } catch (error) {
            context.log.error('❌ Sync failed:', error.message);
            context.log.error('Stack trace:', error.stack);
            
            // Don't throw - let it retry on next schedule
            // Azure Functions will automatically retry failed executions
        }
    }
});
