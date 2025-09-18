require('dotenv').config();
const { Client } = require('@notionhq/client');

async function checkStatusOptions() {
  const notion = new Client({
    auth: process.env.NOTION_TOKEN,
    notionVersion: '2025-09-03'
  });

  try {
    // Get database and its data source
    const database = await notion.databases.retrieve({
      database_id: process.env.NOTION_DATABASE_ID
    });

    const dataSourceId = database.data_sources[0].id;
    
    // Get data source properties
    const dataSource = await notion.request({
      path: `data_sources/${dataSourceId}`,
      method: 'GET'
    });
    
    console.log('📋 Available Status options:');
    const statusProperty = dataSource.properties.Status;
    
    if (statusProperty && statusProperty.status) {
      console.log('Available options:');
      statusProperty.status.options.forEach(option => {
        console.log(`  - "${option.name}" (ID: ${option.id})`);
      });
      
      console.log('\nStatus groups:');
      statusProperty.status.groups.forEach(group => {
        console.log(`  - ${group.name}: ${group.option_ids.length} options`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkStatusOptions();
