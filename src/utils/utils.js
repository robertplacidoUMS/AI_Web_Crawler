const path = require('path');

const getDomainPath = (domain) => {
    if (!process.env.CRAWL_OUTPUT_DIR) {
        throw new Error('CRAWL_OUTPUT_DIR environment variable is not set');
    }
    return path.join(process.cwd(), process.env.CRAWL_OUTPUT_DIR, domain.replace(/^www\./, ''));
};

module.exports = {
    getDomainPath
}; 