require('dotenv').config();
const { Client } = require('@notionhq/client');

async function checkNotionStructure() {
  console.log('🔍 Starting Notion database structure check...');
  console.log('📋 Database ID:', process.env.NOTION_DATABASE_ID);
  
  const notion = new Client({
    auth: process.env.NOTION_TOKEN,
    notionVersion: '2025-09-03'
  });

  try {
    // First get the database
    console.log('🔗 Retrieving database...');
    const database = await notion.databases.retrieve({
      database_id: process.env.NOTION_DATABASE_ID
    });

    console.log('✅ Database retrieved successfully!');
    console.log('📋 Database title:', database.title?.[0]?.plain_text || 'No title');
    
    // Check if this database uses data sources (new format)
    if (database.data_sources && database.data_sources.length > 0) {
      console.log('🔄 This database uses the new data sources format');
      console.log('📊 Data sources found:', database.data_sources.length);
      
      // Use the first data source
      const dataSourceId = database.data_sources[0].id;
      const dataSourceName = database.data_sources[0].name;
      console.log(`🎯 Using data source: "${dataSourceName}" (ID: ${dataSourceId})`);
      
      // Get data source properties
      console.log('📋 Getting data source properties...');
      try {
        // Query the data source to see its structure
        const dataSourceResponse = await notion.request({
          path: `data_sources/${dataSourceId}`,
          method: 'GET'
        });
        
        console.log('📋 Data source properties:');
        if (dataSourceResponse.properties) {
          Object.entries(dataSourceResponse.properties).forEach(([name, prop]) => {
            console.log(`  - "${name}": ${prop.type} (ID: ${prop.id})`);
          });
        }
      } catch (error) {
        console.log('⚠️ Could not get data source properties directly, trying pages...');
        
        // Alternative: Get pages from the data source to see what properties exist
        const pages = await notion.request({
          path: `data_sources/${dataSourceId}/query`,
          method: 'POST',
          body: { page_size: 3 }
        });
        
        console.log(`📄 Found ${pages.results.length} pages in data source`);
        
        if (pages.results.length > 0) {
          console.log('📋 Properties from sample pages:');
          const samplePage = pages.results[0];
          if (samplePage.properties) {
            Object.entries(samplePage.properties).forEach(([name, prop]) => {
              console.log(`  - "${name}": ${prop.type}`);
            });
          }
          
          // Show sample data
          pages.results.forEach((page, index) => {
            console.log(`\n📄 Page ${index + 1}:`);
            Object.entries(page.properties).forEach(([name, prop]) => {
              let value = 'null';
              try {
                if (prop.type === 'title' && prop.title?.[0]?.text?.content) {
                  value = `"${prop.title[0].text.content}"`;
                } else if (prop.type === 'select' && prop.select?.name) {
                  value = `"${prop.select.name}"`;
                } else if (prop.type === 'checkbox') {
                  value = prop.checkbox;
                } else if (prop.type === 'rich_text' && prop.rich_text?.[0]?.text?.content) {
                  value = `"${prop.rich_text[0].text.content}"`;
                }
              } catch (err) {
                value = `[Error: ${err.message}]`;
              }
              console.log(`    ${name} (${prop.type}): ${value}`);
            });
          });
        } else {
          console.log('⚠️ Data source is empty - add some test tasks');
        }
      }
      
    } else {
      console.log('📋 This database uses the traditional format');
      // Handle traditional database format (should have properties)
      if (database.properties) {
        console.log('Properties:', Object.keys(database.properties));
      }
    }

  } catch (error) {
    console.error('❌ Error details:');
    console.error('  Error name:', error.name);
    console.error('  Error message:', error.message);
    console.error('  Error code:', error.code);
    
    if (error.body) {
      console.error('  API Error body:', JSON.stringify(error.body, null, 2));
    }
  }
}

checkNotionStructure();
