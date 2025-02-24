// Extract and clean page content using consistent logic
async function extractPageContent(page) {
    return await page.evaluate(() => {
        // First try to find main content areas
        const mainSelectors = [
            'main',
            'article',
            '#main-content',
            '.main-content',
            '[role="main"]',
            // Fallback to specific content areas
            '.entry-content',
            '.post-content',
            '.page-content'
        ];

        // Remove script and style elements first
        document.querySelectorAll('script, style').forEach(el => el.remove());

        // Try to find main content
        let contentEl = null;
        for (const selector of mainSelectors) {
            contentEl = document.querySelector(selector);
            if (contentEl) break;
        }

        // If no main content found, use body but clean it
        if (!contentEl) {
            contentEl = document.body.cloneNode(true);
            
            // Remove non-content elements
            const elementsToRemove = [
                'nav', 'header', 'footer',
                '.navigation', '.nav', '.footer',
                '.menu', '#menu', '.sidebar', '#sidebar',
                '[role="navigation"]', '[role="complementary"]',
                '.nondiscrimination', '#nondiscrimination',
                '.copyright', '.legal',
                'style', 'script', 'iframe',
                '.tertiary-navigation-container',
                '.tribe-events-after-html'
            ];

            elementsToRemove.forEach(selector => {
                contentEl.querySelectorAll(selector).forEach(el => el.remove());
            });
        }

        // Get text content, removing extra whitespace
        const text = contentEl.textContent
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, '\n')
            .trim();

        return {
            text,
            length: text.length,
            firstChars: text.substring(0, 100)
        };
    });
}

module.exports = {
    extractPageContent
}; 