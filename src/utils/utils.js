const path = require('path');

const getDomainPath = (domain) => {
    return path.join(process.cwd(), domain.replace(/^www\./, ''));
};

module.exports = {
    getDomainPath
}; 