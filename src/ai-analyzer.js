const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const winston = require('winston');
const { getDomainPath } = require('./utils/utils');
const puppeteer = require('puppeteer');
const { extractPageContent } = require('./utils/content-extractor');
const { DEI_PROMPT } = require('../config/prompts');
require('dotenv').config();

// Configure AI-specific loggers
const aiSystemLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp }) => {
            return `${timestamp} ${level}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'logs', 'ai', 'error.log'), 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'logs', 'ai', 'system.log')
        }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

const aiMatchLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'logs', 'ai', 'matches', 'ai_matches.log')
        })
    ]
});

// Create AI log directories
(async () => {
    const domain = process.env.ALLOWED_DOMAIN;
    const basePath = getDomainPath(domain);
    await fs.mkdir(path.join(basePath, 'logs', 'ai', 'matches'), { recursive: true });
})();

class AIAnalyzer {
    constructor() {
        this.logger = aiSystemLogger;
        this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        this.aiRequestDelay = parseInt(process.env.AI_REQUEST_DELAY) || 2000;
        this.maxRetries = parseInt(process.env.AI_MAX_RETRIES) || 3;
        this.lastRequest = Date.now();
        this.browser = null;
        this.quotaExceeded = false;
        this.maxQueueRetries = 3;
        this.cooldownAttempts = 0;
        this.maxCooldownAttempts = 3;
        this.baseDelay = 60000; // 1 minute base delay
        this.stopWhenEmpty = process.env.STOP_WHEN_EMPTY !== 'false';
        this.requestDelay = parseInt(process.env.AI_REQUEST_DELAY) || 2000;
        this.consecutiveErrors = 0;
        this.maxConsecutiveErrors = 3;
        this.isProcessing = false;  // Add processing lock
        this.consecutiveQuotaErrors = 0;  // Track quota errors specifically
        this.maxConsecutiveQuotaErrors = 3;
        this.baseQuotaDelay = 60000;  // 1 minute base delay for quota issues

        // Track browser pages
        this.pages = new Set();

        // Improve signal handling
        const shutdown = async (signal) => {
            this.logger.info(`Received ${signal} signal`);
            await this.shutdown();
            // Force exit after 5 seconds if graceful shutdown fails
            setTimeout(() => {
                this.logger.error('Forced exit after timeout');
                process.exit(1);
            }, 5000);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        // Handle Windows specific signals
        process.on('SIGHUP', () => shutdown('SIGHUP'));
    }

    async initialize() {
        const statePath = path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'state', 'ai-state.json');
        
        try {
            const stateData = await fs.readFile(statePath, 'utf8');
            this.state = JSON.parse(stateData);
        } catch (error) {
            this.state = {
                processed: [],
                failed: [],
                lastProcessed: null
            };
        }
        
        // Initialize browser
        this.browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox']
        });

        // Check for last processed URL
        if (this.state.lastProcessed) {
            this.logger.info(`Resuming from last processed URL: ${this.state.lastProcessed}`);
        }
    }

    async saveState() {
        const statePath = path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'state', 'ai-state.json');
        await fs.writeFile(statePath, JSON.stringify(this.state, null, 2));
    }

    async processQueue() {
        if (this.isProcessing) {
            this.logger.debug('Queue is already being processed, skipping...');
            return;
        }

        this.isProcessing = true;
        const queuePath = path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'state', 'ai_queue.json');
        
        try {
            this.logger.info('Checking AI queue...');
            
            try {
                await fs.access(queuePath);
                this.logger.info('Found queue file');
            } catch (error) {
                this.logger.info('Creating new queue file');
                await fs.writeFile(queuePath, JSON.stringify([]));
                if (this.stopWhenEmpty) {
                    this.logger.info('Queue is empty and STOP_WHEN_EMPTY is true, shutting down');
                    await this.shutdown();
                    process.exit(0);
                }
                return;
            }

            const queueData = await fs.readFile(queuePath, 'utf8');
            let queue = JSON.parse(queueData);
            
            this.logger.info(`Queue contains ${queue.length} total items`);
            const pendingCount = queue.filter(item => 
                !item.status || item.status === 'pending'
            ).length;
            this.logger.info(`Found ${pendingCount} pending items to process`);

            if (queue.length === 0 || pendingCount === 0) {
                this.logger.info('No pending items in queue');
                if (this.stopWhenEmpty) {
                    this.logger.info('Queue is empty and STOP_WHEN_EMPTY is true, shutting down');
                    await this.shutdown();
                    process.exit(0);
                }
                return;
            }

            const itemsToKeep = [];
            let processedCount = 0;
            let failedCount = 0;

            for (const item of queue) {
                if (item.status === 'completed' || 
                    item.status === 'failed' || 
                    this.state.processed.includes(item.url)) {
                    continue;
                }

                this.logger.info(`Processing: ${item.url}`);
                
                try {
                    // Add current item to state before processing
                    // so we know where to resume
                    this.state.lastProcessed = item.url;
                    await this.saveState();

                    const aiResult = await this.analyzeWithAI(item.content, item.url);
                    processedCount++;
                    
                    // Reset cooldown attempts after successful request
                    this.cooldownAttempts = 0;
                    
                    if (aiResult && aiResult.startsWith('AI_Crawler: Content Found')) {
                        this.logger.info(`Content Found: ${item.url}`);
                        await this.logMatch({
                            url: item.url,
                            title: item.title,
                            terms: item.terms,
                            aiAnalysis: aiResult,
                            timestamp: new Date().toISOString()
                        });
                    } else {
                        this.logger.info(`No Content Found in: ${item.url}`);
                    }
                    
                    // Don't keep successfully processed items
                    this.state.processed.push(item.url);
                    await this.saveState();
                    
                } catch (error) {
                    failedCount++;
                    item.retry_count = (item.retry_count || 0) + 1;
                    
                    if (error.status === 429) {  // Rate limit
                        // Add current failed item to keep list
                        itemsToKeep.push(item);
                        // Then add remaining items
                        itemsToKeep.push(...queue.slice(queue.indexOf(item) + 1));
                        
                        this.quotaExceeded = true;
                        this.cooldownAttempts++;
                        
                        if (this.cooldownAttempts >= this.maxCooldownAttempts) {
                            this.logger.error(`AI quota exceeded ${this.cooldownAttempts} times, stopping process`);
                            await this.shutdown();
                            process.exit(1);
                        }

                        const backoffDelay = this.baseDelay * Math.pow(2, this.cooldownAttempts - 1);
                        this.logger.warn(`AI quota exceeded, cooldown attempt ${this.cooldownAttempts}/${this.maxCooldownAttempts}. Waiting ${backoffDelay/1000} seconds...`);
                        
                        await new Promise(resolve => {
                            setTimeout(() => {
                                this.quotaExceeded = false;
                                this.logger.info(`Cooldown complete, resuming processing after ${backoffDelay/1000} seconds`);
                                resolve();
                            }, backoffDelay);
                        });
                        
                        break;  // Stop processing queue
                    }
                    
                    if (item.retry_count >= this.maxQueueRetries) {
                        this.logger.error(`Failed to process ${item.url} after ${item.retry_count} attempts`);
                        this.state.failed.push(item.url);
                    } else {
                        // Keep items that still have retries left
                        itemsToKeep.push(item);
                    }
                }
            }

            this.logger.info(`Processing complete. Processed: ${processedCount}, Failed: ${failedCount}, Remaining: ${itemsToKeep.length}`);
            
            // Save queue
            await fs.writeFile(queuePath, JSON.stringify(itemsToKeep, null, 2));

        } catch (error) {
            this.logger.error(`Error processing AI queue: ${error.message}`);
        } finally {
            this.isProcessing = false;  // Release lock
        }
    }

    async analyzeWithAI(content, url, retryCount = 0) {
        try {
            // Basic rate limiting
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequest;
            if (timeSinceLastRequest < this.requestDelay) {
                const waitTime = this.requestDelay - timeSinceLastRequest;
                this.logger.info(`Rate limiting: waiting ${waitTime}ms before next request`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            // Track request time BEFORE making request
            this.lastRequest = Date.now();

            const model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite-preview-02-05" });
            
            const prompt = `
                ${DEI_PROMPT.preamble}
                ${content.substring(0, 3000)}
                ${DEI_PROMPT.instructions}
            `;

            const result = await model.generateContent(prompt);
            
            // Reset quota error count on success
            this.consecutiveQuotaErrors = 0;
            
            return result.response.text();

        } catch (error) {
            if (error.status === 429) {
                this.consecutiveQuotaErrors++;
                
                if (this.consecutiveQuotaErrors >= this.maxConsecutiveQuotaErrors) {
                    // Enter longer cooldown if we keep hitting quota
                    const cooldownTime = this.baseQuotaDelay * Math.pow(2, this.consecutiveQuotaErrors - 1);
                    this.logger.warn(`${this.consecutiveQuotaErrors} consecutive quota errors, entering ${cooldownTime/1000}s cooldown`);
                    await new Promise(resolve => setTimeout(resolve, cooldownTime));
                    return this.analyzeWithAI(content, url, 0);  // Retry with reset retryCount
                }

                if (retryCount < this.maxRetries) {
                    const delay = Math.pow(2, retryCount) * 1000;
                    this.logger.warn(`AI quota exceeded for ${url}, retrying in ${delay}ms... (Consecutive: ${this.consecutiveQuotaErrors})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.analyzeWithAI(content, url, retryCount + 1);
                }
                
                throw error;
            }
            throw error;
        }
    }

    async logMatch(data) {
        try {
            const timestamp = new Date().toISOString();
            const baseDir = path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'logs', 'ai', 'matches');
            await fs.mkdir(baseDir, { recursive: true });

            // Format date and time for Excel
            const dateObj = new Date();
            const dateFound = dateObj.toLocaleDateString();
            const timeFound = dateObj.toLocaleTimeString();

            // Prepare CSV row data
            const csvData = {
                Date: dateFound,
                Time: timeFound,
                URL: data.url,
                Title: data.title || 'No Title',
                'Matched Terms': data.terms.join('; '),
                'AI Analysis': data.aiAnalysis.replace(/[\r\n]+/g, ' '),
                'Timestamp': timestamp
            };

            // Save to AI-specific CSV
            const csvPath = path.join(baseDir, 'ai_matches.csv');
            let csvExists = false;
            try {
                await fs.access(csvPath);
                csvExists = true;
            } catch (error) {
                // File doesn't exist
            }

            // Create CSV header if file doesn't exist
            if (!csvExists) {
                const header = Object.keys(csvData).join(',') + '\n';
                await fs.writeFile(csvPath, header, 'utf-8');
            }

            // Add new row to CSV
            const csvRow = Object.values(csvData).map(value => {
                if (value === null || value === undefined) return '';
                value = String(value).replace(/"/g, '""');
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    value = `"${value}"`;
                }
                return value;
            }).join(',') + '\n';

            await fs.appendFile(csvPath, csvRow, 'utf-8');

            // Log to AI-specific JSON file
            const jsonPath = path.join(baseDir, 'ai_matches.json');
            let matches = [];
            try {
                const jsonData = await fs.readFile(jsonPath, 'utf8');
                matches = JSON.parse(jsonData);
            } catch (error) {
                // File doesn't exist or is invalid
            }

            matches.push({
                ...data,
                timestamp
            });

            await fs.writeFile(jsonPath, JSON.stringify(matches, null, 2));

            // Already using AI-specific logger
            aiMatchLogger.info('DEI Match Found', {
                url: data.url,
                title: data.title,
                terms: data.terms,
                aiAnalysis: data.aiAnalysis
            });

        } catch (error) {
            this.logger.error(`Error logging match: ${error.message}`);
            throw error;
        }
    }

    async shutdown() {
        this.logger.info('Shutting down AI analyzer...');
        try {
            // Save current state
            await this.saveState();
            
            // Close all browser pages
            for (const page of this.pages) {
                try {
                    await page.close();
                } catch (error) {
                    this.logger.error(`Error closing page: ${error.message}`);
                }
            }
            
            // Close browser
            if (this.browser) {
                try {
                    await this.browser.close();
                } catch (error) {
                    this.logger.error(`Error closing browser: ${error.message}`);
                    // Force kill if graceful close fails
                    process.kill(this.browser.process().pid);
                }
            }
            
            this.logger.info('Shutdown complete');
            process.exit(0);
        } catch (error) {
            this.logger.error('Error during shutdown:', error);
            process.exit(1);
        }
    }
}

// Start the analyzer
async function main() {
    const analyzer = new AIAnalyzer();
    await analyzer.initialize();
    
    while (true) {
        await analyzer.processQueue();
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds between queue checks
    }
}

main().catch(error => {
    aiSystemLogger.error('AI Analyzer error:', error);
    process.exit(1);
});

module.exports = {
    AIAnalyzer
}; 