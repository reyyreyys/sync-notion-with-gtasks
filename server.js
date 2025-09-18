const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const config = require('./src/config');
const syncService = require('./src/services/syncService');
const logger = require('./src/utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Manual sync trigger endpoint
app.post('/sync', async (req, res) => {
  try {
    logger.info('Manual sync triggered via API');
    await syncService.performFullSync();
    res.status(200).json({
      success: true,
      message: 'Sync completed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Manual sync failed:', error);
    res.status(500).json({
      success: false,
      message: 'Sync failed',
      error: error.message
    });
  }
});

// Get sync status
app.get('/sync/status', (req, res) => {
  const status = syncService.getSyncStatus();
  res.status(200).json(status);
});

// Schedule automatic sync every 2 minutes using setInterval
setInterval(async () => {
  try {
    console.log('🔄 INTERVAL TRIGGERED at:', new Date().toISOString());
    logger.info('🔄 Starting scheduled sync');
    await syncService.performFullSync();
    logger.info('✅ Scheduled sync completed');
  } catch (error) {
    console.error('❌ INTERVAL ERROR:', error);
    logger.error('❌ Scheduled sync failed:', error);
  }
}, 2 * 60 * 1000); // 2 minutes in milliseconds

console.log('📅 INTERVAL SET - should run every 2 minutes');
console.log('📅 Current time:', new Date().toISOString());

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info('📋 Notion-Google Tasks sync service started');
  
  // Perform initial sync on startup
  setTimeout(async () => {
    try {
      logger.info('🔄 Running initial sync...');
      await syncService.performFullSync();
      logger.info('✅ Initial sync completed');
    } catch (error) {
      logger.error('❌ Initial sync failed:', error);
    }
  }, 5000);
});

module.exports = app;
