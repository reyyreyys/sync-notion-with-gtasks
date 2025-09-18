require('dotenv').config();
const googleTasksService = require('./src/services/googleTasksService');
const notionService = require('./src/services/notionService');

async function testCreation() {
  try {
    console.log('🧪 Testing Google Tasks creation...');
    
    // Test creating a Google Task
    const testGoogleTask = await googleTasksService.createTask({
      title: 'Test Google Task ' + Date.now(),
      completed: false,
      notes: 'Created by sync test'
    });
    
    console.log('✅ Google Task created:', testGoogleTask);
    
    console.log('\n🧪 Testing Notion task creation...');
    
    // Test creating a Notion task
    const testNotionTask = await notionService.createTask({
      title: 'Test Notion Task ' + Date.now(),
      completed: false,
      notes: 'Created by sync test'
    });
    
    console.log('✅ Notion Task created:', testNotionTask);
    
  } catch (error) {
    console.error('❌ Creation test failed:', error);
  }
}

testCreation();
