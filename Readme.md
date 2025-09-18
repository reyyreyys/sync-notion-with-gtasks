# Notion ⟷ Google Tasks 2-Way Sync

A Node.js application that provides real-time bidirectional synchronization between Notion task databases and Google Tasks.

## Features

- ✅ **2-way sync**: Changes in either platform reflect in the other
- ⏰ **Automated scheduling**: Runs every 15 minutes automatically
- 🚀 **Manual triggers**: API endpoint for on-demand sync
- 📊 **Status monitoring**: Track sync statistics and health
- 🔒 **Secure**: Uses OAuth 2.0 for Google and integration tokens for Notion
- ☁️ **Cloud ready**: Optimized for Render deployment

## Setup Instructions

### 1. Notion Setup
1. Create a Notion integration at https://www.notion.so/my-integrations
2. Copy the Internal Integration Token
3. Share your tasks database with the integration
4. Copy the database ID from the URL

### 2. Google Tasks Setup
1. Go to Google Cloud Console
2. Create a new project or select existing
3. Enable the Tasks API
4. Create OAuth 2.0 credentials
5. Get refresh token using OAuth playground

### 3. Deploy to Render
1. Fork this repository
2. Connect to Render
3. Set environment variables
4. Deploy!

### 4. Environment Variables
