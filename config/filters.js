const path = require('path');

const skipDomains = [
    'catalog.',
    // University of Maine System block when running on a single domain ormaine.edu
    'umpi.maine.edu',
    'umf.maine.edu',
    'usm.maine.edu',
    'umaine.maine.edu',
    'uma.maine.edu',
    'umm.maine.edu',
    'umfk.maine.edu',
    'mainelaw.maine.edu',
    'umpi.edu',
    'umf.edu',
    'usm.edu',
    'umaine.edu',
    'uma.edu',
    'umm.edu',
    'umfk.edu',
    // University of Maine System block when running on a single domain ormaine.edu
    'cloudfront.net',
    'cdn.',
    'static.',
    'library.',
    'libguides.',
    'calendar.',
    'gradcatalog.',
    'digitalcommons.',
    'archives.',
    'lib.',
    'umaine.edu/citl',
    'bookstore.umaine.edu',
    'composites-archive.',
    'go.umaine.edu',
    'astro.umaine.edu',
    'shop.usm.maine.edu', 
    'libanswers.usm.maine.edu',
    'owls.umpi.edu',
    'wp.umpi.edu',
    'umalibguides.uma.edu',
    'store.umf.maine.edu',
    'scholarworks.umf.maine.edu',
    'intermedia.umaine.edu'
];

const skipUrlPatterns = [
    '/events/month/',
    '/news/tag',
    '/directories/',
    '/directory/',
    '/events/week/',
    '/events/day/',
    '/do/',
    '/calendar/',
    '/special-collections/',
    '/calendar-of-events/',
    'outlook-ical=',
    'ical=',
    'vcalendar=',
    '.ics',
    '/feed/',
    '/rss/',
    '/atom/',
    '/events/category/',
    'eventDisplay=',
    'tribe-bar-date=',
    '/news/blog',
    '/wp-admin',
    '/events/',
    '/senate-minutes',
    '/exhibits/',
    '/resource/',
    '/ipm/ipddl',
    '/event$',
    '/blog/',
    'business/events',
    'campusrecreation/events',
    'mlandc/events', 
    'graduate/events',
    'facultysenate/senate-minutes',
    'hudsonmuseum/exhibits',
    'research-development/events',
    'research-compliance/resource',
    'mitchellcenter/event',
    'marketingandcommunications/resource'
];

const skipFilePatterns = [
    '/download_file',
    '/download.',
    '/download/',
    '/downloads/',
    '.ashx',
    '/services/download',
    '/file/',
    '/files/',
    '/getfile',
    '/get-file',
    '/serve-file',
    '/stream/',
    '/media/',
    '/assets/',
    '/cdn-cgi/'
];

const skipFileParams = [
    'file',
    'download', 
    'attachment',
    'doc',
    'document',
    'pdf'
];

const skipExtensions = [
    // Documents
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
    '.txt', '.rtf', '.csv', '.xml', '.json', '.ashx',
    // Media
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.ico',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.wmv', '.webm',
    '.ogg', '.flv', '.mkv', '.m4v', '.m4a',
    // Web assets
    '.css', '.js', '.map', '.woff', '.woff2', '.ttf', '.eot',
    '.less', '.scss', '.sass',
    // Archives
    '.zip', '.rar', '.tar', '.gz', '.7z', '.bz2', '.iso',
    // Other
    '.exe', '.dll', '.bin', '.dat', '.log', '.bak', '.tmp',
    '.cache', '.swf'
];

function shouldFilter(urlString) {
    try {
        const urlObj = new URL(urlString);
        
        // Check domain patterns
        if (skipDomains.some(domain => {
            // Match exact domain or any subdomain
            return urlObj.hostname === domain || 
                   urlObj.hostname.endsWith('.' + domain) ||
                   domain.endsWith('.' + urlObj.hostname);
        })) {
            return true;
        }

        // Check file extensions
        const ext = path.extname(urlObj.pathname).toLowerCase();
        if (skipExtensions.includes(ext)) {
            return true;
        }

        // Check URL patterns
        const fullPath = (urlObj.hostname + urlObj.pathname).toLowerCase();
        if (skipUrlPatterns.some(pattern => {
            pattern = pattern.toLowerCase();
            return fullPath.includes(pattern) || 
                   urlObj.search.toLowerCase().includes(pattern);
        })) {
            return true;
        }

        // Check file patterns
        if (skipFilePatterns.some(pattern => 
            urlObj.pathname.toLowerCase().includes(pattern) || 
            urlObj.search.toLowerCase().includes(pattern) ||
            urlObj.hostname.toLowerCase().includes(pattern))) {
            return true;
        }

        // Check file-related query parameters
        const searchParams = new URLSearchParams(urlObj.search);
        for (const [key, value] of searchParams.entries()) {
            if (skipFileParams.some(param => 
                key.toLowerCase().includes(param) || 
                value.toLowerCase().includes(param))) {
                return true;
            }
        }

        return false;
    } catch (error) {
        console.error(`Invalid URL: ${urlString}`);
        return true;  // Filter invalid URLs
    }
}

module.exports = {
    skipDomains,
    skipUrlPatterns,
    skipFilePatterns,
    skipFileParams,
    skipExtensions,
    shouldFilter
}; 