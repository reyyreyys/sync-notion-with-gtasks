require('dotenv').config();
const { Client } = require('@notionhq/client');
const { google } = require('googleapis');

async function testConnections() {
  console.log('🧪 Testing Notion and Google Tasks connections...\n');

  // Test Notion
  try {
    console.log('📝 Testing Notion connection...');
    const notion = new Client({ 
      auth: process.env.NOTION_TOKEN,
      notionVersion: '2025-09-03'
    });
    
    const database = await notion.databases.retrieve({
      database_id: process.env.NOTION_DATABASE_ID
    });
    
    console.log('✅ Notion connection successful!');
    console.log(`   Database: ${database.title[0]?.plain_text || 'Unnamed'}`);
  } catch (error) {
    console.log('❌ Notion connection failed:', error.message);
  }

  // Test Google Tasks
  try {
    console.log('\n📋 Testing Google Tasks connection...');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    const tasks = google.tasks({ version: 'v1', auth: oauth2Client });
    const taskLists = await tasks.tasklists.list();

    console.log('✅ Google Tasks connection successful!');
    console.log(`   Task lists found: ${taskLists.data.items?.length || 0}`);
    
    if (taskLists.data.items?.length > 0) {
      console.log('   Available lists:');
      taskLists.data.items.forEach(list => {
        console.log(`     - ${list.title} (${list.id})`);
      });
    }
  } catch (error) {
    console.log('❌ Google Tasks connection failed:', error.message);
  }

  console.log('\n🏁 Connection testing complete!');
}

testConnections();
