const winston = require('winston');
const path = require('path');
const { getDomainPath } = require('./utils');

// Configure system logger
const systemLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'logs', 'error.log'), 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'logs', 'system.log')
        }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// Configure match logger
const matchLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(getDomainPath(process.env.ALLOWED_DOMAIN), 'logs', 'matches', 'dei_matches.log')
        })
    ]
});

module.exports = {
    systemLogger,
    matchLogger
}; 