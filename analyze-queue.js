const fs = require('fs').promises;
const path = require('path');
const { getDomainPath } = require('./src/utils/utils');
require('dotenv').config();

async function analyzeSystemLogs() {
    const domain = process.env.ALLOWED_DOMAIN;
    const basePath = getDomainPath(domain);
    
    // Define all log paths
    const logPaths = {
        system: path.join(basePath, 'logs', 'system.log'),
        aiSystem: path.join(basePath, 'logs', 'ai', 'system.log'),
        aiError: path.join(basePath, 'logs', 'ai', 'error.log')
    };

    const errorStats = new Map();
    const quotaErrors = new Map();
    const crawlerErrors = new Map();
    let totalErrors = 0;

    try {
        // Read and combine all logs
        const allLogs = [];
        for (const [type, logPath] of Object.entries(logPaths)) {
            try {
                const logContent = await fs.readFile(logPath, 'utf8');
                const lines = logContent.split('\n');
                lines.forEach(line => {
                    if (line) allLogs.push({ type, line });
                });
                console.log(`Read ${lines.length} lines from ${type}`);
            } catch (error) {
                console.log(`No ${type} log found at ${logPath}`);
            }
        }

        allLogs.forEach(({ type, line }) => {
            try {
                if (!line) return;
                const logEntry = JSON.parse(line);

                if (logEntry.level === 'error' || logEntry.level === 'warn') {
                    totalErrors++;
                    
                    const urlMatch = logEntry.message.match(/https?:\/\/[^\s"')]+/);
                    if (urlMatch) {
                        const url = new URL(urlMatch[0]);
                        
                        // Get path pattern (first two levels)
                        const pathParts = url.pathname.split('/').filter(p => p);
                        const pathPattern = pathParts.length > 0 ? 
                            '/' + pathParts.slice(0, 2).join('/') :
                            '/';
                        
                        // Create full pattern (domain + path)
                        const pattern = url.hostname + pathPattern;

                        // Track error by pattern
                        if (!errorStats.has(pattern)) {
                            errorStats.set(pattern, {
                                count: 0,
                                urls: new Set(),
                                types: new Map(),
                                sources: new Set()
                            });
                        }
                        
                        const stats = errorStats.get(pattern);
                        stats.count++;
                        stats.urls.add(url.href);
                        stats.sources.add(type);

                        // Categorize error type
                        let errorType = 'Other';
                        if (logEntry.message.includes('quota exceeded')) errorType = 'Quota';
                        else if (logEntry.message.includes('timeout')) errorType = 'Timeout';
                        else if (logEntry.message.includes('navigation')) errorType = 'Navigation';
                        else if (logEntry.message.includes('ECONNREFUSED')) errorType = 'Connection';
                        else if (logEntry.message.includes('404')) errorType = '404';
                        else if (logEntry.message.includes('502')) errorType = '502';
                        else if (logEntry.message.includes('500')) errorType = '500';
                        
                        stats.types.set(errorType, (stats.types.get(errorType) || 0) + 1);

                        // Track specific error types
                        if (errorType === 'Quota') {
                            quotaErrors.set(pattern, (quotaErrors.get(pattern) || 0) + 1);
                        }
                        if (type === 'system') {
                            crawlerErrors.set(pattern, (crawlerErrors.get(pattern) || 0) + 1);
                        }
                    }
                }
            } catch (error) {
                // Skip malformed log lines
            }
        });

        // Group errors by domain for summary
        const domainErrors = new Map();
        for (const [pattern, stats] of errorStats.entries()) {
            const domain = pattern.split('/')[0];
            if (!domainErrors.has(domain)) {
                domainErrors.set(domain, new Map());
            }
            
            // Combine error types for domain
            const domainStats = domainErrors.get(domain);
            for (const [type, count] of stats.types.entries()) {
                domainStats.set(type, (domainStats.get(type) || 0) + count);
            }
        }

        // Display results
        console.log('\nTop 20 Error Patterns:');
        console.log('--------------------');
        
        const sortedPatterns = [...errorStats.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 20);  // Only take top 20

        sortedPatterns.forEach(([pattern, stats]) => {
            const errorSummary = [...stats.types.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => `${type}:${count}`)
                .join(', ');
            
            console.log(`${pattern} (${stats.count} errors) - ${errorSummary}`);
        });

        console.log('\nTop 20 Domain Error Summary:');
        console.log('--------------------------');
        [...domainErrors.entries()]
            .sort((a, b) => {
                const aTotal = [...a[1].values()].reduce((sum, count) => sum + count, 0);
                const bTotal = [...b[1].values()].reduce((sum, count) => sum + count, 0);
                return bTotal - aTotal;
            })
            .slice(0, 20)  // Only take top 20
            .forEach(([domain, errorTypes]) => {
                const summary = [...errorTypes.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => `${type}:${count}`)
                    .join(', ');
                const total = [...errorTypes.values()].reduce((sum, count) => sum + count, 0);
                console.log(`${domain} (${total} total) - ${summary}`);
            });

        // Add total counts to summary
        console.log('\nLog Analysis Summary:');
        console.log('--------------------');
        console.log(`Total Errors: ${totalErrors}`);
        console.log(`Total Path Patterns with Errors: ${errorStats.size}`);
        console.log(`Total Domains with Errors: ${domainErrors.size}`);
        console.log('(Showing top 20 of each in detailed lists above)');

    } catch (error) {
        console.error('Error analyzing logs:', error);
    }
}

async function analyzeQueue() {
    const domain = process.env.ALLOWED_DOMAIN;
    const basePath = getDomainPath(domain);
    const queuePath = path.join(basePath, 'state', 'crawler-state.json');
    const aiQueuePath = path.join(basePath, 'state', 'ai_queue.json');

    try {
        console.log('Analyzing queues...\n');

        // Read state files
        const stateData = await fs.readFile(queuePath, 'utf8');
        const state = JSON.parse(stateData);
        
        let aiQueue = [];
        try {
            const aiQueueData = await fs.readFile(aiQueuePath, 'utf8');
            aiQueue = JSON.parse(aiQueueData);
        } catch (error) {
            console.log('No AI queue file found');
        }

        // Collect all URLs
        const allUrls = [
            ...(Array.isArray(state.queue) ? state.queue : []),
            ...(Array.isArray(state.visited) ? state.visited : []),
            ...(Array.isArray(aiQueue) ? aiQueue.map(item => {
                if (item && typeof item === 'object' && typeof item.url === 'string') {
                    return item.url;
                }
                return null;
            }).filter(url => url !== null) : [])
        ].filter(url => typeof url === 'string');

        // Analyze domains and paths
        const domainStats = new Map();
        const pathPatterns = new Map();

        allUrls.forEach(url => {
            try {
                // Skip if URL is not a string
                if (typeof url !== 'string') {
                    console.warn(`Skipping invalid URL type: ${typeof url}`);
                    return;
                }

                const urlObj = new URL(url);
                
                // Track domain/subdomain counts
                const domain = urlObj.hostname;
                domainStats.set(domain, (domainStats.get(domain) || 0) + 1);

                // Track path patterns
                const pathParts = urlObj.pathname.split('/').filter(p => p);
                if (pathParts.length > 0) {
                    const pattern = '/' + pathParts[0] + (pathParts[1] ? '/' + pathParts[1] : '');
                    pathPatterns.set(pattern, (pathPatterns.get(pattern) || 0) + 1);
                }
            } catch (error) {
                console.warn(`Invalid URL: ${url} - ${error.message}`);
            }
        });

        // Sort and display results
        console.log('Domain Statistics:');
        console.log('------------------');
        const sortedDomains = [...domainStats.entries()]
            .sort((a, b) => b[1] - a[1]);

        sortedDomains.forEach(([domain, count]) => {
            console.log(`${domain}: ${count} URLs`);
        });

        console.log('\nTop Path Patterns:');
        console.log('------------------');
        const sortedPatterns = [...pathPatterns.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);  // Show top 20

        sortedPatterns.forEach(([pattern, count]) => {
            console.log(`${pattern}: ${count} URLs`);
        });

        // Generate potential filter suggestions
        console.log('\nPotential Filter Suggestions:');
        console.log('----------------------------');
        sortedPatterns
            .filter(([pattern, count]) => {
                // Suggest patterns that appear frequently
                return count > 50 || 
                       pattern.includes('calendar') ||
                       pattern.includes('events') ||
                       pattern.includes('feed') ||
                       pattern.includes('archive');
            })
            .forEach(([pattern, count]) => {
                console.log(`${pattern}.*  # ${count} URLs`);
            });

        // Summary statistics
        console.log('\nSummary:');
        console.log('--------');
        console.log(`Total URLs analyzed: ${allUrls.length}`);
        console.log(`Unique domains: ${domainStats.size}`);
        console.log(`Unique path patterns: ${pathPatterns.size}`);
        console.log(`Crawler queue size: ${state.queue.length}`);
        console.log(`Visited URLs: ${state.visited.length}`);
        console.log(`AI queue size: ${aiQueue.length}`);

        // Add log analysis
        console.log('\nAnalyzing System Logs:');
        console.log('=====================');
        await analyzeSystemLogs();

    } catch (error) {
        console.error('Error analyzing queue:', error);
        process.exit(1);
    }
}

analyzeQueue().then(() => {
    console.log('\nAnalysis completed successfully');
    process.exit(0);
}); 