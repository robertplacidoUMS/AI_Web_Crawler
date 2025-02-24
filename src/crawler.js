// crawler.js
const puppeteer = require('puppeteer');
const winston = require('winston');
const path = require('path');
const fs = require('fs').promises;
const SEARCH_TERMS = require('../config/search-terms');
const { extractPageContent } = require('./utils/content-extractor');
const { shouldFilter } = require('../config/filters');
require('dotenv').config();

// At the top, add domain-based path helper
const getDomainPath = (domain) => {
    return path.join(process.cwd(), process.env.CRAWL_OUTPUT_DIR, domain.replace(/^www\./, ''));
};

// Configure loggers
const systemLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'logs', 'error.log'), 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'logs', 'system.log')
        }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

const matchLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'logs', 'matches', 'dei_matches.log')
        })
    ]
});

// Create log directories
(async () => {
    const domain = process.env.ALLOWED_DOMAIN;
    const basePath = getDomainPath(domain);
    // Create all required directories
    await Promise.all([
        fs.mkdir(path.join(basePath, 'logs', 'matches'), { recursive: true }),
        fs.mkdir(path.join(basePath, 'logs', 'ai', 'matches'), { recursive: true }),
        fs.mkdir(path.join(basePath, 'state'), { recursive: true })
    ]);
})();

class URLManager {
    constructor(storageFile, maxSize = 10000, logger, shouldCrawl, options = {}) {
        this.storageFile = path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'state', 'crawler-state.json');
        this.maxSize = maxSize;
        this.visitedUrls = new Set();
        this.queue = [];
        this.inProgress = new Set();
        this.lastSave = Date.now();
        this.saveInterval = 30000; // Save every 30 seconds
        this.logger = logger;
        this.shouldCrawl = shouldCrawl;
        this.options = options;
        
        // Add periodic logging of state size
        setInterval(() => {
            this.logger.debug(`Current state: ${this.visitedUrls.size} visited, ${this.queue.length} queued, ${this.inProgress.size} in progress`);
        }, 10000);

        this._saveInterval = null;  // Add reference to interval
    }

    async initialize() {
        await this.loadState();
        this.startAutoSave();
    }

    startAutoSave() {
        // Clear any existing interval
        if (this._saveInterval) {
            clearInterval(this._saveInterval);
        }
        
        this._saveInterval = setInterval(async () => {
            try {
                if (Date.now() - this.lastSave >= this.saveInterval) {
                    this.logger.debug('Auto-save triggered');
                    await this.saveState();
                }
            } catch (error) {
                this.logger.error('Error in auto-save:', error);
            }
        }, this.saveInterval);
    }

    async saveState() {
        try {
            const state = {
                visited: Array.from(this.visitedUrls),
                queue: this.queue,
                inProgress: Array.from(this.inProgress),
                timestamp: new Date().toISOString()
            };
            
            this.logger.info(`Saving state: ${this.visitedUrls.size} visited, ${this.queue.length} queued URLs`);
            
            // Ensure the state directory exists
            const stateDir = path.dirname(this.storageFile);
            await fs.mkdir(stateDir, { recursive: true });
            
            // Write state atomically using a temporary file
            const tempFile = `${this.storageFile}.tmp`;
            await fs.writeFile(tempFile, JSON.stringify(state, null, 2));
            await fs.rename(tempFile, this.storageFile);
            
            this.lastSave = Date.now();
            this.logger.debug(`State saved successfully to ${this.storageFile}`);
            
            // Verify the file was written
            const stats = await fs.stat(this.storageFile);
            this.logger.debug(`State file size: ${stats.size} bytes`);
        } catch (error) {
            this.logger.error('Error saving URL state:', error);
            throw error;
        }
    }

    async loadState() {
        try {
            this.logger.debug(`Attempting to load state from ${this.storageFile}`);
            const data = await fs.readFile(this.storageFile, 'utf8');
            const state = JSON.parse(data);
            
            this.visitedUrls = new Set(state.visited);
            this.queue = state.queue || [];
            
            // Handle in-progress URLs recovery
            const inProgressUrls = new Set(state.inProgress || []);
            let recoveredCount = 0;
            
            if (inProgressUrls.size > 0) {
                this.logger.info(`Found ${inProgressUrls.size} in-progress URLs to recover`);
                
                // Find the original queue items for in-progress URLs if they exist
                const inProgressItems = state.queue.filter(item => inProgressUrls.has(item.url));
                
                // Add remaining in-progress URLs with estimated depth
                for (const url of inProgressUrls) {
                    // Skip if URL is already in queue (from previous step)
                    if (!this.queue.some(item => item.url === url)) {
                        // Try to estimate depth based on URL structure
                        const depth = (url.match(/\//g) || []).length - 2;
                        this.addToQueue(url, Math.min(depth, this.options.maxDepth));
                        recoveredCount++;
                    }
                }
                
                this.logger.info(`Recovered ${recoveredCount} in-progress URLs back to queue`);
            }
            
            // Clear in-progress set as we've re-queued everything
            this.inProgress = new Set();
            
            this.logger.info(
                `Loaded state: ${this.visitedUrls.size} visited, ` +
                `${this.queue.length} queued (including ${recoveredCount} recovered)`
            );
            
            // Log some sample URLs for verification
            const sampleVisited = Array.from(this.visitedUrls).slice(0, 3);
            const sampleQueued = this.queue.slice(0, 3);
            this.logger.debug('Sample visited URLs:', sampleVisited);
            this.logger.debug('Sample queued URLs:', sampleQueued);
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.logger.info('No previous state found, starting fresh');
            } else {
                this.logger.error('Error loading state:', error);
                this.logger.info('Starting with fresh state due to load error');
            }
            this.visitedUrls = new Set();
            this.queue = [];
            this.inProgress = new Set();
        }
    }

    addToQueue(url, depth) {
        const cleanUrl = this.shouldCrawl(url);
        if (cleanUrl && !this.isVisited(cleanUrl) && !this.isQueued(cleanUrl) && !this.inProgress.has(cleanUrl)) {
            this.logger.debug(`Adding URL to queue: ${cleanUrl} at depth ${depth}`);
            this.queue.push({ url: cleanUrl, depth, added: Date.now() });
            this.queue.sort((a, b) => a.depth - b.depth);
            this.logger.debug(`Queue size is now: ${this.queue.length}`);
        }
    }

    takeNext(count) {
        const batch = this.queue.splice(0, count);
        this.logger.debug(`Taking ${batch.length} URLs from queue. ${this.queue.length} remaining`);
        batch.forEach(item => {
            this.inProgress.add(item.url);
            this.logger.debug(`Marked as in-progress: ${item.url}`);
        });
        return batch;
    }

    markVisited(url) {
        this.inProgress.delete(url);
        this.logger.debug(`Removed ${url} from in-progress set`);
        if (this.visitedUrls.size >= this.maxSize) {
            const toRemove = Array.from(this.visitedUrls).slice(0, 1000);
            toRemove.forEach(url => this.visitedUrls.delete(url));
            this.logger.debug(`Cleaned up ${toRemove.length} old visited URLs`);
        }
        this.visitedUrls.add(url);
        this.logger.debug(`Marked as visited: ${url}. Total visited: ${this.visitedUrls.size}`);
    }

    markFailed(url) {
        this.inProgress.delete(url);
    }

    isVisited(url) {
        return this.visitedUrls.has(url);
    }

    isQueued(url) {
        return this.queue.some(item => item.url === url);
    }

    hasNext() {
        return this.queue.length > 0;
    }

    async shutdown() {
        // Clear the auto-save interval
        if (this._saveInterval) {
            clearInterval(this._saveInterval);
            this._saveInterval = null;
        }
        // Save state one final time
        await this.saveState();
        this.logger.info('URL Manager shutdown complete');
    }
}

// Use these loggers in the code
class ContentCrawler {
    constructor(startUrl, options = {}) {
        this.startUrl = startUrl;
        this.logger = systemLogger;  // Use system logger for crawler operations
        const domain = process.env.ALLOWED_DOMAIN;
        this.basePath = getDomainPath(domain);
        this.aiQueuePath = path.join(this.basePath, 'state', 'ai_queue.json');
        
        // Log startup information
        this.logger.info(`Starting crawler with URL: ${this.startUrl}`);
        if (!this.startUrl || !this.startUrl.startsWith('http')) {
            this.logger.error('Invalid START_URL provided');
            throw new Error('Invalid START_URL. Must start with http:// or https://');
        }
        this.options = {
            maxConcurrent: parseInt(process.env.MAX_CONCURRENT) || 3,
            maxDepth: parseInt(process.env.MAX_DEPTH) || 3,
            maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
            ...options
        };
        
        this.urlManager = new URLManager(
            path.join(this.basePath, 'state', 'crawler-state.json'),
            parseInt(process.env.MAX_URLS) || 10000,
            this.logger,
            this.shouldCrawl.bind(this),
            this.options
        );
        
        this.browser = null;
        this.isShuttingDown = false;
        this.stopWhenEmpty = process.env.STOP_WHEN_EMPTY !== 'false';
        this.logger.info(`STOP_WHEN_EMPTY is set to: ${this.stopWhenEmpty}`);

        // Add signal handling
        process.on('SIGINT', async () => {
            this.logger.info('Received SIGINT signal');
            await this.shutdown();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            this.logger.info('Received SIGTERM signal');
            await this.shutdown();
            process.exit(0);
        });

        // Add domain-specific settings
        
        this.domainSettings = {
            'studentrecords.umaine.edu': {
                interceptRequests: false,
                waitUntil: 'domcontentloaded',
                timeout: 45000
            },
            'mitchellcenter.umaine.edu': {
                interceptRequests: false,
                waitUntil: 'domcontentloaded',
                timeout: 45000
            },
            'owls.umpi.edu': {
                timeout: 60000,
                waitUntil: 'domcontentloaded'
            },
            'catalog.umpi.edu': {
                // Disable request interception for catalog site
                interceptRequests: false,
                waitUntil: 'domcontentloaded',
                timeout: 45000
            },
            'online.umpi.edu': {
                // Handle SSL issues for online site
                ignoreCertificateErrors: true,
                timeout: 45000
            }
        };
    }

    async initialize() {
        this.logger.debug('Starting initialization');
        
        // Initialize URL manager
        await this.urlManager.initialize();
        
        // Add start URL if fresh start
        if (!this.urlManager.hasNext() && !this.urlManager.isVisited(this.startUrl)) {
            this.urlManager.addToQueue(this.startUrl, 0);
        }

        // Initialize browser with updated options
        this.logger.debug('Launching browser');
        this.browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--ignore-certificate-errors',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials',
                '--disable-features=BlockInsecurePrivateNetworkRequests',
                '--disable-features=IsolateOrigins',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=BlockInsecurePrivateNetworkRequests',
                '--disable-client-side-phishing-detection',
                '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies'
            ],
            ignoreHTTPSErrors: true
        });

        // Set default browser context with permissions
        const context = await this.browser.defaultBrowserContext();
        await context.overridePermissions(process.env.START_URL, [
            'geolocation',
            'notifications',
            'camera',
            'microphone',
            'clipboard-read',
            'clipboard-write'
        ]);

        this.logger.debug('Browser launched successfully');
        
        this.logger.info('Crawler initialized');
    }

    async searchForTerms(text) {
        const foundTerms = [];
        const lowerText = text.toLowerCase();
        
        for (const [category, terms] of Object.entries(SEARCH_TERMS)) {
            for (const term of terms) {
                const termLower = term.toLowerCase();
                if (lowerText.includes(termLower)) {
                    // Get context around the match
                    const index = lowerText.indexOf(termLower);
                    const start = Math.max(0, index - 50);
                    const end = Math.min(lowerText.length, index + term.length + 50);
                    const context = text.slice(start, end);
                    
                    foundTerms.push({
                        category,
                        term,
                        context: `...${context}...`,
                        position: index
                    });
                }
            }
        }
        return foundTerms;
    }

    isValidUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
        } catch {
            return false;
        }
    }

    async addToAIQueue(url, content, terms, title) {
        try {
            let aiQueue = [];
            try {
                const queueData = await fs.readFile(this.aiQueuePath, 'utf8');
                aiQueue = JSON.parse(queueData);
            } catch (error) {
                this.logger.info('No existing AI queue found, will create new');
            }

            // Check if URL already exists in queue
            if (aiQueue.some(item => item.url === url)) {
                this.logger.debug(`URL already in AI queue: ${url}`);
                return;
            }

            // Check if URL has already been processed (check matches file)
            const matchesPath = path.join(this.basePath, 'logs', 'ai', 'matches', 'ai_matches.csv');
            try {
                const matchesData = await fs.readFile(matchesPath, 'utf8');
                if (matchesData.includes(url)) {
                    this.logger.debug(`URL already processed: ${url}`);
                    return;
                }
            } catch (error) {
                // No matches file yet, that's ok
                this.logger.debug('No existing matches file found');
            }

            // Add to queue with the found terms and their context
            aiQueue.push({
                url,
                content,
                title,
                added: Date.now(),
                terms: terms.map(t => ({
                    category: t.category,
                    term: t.term,
                    matchedText: content.slice(t.position, t.position + t.term.length),
                    context: t.context,
                    position: t.position
                }))
            });

            await fs.writeFile(this.aiQueuePath, JSON.stringify(aiQueue, null, 2));
            this.logger.info(`Added to AI queue: ${url} with ${terms.length} terms`);

        } catch (error) {
            this.logger.error(`Error adding to AI queue: ${error}`);
        }
    }

    async processPage(urlInfo, retryCount = 0) {
        const { url, depth } = urlInfo;

        // Add URL validation
        if (!this.isValidUrl(url)) {
            this.logger.error(`Invalid URL format: ${url}`);
            this.urlManager.markVisited(url); // Mark as visited to remove from queue
            return;
        }

        let page = null;

        try {
            // Check if URL is already visited
            if (this.urlManager.isVisited(url)) {
                this.logger.debug(`Skipping already visited URL: ${url}`);
                return;
            }

            if (this.isShuttingDown) {
                return;
            }

            this.logger.debug(`Processing page: ${url} at depth ${depth}`);
            page = await this.browser.newPage();
            
            // Get domain-specific settings
            const domain = new URL(url).hostname;
            const settings = this.domainSettings[domain] || {};
            
            // Configure page settings using env variables with fallbacks
            const pageTimeout = settings.timeout || 
                parseInt(process.env.PAGE_TIMEOUT) || 30000;
            const navTimeout = settings.timeout || 
                parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
            const waitUntil = settings.waitUntil || 
                process.env.WAIT_UNTIL || 'networkidle0';

            await page.setDefaultTimeout(pageTimeout);
            await page.setDefaultNavigationTimeout(navTimeout);

            // Set user agent
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Add this section
            await page.setRequestInterception(true);
            page.on('request', request => {
                const resourceType = request.resourceType();
                if (settings.interceptRequests === false) {
                    request.continue();
                } else if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    request.abort();
                } else {
                    // Allow the request but with modified headers
                    const headers = {
                        ...request.headers(),
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    };
                    request.continue({ headers });
                }
            });

            // Handle redirects more gracefully
            const response = await page.goto(url, { 
                waitUntil: waitUntil,
                maxRedirects: 5,
                timeout: pageTimeout
            });

            if (!response) {
                throw new Error(`Failed to get response from ${url}`);
            }
            
            const status = response.status();
            this.logger.debug(`Received HTTP ${status} from ${url}`);
            
            // Handle various HTTP status codes
            if ([403, 404, 429, 502, 503, 504].includes(status)) {
                this.logger.warn(`Received status ${status} for ${url} - marking as visited to skip`);
                this.urlManager.markVisited(url);
                return;
            }

            // Accept 200 (OK) and 304 (Not Modified) as valid responses
            if (status !== 200 && status !== 304) {
                throw new Error(`HTTP ${status} received for ${url}`);
            }

            // Log successful connection
            this.logger.debug(`Successfully connected to ${url}`);
            
            // Extract page content with improved targeting
            this.logger.debug(`Extracting content from ${url}`);
            const content = await extractPageContent(page);
            const title = await page.title();
            
            this.logger.debug(`Extracted content from ${url}:`, {
                title,
                contentLength: content.text.length,
                preview: content.firstChars
            });

            // Search for DEI terms
            const foundTerms = await this.searchForTerms(content.text);
            
            if (foundTerms.length > 0) {
                await this.addToAIQueue(url, content.text, foundTerms, title);
            }

            // Extract and queue new URLs if not at max depth
            if (depth < this.options.maxDepth) {
                const links = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('a'))
                        .map(a => a.href)
                        .filter(href => href && href.startsWith('http'));
                });

                this.logger.debug(`Found ${links.length} links on ${url}`);
                let queuedCount = 0;

                for (const link of links) {
                    if (this.shouldCrawl(link)) {
                        this.urlManager.addToQueue(link, depth + 1);
                        queuedCount++;
                    }
                }

                this.logger.debug(`Queued ${queuedCount} new links from ${url}`);
            }

            this.urlManager.markVisited(url);
            this.logger.debug(`Marked ${url} as visited. Queue size: ${this.urlManager.queue.length}`);

        } catch (error) {
            // Clean up error message
            let errorMessage = error.message;
            
            // Remove stack trace and file paths
            if (errorMessage.includes('\n')) {
                errorMessage = errorMessage.split('\n')[0];
            }
            
            // Clean up common Puppeteer errors
            errorMessage = errorMessage
                .replace(/at [A-Za-z.]+ \(.*?\)/g, '')  // Remove "at Function (filepath)"
                .replace(/\s+/g, ' ')                    // Clean up whitespace
                .replace(/Error:/i, '')                  // Remove "Error:" prefix
                .trim();

            // Log clean error message
            this.logger.error(`Error processing ${url}: ${errorMessage}`);
            
            // Handle specific error types
            if (error.name === 'TimeoutError' || errorMessage.includes('timeout')) {
                this.logger.warn(`Timeout on ${url} - marking as visited to skip`);
                this.urlManager.markVisited(url);
                return;
            }

            // Handle navigation errors
            if (errorMessage.includes('net::')) {
                this.logger.warn(`Network error on ${url} - marking as visited to skip`);
                this.urlManager.markVisited(url);
                return;
            }

            // Retry logic for other errors
            if (retryCount < this.options.maxRetries) {
                this.logger.warn(`Retrying ${url} (attempt ${retryCount + 1})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                return this.processPage(urlInfo, retryCount + 1);
            }

            this.logger.error(`Failed to process ${url} after ${retryCount} retries`);
            this.urlManager.markVisited(url);

        } finally {
            if (page) {
                try {
                    await page.close();
                } catch (error) {
                    // Ignore page close errors
                }
            }
        }
    }

    shouldCrawl(url) {
        try {
            const urlObj = new URL(url);
            
            // Use centralized filter
            if (shouldFilter(url)) {
                this.logger.debug(`Skipping filtered URL: ${url}`);
                return false;
            }
            
            // Normalize URL
            urlObj.hash = '';
            urlObj.hostname = urlObj.hostname.replace(/^www\./, '');
            urlObj.pathname = urlObj.pathname.replace(/\/+$/, '');
            if ((urlObj.protocol === 'http:' && urlObj.port === '80') ||
                (urlObj.protocol === 'https:' && urlObj.port === '443')) {
                urlObj.port = '';
            }

            // Sort query parameters
            if (urlObj.search) {
                const searchParams = new URLSearchParams(urlObj.search);
                const sortedParams = Array.from(searchParams.entries())
                    .sort(([a], [b]) => a.localeCompare(b));
                urlObj.search = new URLSearchParams(sortedParams).toString();
            }
            
            const cleanUrl = urlObj.toString();
            const domain = urlObj.hostname;
            
            if (!domain.includes(process.env.ALLOWED_DOMAIN)) {
                this.logger.debug(`Skipping URL ${cleanUrl} - domain not allowed: ${domain}`);
                return false;
            }

            if (url !== cleanUrl) {
                this.logger.debug(`Normalized URL from ${url} to ${cleanUrl}`);
            }
            return cleanUrl;
        } catch (error) {
            this.logger.error(`Error checking URL ${url}:`, error);
            return false;
        }
    }

    async crawl() {
        try {
            await this.initialize();
            
            while (this.urlManager.hasNext() && !this.isShuttingDown) {
                const batch = this.urlManager.takeNext(this.options.maxConcurrent);
                this.logger.info(`Processing batch of ${batch.length} URLs`);
                
                await Promise.all(batch.map(urlInfo => this.processPage(urlInfo)));
                
                // Small delay between batches
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                this.logger.info(`Batch complete. Queue size: ${this.urlManager.queue.length}`);
                
                // Stop if queue is empty
                if (this.urlManager.queue.length === 0) {
                    this.logger.info('Queue is empty, stopping crawler');
                    break;
                }
            }
            
        } catch (error) {
            this.logger.error('Crawl error:', error);
        } finally {
            await this.shutdown();
        }
    }

    async shutdown() {
        if (this.isShuttingDown) {
            this.logger.info('Shutdown already in progress...');
            return;
        }
        
        this.isShuttingDown = true;
        this.logger.info('Shutting down crawler...');

        try {
            // Stop URL Manager first
            this.logger.info('Saving final crawler state...');
            await this.urlManager.shutdown();

            // Close browser
            this.logger.info('Closing browser...');
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }

            this.logger.info('Crawler shutdown complete');
            
            // Exit process if stopWhenEmpty is true
            if (this.stopWhenEmpty) {
                process.exit(0);
            }
        } catch (error) {
            this.logger.error('Error during shutdown:', error);
            process.exit(1);
        }
    }

    // Update signal handlers
    setupSignalHandlers() {
        const handleSignal = async (signal) => {
            this.logger.info(`Received ${signal} signal`);
            await this.shutdown();
        };

        process.on('SIGINT', () => handleSignal('SIGINT'));
        process.on('SIGTERM', () => handleSignal('SIGTERM'));
        process.on('SIGHUP', () => handleSignal('SIGHUP'));
    }
}

// Export the crawler
module.exports = {
    ContentCrawler
};