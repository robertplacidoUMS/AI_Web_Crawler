const fs = require('fs').promises;
const path = require('path');
const { getDomainPath } = require('./src/utils/utils');
const { shouldFilter } = require('./config/filters');
require('dotenv').config();

// Remove this since we're importing it above
// const getDomainPath = (domain) => {
//     return path.join(process.cwd(), process.env.CRAWL_OUTPUT_DIR, domain.replace(/^www\./, ''));
// };

async function cleanQueue() {
    try {
        if (!process.env.CRAWL_OUTPUT_DIR || !process.env.ALLOWED_DOMAIN) {
            console.error('Error: Required environment variables not set');
            process.exit(1);
        }

        const domain = process.env.ALLOWED_DOMAIN;
        const basePath = getDomainPath(domain);
        
        // Create directories if they don't exist
        await fs.mkdir(path.join(basePath, 'state'), { recursive: true });
        
        // Define paths
        const crawlerStatePath = path.join(basePath, 'state', 'crawler-state.json');
        const backupPath = crawlerStatePath + '.backup';

        console.log('Reading crawler state file...');
        console.log('State path:', crawlerStatePath);
        
        // Create backup of original state
        try {
            await fs.copyFile(crawlerStatePath, backupPath);
            console.log('Created backup of original crawler state');
        } catch (error) {
            console.warn('Could not create backup:', error.message);
        }

        // Read crawler state
        let crawlerState = { queue: [], visited: [] };
        try {
            const stateData = await fs.readFile(crawlerStatePath, 'utf8');
            crawlerState = JSON.parse(stateData);
            console.log(`Found ${crawlerState.queue.length} items in queue`);
            console.log(`Found ${crawlerState.visited.length} visited URLs`);
        } catch (error) {
            console.warn('Could not read crawler state:', error.message);
            return;
        }

        // Clean the queue based on current filters
        const originalQueueSize = crawlerState.queue.length;
        const filteredUrls = [];

        for (const item of crawlerState.queue) {
            if (shouldFilter(item.url)) {
                // URL should be filtered - move to visited
                crawlerState.visited.push(item.url);
                filteredUrls.push(item.url);
            }
        }

        // Remove filtered URLs from queue
        crawlerState.queue = crawlerState.queue.filter(item => !shouldFilter(item.url));

        console.log('\nCleaning Results:');
        console.log(`Original queue size: ${originalQueueSize}`);
        console.log(`URLs moved to visited: ${filteredUrls.length}`);
        console.log(`New queue size: ${crawlerState.queue.length}`);
        
        if (filteredUrls.length > 0) {
            console.log('\nSample of filtered URLs:');
            filteredUrls.slice(0, 5).forEach(url => console.log(`- ${url}`));
        }

        // Save cleaned state
        await fs.writeFile(crawlerStatePath, JSON.stringify(crawlerState, null, 2));
        console.log('\nSaved cleaned crawler state');
        console.log(`Original state backed up to: ${backupPath}`);
        console.log('Queue cleaning complete!');

    } catch (error) {
        console.error('Error cleaning queue:', error);
        process.exit(1);
    }
}

cleanQueue().catch(console.error); 