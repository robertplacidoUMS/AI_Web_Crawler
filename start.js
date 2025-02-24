// start.js
require('dotenv').config();
const { ContentCrawler } = require('./src/crawler');
const { AIAnalyzer } = require('./src/ai-analyzer');

async function main() {
    if (process.env.CRAWLER_MODE === 'true') {
        const crawler = new ContentCrawler(process.env.START_URL);
        await crawler.initialize();
        await crawler.crawl();
    }
    
    if (process.env.AI_MODE === 'true') {
        const analyzer = new AIAnalyzer();
        await analyzer.initialize();
        while (true) {
            await analyzer.processQueue();
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});