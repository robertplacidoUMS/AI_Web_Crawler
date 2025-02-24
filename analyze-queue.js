const fs = require('fs').promises;
const path = require('path');
const { getDomainPath } = require('./src/utils/utils');
require('dotenv').config();

async function analyzeForFilters() {
    try {
        if (!process.env.CRAWL_OUTPUT_DIR || !process.env.ALLOWED_DOMAIN) {
            console.error('Error: Required environment variables not set');
            process.exit(1);
        }

        const domain = process.env.ALLOWED_DOMAIN;
        const basePath = getDomainPath(domain);
        
        // Define paths
        const crawlerStatePath = path.join(basePath, 'state', 'crawler-state.json');
        const systemLogPath = path.join(basePath, 'logs', 'system.log');

        console.log('\nAnalyzing crawler data for filter suggestions...\n');

        // Read crawler state
        let crawlerState = { queue: [], visited: [] };
        try {
            const stateData = await fs.readFile(crawlerStatePath, 'utf8');
            crawlerState = JSON.parse(stateData);
            console.log(`Analyzing ${crawlerState.queue.length + crawlerState.visited.length} total URLs`);
        } catch (error) {
            console.warn('Could not read crawler state:', error.message);
            return;
        }

        // Analyze patterns
        const subdomainStats = new Map();
        const pathPatternStats = new Map();
        const allUrls = [...crawlerState.queue.map(item => item.url), ...crawlerState.visited];

        // Process URLs
        allUrls.forEach(urlString => {
            try {
                const url = new URL(urlString);
                
                // Analyze subdomains
                const subdomain = url.hostname;
                subdomainStats.set(subdomain, (subdomainStats.get(subdomain) || 0) + 1);

                // Analyze path patterns (first two levels)
                const pathParts = url.pathname.split('/').filter(p => p);
                if (pathParts.length >= 2) {
                    const pattern = '/' + pathParts.slice(0, 2).join('/');
                    pathPatternStats.set(pattern, (pathPatternStats.get(pattern) || 0) + 1);
                }
            } catch (error) {
                console.warn(`Invalid URL: ${urlString}`);
            }
        });

        // Sort and prepare suggestions
        const topSubdomains = [...subdomainStats.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);

        const topPatterns = [...pathPatternStats.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);

        // Display results
        console.log('\nTop 20 Subdomains (Consider adding to skipDomains):');
        console.log('------------------------------------------------');
        topSubdomains.forEach(([subdomain, count]) => {
            console.log(`${subdomain}: ${count} URLs`);
        });

        console.log('\nTop 20 Path Patterns (Consider adding to skipUrlPatterns):');
        console.log('-----------------------------------------------------');
        topPatterns.forEach(([pattern, count]) => {
            console.log(`${pattern}: ${count} URLs`);
        });

        // Analyze error patterns from logs
        try {
            const logContent = await fs.readFile(systemLogPath, 'utf8');
            const errorPatterns = new Map();
            
            logContent.split('\n').forEach(line => {
                try {
                    const log = JSON.parse(line);
                    if (log.level === 'error' || log.level === 'warn') {
                        const urlMatch = log.message.match(/https?:\/\/[^\s"')]+/);
                        if (urlMatch) {
                            const url = new URL(urlMatch[0]);
                            const pattern = url.pathname.split('/').slice(0, 3).join('/');
                            errorPatterns.set(pattern, (errorPatterns.get(pattern) || 0) + 1);
                        }
                    }
                } catch (error) {
                    // Skip malformed log lines
                }
            });

            if (errorPatterns.size > 0) {
                console.log('\nTop Error-Prone Patterns (Consider filtering):');
                console.log('------------------------------------------');
                [...errorPatterns.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .forEach(([pattern, count]) => {
                        console.log(`${pattern}: ${count} errors`);
                    });
            }

        } catch (error) {
            console.warn('Could not analyze error logs:', error.message);
        }

    } catch (error) {
        console.error('Error analyzing data:', error);
        process.exit(1);
    }
}

analyzeForFilters().catch(console.error); 