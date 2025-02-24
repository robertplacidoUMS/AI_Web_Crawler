let ws;

function connectWebSocket() {
    ws = new WebSocket(`ws://${window.location.host}`);
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
            updateLogs(data.data);
        } else {
            updateStats(data);
        }
    };
}

async function loadConfig() {
    const response = await fetch('/api/config');
    const config = await response.json();
    
    document.getElementById('envConfig').value = config.env;
    document.getElementById('termsConfig').value = JSON.stringify(config.terms, null, 2);
}

async function saveConfig() {
    const env = document.getElementById('envConfig').value;
    const terms = JSON.parse(document.getElementById('termsConfig').value);
    
    await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env, terms })
    });
}

async function startCrawler() {
    await fetch('/api/crawler/start', { method: 'POST' });
}

async function stopCrawler() {
    await fetch('/api/crawler/stop', { method: 'POST' });
}

function updateStats(stats) {
    document.getElementById('visitedCount').textContent = stats.visited;
    document.getElementById('queueSize').textContent = stats.queued;
    document.getElementById('inProgressCount').textContent = stats.inProgress;
}

function updateLogs(logData) {
    const logOutput = document.getElementById('logOutput');
    
    // Parse log lines if they're JSON
    const formattedLogs = logData.map(line => {
        try {
            const log = JSON.parse(line);
            const timestamp = new Date(log.timestamp).toLocaleTimeString();
            let message = log.message;
            
            // Color-code by log level
            let color = 'black';
            switch (log.level) {
                case 'error': color = 'red'; break;
                case 'warn': color = 'orange'; break;
                case 'info': color = 'blue'; break;
                case 'debug': color = 'gray'; break;
            }
            
            return `<div style="color: ${color}">
                <span class="timestamp">[${timestamp}]</span>
                <span class="level">[${log.level}]</span>
                <span class="message">${message}</span>
            </div>`;
        } catch (e) {
            // If not JSON, just return the raw line
            return `<div>${line}</div>`;
        }
    });

    logOutput.innerHTML = formattedLogs.join('');
    logOutput.scrollTop = logOutput.scrollHeight; // Auto-scroll to bottom
}

// Initialize
loadConfig();
connectWebSocket();
setInterval(async () => {
    const response = await fetch('/api/stats');
    const stats = await response.json();
    updateStats(stats);
}, 1000); 