require('dotenv').config();

const config = {
  notion: {
    token: process.env.NOTION_TOKEN,
    databaseId: process.env.NOTION_DATABASE_ID,
    apiVersion: '2025-09-03'
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    taskListId: process.env.GOOGLE_TASK_LIST_ID || '@default'
  },
  sync: {
    intervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES) || 15,
    batchSize: parseInt(process.env.BATCH_SIZE) || 50
  },
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development'
  }
};

// Validate required environment variables
const requiredVars = [
  'NOTION_TOKEN',
  'NOTION_DATABASE_ID',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN'
];

for (const varName of requiredVars) {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
}

module.exports = config;
