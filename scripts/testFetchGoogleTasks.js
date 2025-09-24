/* eslint-disable no-console */
const path = require('path');
require('dotenv').config();

// Ensure we run from project root (where .env and src live)
process.chdir(path.join(__dirname, '..'));

// Adjust this path if your services live under src/services
const googleTasksService = require('../src/services/googleTasksService');

(async () => {
  try {
    console.log('Fetching Google Tasks...');
    const tasks = await googleTasksService.getTasks();
    console.log(`Fetched ${tasks.length} tasks`);

    // Print a quick list
    for (const t of tasks) {
      console.log(`- ${t.title} [completed: ${t.completed}]`);
    }

    // Title to check
    const targetTitle = 'Things I need mummy to help me bring';
    const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const found = tasks.find(t => norm(t.title) === norm(targetTitle));

    if (found) {
      console.log('FOUND target task:', {
        id: found.id,
        title: found.title,
        completed: found.completed,
        lastModified: found.lastModified
      });
      process.exit(0);
    } else {
      console.log('Target task NOT FOUND:', targetTitle);
      process.exit(1);
    }
  } catch (err) {
    console.error('Error in testFetchGoogleTasks:', err.message);
    process.exit(2);
  }
})();
