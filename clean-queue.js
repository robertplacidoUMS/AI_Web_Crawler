const fs = require('fs').promises;
const path = require('path');
const { getDomainPath } = require('./src/utils/utils');
const { shouldFilter } = require('./config/filters');
require('dotenv').config();

async function cleanQueue() {
    const domain = process.env.ALLOWED_DOMAIN;
    const basePath = getDomainPath(domain);
    const queuePath = path.join(basePath, 'state', 'crawler-state.json');
    const aiQueuePath = path.join(basePath, 'state', 'ai_queue.json');

    try {
        console.log('Starting queue cleanup...');

        // Read current state
        const stateData = await fs.readFile(queuePath, 'utf8');
        const state = JSON.parse(stateData);
        
        // Debug state structure
        console.log('\nState Structure:');
        console.log('---------------');
        console.log('Queue type:', typeof state.queue);
        console.log('Queue is array:', Array.isArray(state.queue));
        if (state.queue.length > 0) {
            console.log('First queue item:', JSON.stringify(state.queue[0], null, 2));
        }

        // Debug URL filtering
        const testUrl = "https://go.umaine.edu/events/category/umaine-in-your-area/day/2024-10-26";
        console.log('\nTesting URL Filter:');
        console.log('------------------');
        console.log('Test URL:', testUrl);
        console.log('Should filter:', shouldFilter(testUrl));

        // Read AI queue
        let aiQueue = [];
        try {
            const aiQueueData = await fs.readFile(aiQueuePath, 'utf8');
            aiQueue = JSON.parse(aiQueueData);
        } catch (error) {
            console.log('No existing AI queue found, will create new');
        }

        const originalQueueSize = state.queue.length;
        const originalVisitedSize = state.visited.length;

        // Filter queue (handle queue items as objects with url property)
        const filteredQueue = state.queue.filter(item => !shouldFilter(item.url));
        const removedUrls = state.queue.filter(item => shouldFilter(item.url))
            .map(item => item.url);  // Get just the URLs

        // Add filtered URLs to visited (make sure visited list only contains URLs)
        // First clean up any objects in visited list
        const cleanVisited = state.visited.map(item => typeof item === 'string' ? item : item.url);
        // Then add new URLs
        state.visited = [...new Set([...cleanVisited, ...removedUrls])];
        state.queue = filteredQueue;

        // Remove filtered URLs from AI queue
        aiQueue = aiQueue.filter(item => !shouldFilter(item.url));

        // Save updated state
        await fs.writeFile(queuePath, JSON.stringify(state, null, 2));
        await fs.writeFile(aiQueuePath, JSON.stringify(aiQueue, null, 2));

        // Log results
        console.log('\nCleanup Results:');
        console.log('----------------');
        console.log(`Original queue size: ${originalQueueSize}`);
        console.log(`URLs removed: ${removedUrls.length}`);
        console.log(`New queue size: ${state.queue.length}`);
        console.log(`Original visited size: ${originalVisitedSize}`);
        console.log(`New visited size: ${state.visited.length}`);
        console.log(`AI queue size: ${aiQueue.length}`);
        
        console.log('\nExample URLs removed:');
        removedUrls.slice(0, 5).forEach(url => console.log(`- ${url}`));

    } catch (error) {
        console.error('Error cleaning queue:', error);
        process.exit(1);
    }
}

cleanQueue().then(() => {
    console.log('\nQueue cleanup completed successfully');
    process.exit(0);
}); 