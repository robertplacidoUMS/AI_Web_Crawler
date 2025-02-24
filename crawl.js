require('dotenv').config();
const { ContentCrawler } = require('./src/crawler');

async function main() {
    const crawler = new ContentCrawler(process.env.START_URL);
    await crawler.initialize();
    await crawler.crawl();
}

main().catch(error => {
    console.error('Crawler error:', error);
    process.exit(1);
}); 