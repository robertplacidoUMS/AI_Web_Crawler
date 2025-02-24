const express = require('express');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const path = require('path');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const http = require('http');

// Load environment variables
dotenv.config();

class CrawlerGUI {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.crawlerProcess = null;
        this.watchers = {};
        
        // Validate required environment variables
        if (!process.env.ALLOWED_DOMAIN) {
            throw new Error('ALLOWED_DOMAIN environment variable is required');
        }
        
        this.setupRoutes();
        this.setupWebsocket();

        // Add process cleanup handlers
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
        process.on('exit', () => this.cleanup());
    }

    setupRoutes() {
        // Serve static frontend files
        this.app.use(express.static('src/gui/public'));
        this.app.use(express.json());

        // API endpoints
        this.app.get('/api/config', this.getConfig.bind(this));
        this.app.post('/api/config', this.updateConfig.bind(this));
        this.app.post('/api/crawler/start', this.startCrawler.bind(this));
        this.app.post('/api/crawler/stop', this.stopCrawler.bind(this));
        this.app.get('/api/stats', this.getStats.bind(this));
    }

    setupWebsocket() {
        this.wss = new WebSocket.Server({ server: this.server });
        
        this.wss.on('connection', (ws) => {
            console.log('New WebSocket connection');
            
            ws.on('error', console.error);
        });
    }

    async getConfig(req, res) {
        const env = await fs.readFile('.env', 'utf8');
        const terms = require('../../config/search-terms.js');
        res.json({ env, terms });
    }

    async updateConfig(req, res) {
        const { env, terms } = req.body;
        await fs.writeFile('.env', env);
        await fs.writeFile(
            'config/search-terms.js', 
            `module.exports = ${JSON.stringify(terms, null, 2)}`
        );
        res.json({ success: true });
    }

    async startCrawler(req, res) {
        if (this.crawlerProcess) {
            res.status(400).json({ error: 'Crawler already running' });
            return;
        }

        this.crawlerProcess = spawn('node', ['start.js'], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Watch logs and state
        this.setupWatchers();

        res.json({ success: true });
    }

    setupWatchers() {
        const domain = process.env.ALLOWED_DOMAIN;
        const basePath = path.join(process.cwd(), domain);

        // Watch state file
        this.watchers.state = chokidar.watch(
            path.join(basePath, 'state', 'crawler-state.json')
        ).on('change', this.handleStateChange.bind(this));

        // Watch logs
        this.watchers.logs = chokidar.watch(
            path.join(basePath, 'logs', '**', '*.log')
        ).on('change', this.handleLogChange.bind(this));
    }

    async getStats(req, res) {
        try {
            const domain = process.env.ALLOWED_DOMAIN;
            if (!domain) {
                throw new Error('ALLOWED_DOMAIN environment variable is not set');
            }

            const statePath = path.join(process.cwd(), domain, 'state', 'crawler-state.json');
            
            // Check if state file exists
            try {
                await fs.access(statePath);
            } catch (error) {
                // Return empty stats if file doesn't exist
                return res.json({
                    visited: 0,
                    queued: 0,
                    inProgress: 0,
                    isRunning: !!this.crawlerProcess
                });
            }
            
            const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
            res.json({
                visited: state.visited.length,
                queued: state.queue.length,
                inProgress: state.inProgress.length,
                isRunning: !!this.crawlerProcess
            });
        } catch (error) {
            console.error('Error getting stats:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async stopCrawler(req, res) {
        if (!this.crawlerProcess) {
            res.status(400).json({ error: 'Crawler not running' });
            return;
        }

        this.crawlerProcess.kill();
        this.crawlerProcess = null;

        // Clean up watchers
        Object.values(this.watchers).forEach(watcher => watcher.close());
        this.watchers = {};

        res.json({ success: true });
    }

    handleStateChange(path) {
        fs.readFile(path, 'utf8')
            .then(data => {
                const state = JSON.parse(data);
                // Broadcast state update to all connected clients
                this.wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            visited: state.visited.length,
                            queued: state.queue.length,
                            inProgress: state.inProgress.length
                        }));
                    }
                });
            })
            .catch(error => console.error('Error reading state file:', error));
    }

    handleLogChange(path) {
        fs.readFile(path, 'utf8')
            .then(data => {
                const lines = data.split('\n').slice(-100); // Get last 100 lines
                // Broadcast log update to all connected clients
                this.wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'log',
                            data: lines
                        }));
                    }
                });
            })
            .catch(error => console.error('Error reading log file:', error));
    }

    async cleanup() {
        console.log('Cleaning up GUI server...');
        
        // Kill crawler process if running
        if (this.crawlerProcess) {
            console.log('Stopping crawler process...');
            this.crawlerProcess.kill('SIGTERM');
            this.crawlerProcess = null;
        }

        // Close all watchers
        if (this.watchers) {
            console.log('Closing file watchers...');
            Object.values(this.watchers).forEach(watcher => watcher.close());
            this.watchers = {};
        }

        // Close WebSocket server
        if (this.wss) {
            console.log('Closing WebSocket connections...');
            this.wss.close();
        }

        // Close HTTP server
        if (this.server) {
            console.log('Closing HTTP server...');
            this.server.close();
        }

        console.log('Cleanup complete');
    }

    listen(port) {
        return new Promise((resolve) => {
            this.server.listen(port, () => {
                console.log(`Crawler GUI running at http://localhost:${port}`);
                resolve();
            });
        });
    }
}

module.exports = { CrawlerGUI }; 