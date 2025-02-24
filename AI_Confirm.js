require('dotenv').config();
const { AIAnalyzer } = require('./src/ai-analyzer');

async function main() {
    const analyzer = new AIAnalyzer();
    await analyzer.initialize();
    while (true) {
        await analyzer.processQueue();
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

main().catch(error => {
    console.error('AI Analyzer error:', error);
    process.exit(1);
}); 