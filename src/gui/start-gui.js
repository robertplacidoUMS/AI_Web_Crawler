const { CrawlerGUI } = require('./server');

async function main() {
    const gui = new CrawlerGUI();
    const PORT = process.env.GUI_PORT || 3000;
    
    try {
        await gui.listen(PORT);

        // Handle process termination
        process.on('SIGINT', async () => {
            console.log('\nReceived SIGINT. Shutting down...');
            await gui.cleanup();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\nReceived SIGTERM. Shutting down...');
            await gui.cleanup();
            process.exit(0);
        });

    } catch (error) {
        console.error('Failed to start GUI server:', error);
        process.exit(1);
    }
}

main(); 