# Web Crawler with AI Analysis

A sophisticated web crawler system designed for automated web content discovery and analysis. Starting from a specified URL, the crawler:
1. Reads and processes the initial webpage
2. Extracts all hyperlinks from the page
3. Filters links based on configurable rules
4. Builds a queue of valid URLs to crawl
5. Recursively processes each queued URL
6. Performs content analysis on discovered pages

The system combines intelligent crawling with AI-powered content verification, making it particularly effective for identifying specific types of content across large website hierarchies. While currently configured for DEI content analysis, the architecture is designed to be adaptable for other content discovery and analysis needs.

## Core Components

1. **Smart Crawler**
   - Starts from a user-specified URL
   - Intelligently traverses website hierarchies
   - Builds and manages URL processing queues
   - Filters and normalizes discovered URLs
   - Maintains crawl state for recovery
   - Processes page content in real-time

2. **AI Analysis Engine**
   - Google Gemini AI integration
   - Content verification and classification
   - Smart rate limiting and quota management
   - Multi-format result logging
   - Automated retry mechanisms

3. **Queue Management**
   - Separate queues for crawling and AI analysis
   - State persistence across restarts
   - Intelligent cleanup and optimization
   - Performance monitoring and reporting

## Current Implementation
Currently configured to identify and analyze Diversity, Equity, and Inclusion (DEI) content across educational websites, but the architecture is designed to be adaptable for other content discovery and analysis needs.

## Features

### Crawler
- Domain-specific crawling with configurable depth and concurrency
- Smart URL filtering and pattern matching
- Robust error handling and retry mechanisms
- State persistence for crash recovery
- Resource-efficient page processing
- DEI keyword matching and context extraction

### Advanced Crawling Features
- Intelligent URL normalization and deduplication
- Domain-specific configuration support
- Automatic request filtering for improved performance
- Graceful handling of timeouts and network errors
- Configurable concurrent processing
- Automatic recovery of interrupted crawls
- Real-time logging and monitoring

### Resource Management
- Configurable concurrent connections
- Smart request interception and filtering
- Memory-efficient URL tracking
- Automatic state persistence
- Graceful shutdown handling

### Logging and Monitoring
- Detailed system logging with Winston
- Separate logging for DEI matches
- Debug-level request tracking
- Error tracking and reporting
- State monitoring and statistics

### AI Analysis
- Integration with Google's Gemini AI
- Intelligent content analysis for DEI relevance
- Rate limiting and quota management
- Exponential backoff for API limits
- Separate processing queue
- Detailed match logging

## AI Analysis System
The crawler implements a sophisticated AI analysis system in `src/ai-analyzer.js` that processes and confirms potential matches:

### Queue Processing
- Separate queue system for AI analysis
- State persistence for crash recovery
- Configurable concurrent processing
- Automatic retry mechanism for failed analyses
- Intelligent rate limiting and quota management

### AI Analysis Features
- Uses Google's Gemini AI model (gemini-2.0-flash-lite-preview)
- Contextual analysis of content
- Smart content truncation (3000 character limit)
- Exponential backoff for rate limits
- Quota monitoring and management

### Analysis Results
The AI analyzer produces two types of responses:
- "DEI Content Found:" - Followed by detailed analysis
- "Not DEI Content" - For non-relevant content

### Result Logging
Results are stored in multiple formats:

## URL Filtering System
The crawler implements a comprehensive filtering system in `config/filters.js` that optimizes crawling efficiency by filtering out unwanted URLs. The system uses five main filtering categories:

### 1. Domain Filtering
Automatically excludes specific subdomains and service domains:
- catalog.* - Course catalogs
- cdn.*, static.* - Content delivery networks
- library.* - Library services
- calendar.* - Calendar services
- archives.* - Archive services

### 2. URL Pattern Filtering
Skips URLs containing specific patterns:
- /events/month/ - Calendar views
- /feed/, /rss/ - Feed endpoints
- /wp-admin/ - Admin interfaces
- /blog/ - Blog sections
- /senate-minutes/ - Specific content sections

### 3. File Pattern Filtering
Excludes common file-related paths:
- /download/ - Download endpoints
- /files/ - File repositories
- /media/ - Media directories
- /assets/ - Asset directories
- /cdn-cgi/ - CDN paths

### 4. Query Parameter Filtering
Filters URLs with specific query parameters:
- file= - File downloads
- download= - Download requests
- attachment= - Attachments
- document= - Document viewers

### 5. File Extension Filtering
Excludes specific file types:
- Documents: .pdf, .doc, .docx, .ppt, .xls
- Media: .jpg, .mp3, .mp4, .wav
- Web Assets: .css, .js, .map, .woff
- Archives: .zip, .tar, .gz
- System: .exe, .dll, .log

#### Cleanup Process
1. **State Validation**
   - Verifies queue structure
   - Validates URL formats
   - Checks state file integrity

2. **URL Filtering**
   - Applies current filter rules
   - Removes URLs matching filter patterns
   - Updates visited URL list
   - Cleans AI queue entries

3. **State Management**
   - Preserves valid queue entries
   - Updates crawler state
   - Maintains AI queue consistency
   - Saves cleaned state files

4. **Reporting**
   - Shows original queue sizes
   - Reports removed URL count
   - Lists example filtered URLs
   - Displays final queue statistics

This utility helps maintain crawler efficiency by periodically cleaning the queues of unwanted URLs that match the current filtering rules.

#### Reports Generated

1. **Domain Statistics**
   ```
   Domain: count URLs
   example.edu: 1000 URLs
   subdomain.example.edu: 500 URLs
   ```

2. **Path Pattern Analysis**
   ```
   /pattern: count URLs
   /events: 200 URLs
   /news: 150 URLs
   ```

3. **Error Pattern Summary**
   ```
   domain.edu (total errors)
   - Timeout: count
   - Quota: count
   - Navigation: count
   ```

4. **Filter Suggestions**
   ```
   Potential patterns to consider:
   /calendar.*  # 100 URLs
   /events.*    # 150 URLs
   ```

This utility helps monitor crawler performance, identify issues, and optimize filtering rules based on actual crawl data.

## Project Structure
```
project-root/
├── config/
│   ├── filters.js     # URL filtering rules and patterns
│   └── prompts.js     # AI analysis prompt configurations
├── src/
│   ├── ai-analyzer.js
│   ├── crawler.js
│   └── utils/
│       └── content-extractor.js
├── .env               # Environment configuration
├── .gitignore        # Git ignore rules
└── README.md         # Project documentation
```

## Configuration

### Environment Variables
The crawler can be configured through environment variables:
- `START_URL`: Initial URL to begin crawling
- `ALLOWED_DOMAIN`: Domain restriction for crawling
- `MAX_CONCURRENT`: Maximum concurrent page processing
- `MAX_DEPTH`: Maximum crawl depth from start URL
- `MAX_RETRIES`: Maximum retry attempts for failed requests
- `PAGE_TIMEOUT`: Page load timeout in milliseconds
- `LOG_LEVEL`: Logging verbosity level

### AI Prompt Configuration
The system uses a configurable prompt system in `config/prompts.js` that structures how the AI analyzes content:

```javascript
// Example prompt configuration
const DEI_PROMPT = {
    preamble: `
        Analyze this webpage content to determine if it is about Diversity, 
        Equity, and Inclusion (DEI) topics.
        
        Content to analyze:
    `,
    
    instructions: `
        Focus your analysis on identifying:
        1. Is this content primarily about DEI topics?
        2. What specific DEI themes or initiatives are discussed?
        3. Is this content meant to be a resource or information about DEI?
        
        Format your response EXACTLY as follows:
        - If the content is primarily about DEI topics, start your response with EXACTLY:
          "AI_Crawler: Content Found:" followed by your description
        - If the content is not primarily about DEI topics, respond with EXACTLY:
          "AI_Crawler: Not Content"
    `
};
```

#### Prompt Structure
- **Preamble**: Initial instructions and context given to the AI
- **Content**: Automatically inserted webpage content (limited to 3000 characters)
- **Instructions**: Specific analysis requirements and response format

#### Customizing Prompts
To modify how the AI analyzes content:
1. Edit `config/prompts.js`
2. Adjust the preamble for different analysis contexts
3. Modify instructions for different response formats
4. Update the expected response markers as needed

## Domain-Specific Settings
The crawler supports custom configurations for specific domains:
- Custom timeout values
- Request interception settings
- Page load strategies
- SSL/Certificate handling
- Custom navigation options

## Contributing
[... existing content ...]

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Copyright (c) 2024 Robert Placido - University of Maine System

## Author
Robert Placido

## Getting Started

### Prerequisites
1. Install Visual Studio Code
   - Download from [https://code.visualstudio.com/](https://code.visualstudio.com/)
   - Install with default settings

2. Install Git
   - Download from [https://git-scm.com/](https://git-scm.com/)
   - Install with default settings

3. Install Node.js
   - Download LTS version from [https://nodejs.org/](https://nodejs.org/)
   - Install with default settings

### Installation

1. Clone the repository
```bash
git clone https://github.com/your-repo/web-crawler.git
cd web-crawler
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables
   - Copy `.env.example` to `.env`
   - Update variables with your settings:
     - `START_URL`: Your starting URL
     - `ALLOWED_DOMAIN`: Domain to crawl
     - `GOOGLE_API_KEY`: Your Gemini AI API key
     - `prompt`: Your Gemini AI prompt

### Usage Commands

1. Start the crawler:
```bash
npm run crawl
```

2. Run AI analysis on found content:
```bash
npm run ai
```

3. Clean the URL queues with new filters:
```bash
npm run clean
```

4. Analyze queue statistics:
```bash
npm run queuestats
```

5. Emergency stop (Windows):
```bash
npm run kill
```

### Typical Workflow
   - Update variables with your settings:
     - `START_URL`: www.example.edu
     - `ALLOWED_DOMAIN`: example.edu
     - `GOOGLE_API_KEY`: Your Gemini AI API key
Set filters in config/filters.js
For example:
const skipDomains = [
    'library.',
    'libguides.',
    'calendar.',
    'gradcatalog.',
    'digitalcommons.',
    'archives.',
    'lib.',
    'cloudfront.net']

Set prompt in config/prompts.js
For example:
const DEI_PROMPT = {
    preamble: `
        Analyze this webpage content to determine if it is about Diversity, 
        Equity, and Inclusion (DEI) topics.



1. Edit your environment variables:
```bash
npm run crawl
```

2. stop crawl after some time by Cntl+C
```bash
npm run queuestats
```
Examine the results for filters you may want to add to the filters index.js file.

3. If you create new filters after a crawl has started, you can clean the URL queues with new filters:
```bash
npm run clean
```

4. After some time, stop the crawl and start AI analysis:
```bash
npm run ai
```
