const { GoogleGenerativeAI } = require('@google/generative-ai');
const puppeteer = require('puppeteer');
require('dotenv').config();

async function getPageContent(url) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.goto(url);

        // Use a more targeted content extraction
        const content = await page.evaluate(() => {
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
                    '.tertiary-navigation-container'
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
                title: document.title
            };
        });

        return content;

    } finally {
        await browser.close();
    }
}

async function testAI() {
    try {
        const url = 'https://extension.umaine.edu/podcasts/maine-farmcast/episode-38';
        console.log('Fetching content from:', url);
        
        const content = await getPageContent(url);
        console.log('\nPage Title:', content.title);
        
        // Show full extracted content
        console.log('\nFull Extracted Content:');
        console.log('======================');
        console.log(content.text);
        console.log('======================\n');

        // Show what will be sent to AI (first 3000 chars)
        const contentForAI = content.text.substring(0, 3000);
        console.log('Content being sent to AI (first 3000 chars):');
        console.log('======================');
        console.log(contentForAI);
        console.log('======================\n');

        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite-preview-02-05" });

        const prompt = `
            Analyze this webpage content to determine if it is about Diversity, Equity, and Inclusion (DEI) topics.
            
            Content to analyze: "${contentForAI}"
            
            Focus your analysis on identifying:
            1. Is this content primarily about DEI topics?
            2. What specific DEI themes or initiatives are discussed?
            3. Is this content meant to be a resource or information about DEI?
            
            Format your response EXACTLY as follows:
            - If the content is primarily about DEI topics, start your response with EXACTLY:
              "DEI Content Found:" followed by your description
            - If the content is not primarily about DEI topics, respond with EXACTLY:
              "Not DEI Content"
        `;

        console.log('Sending content to AI for analysis...');
        const result = await model.generateContent(prompt);
        const response = result.response;
        console.log('\nAI Response:', response.text());
        console.log('\nTest completed successfully');

    } catch (error) {
        console.error('AI Test Error:', error);
        if (error.status === 429) {
            console.log('\nQuota exceeded - need to wait before making more requests');
        }
    }
}

testAI(); 