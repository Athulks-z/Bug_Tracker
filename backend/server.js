const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { loadConfig } = require('./config');
const config = loadConfig();

const app = express();

const path = require('path');

// Middleware
app.use(helmet());
app.use(cors({
    origin(origin, callback) {
        if (!origin || config.clientOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin not allowed by CORS'));
    },
    exposedHeaders: ['X-Total-Count'],
    credentials: true
}));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many authentication attempts. Please try again later.' }
});
app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use(express.json({ limit: config.jsonLimit }));

// Health Check
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health/ready', async (req, res) => {
    try {
        await require('./config/db').query('SELECT 1');
        res.status(200).json({ status: 'ready' });
    } catch (err) {
        console.error('Database readiness check failed:', err.name);
        res.status(503).json({ status: 'unavailable' });
    }
});

// Route Loading
try {
    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/assignments', require('./routes/assignments'));

    app.use('/api/users', require('./routes/users'));

    app.use('/api/projects', require('./routes/projects'));


    app.use('/api/templates', require('./routes/templates'));

    app.use('/api/tasks', require('./routes/tasks'));
    app.use('/api/work-types', require('./routes/workTypes'));
    app.use('/api/notifications', require('./routes/notifications'));
    app.use('/api/sprints', require('./routes/sprints'));

    app.use('/api/releases', require('./routes/releases'));
} catch (err) {
    console.error('Route loading failed:', err.name);
    process.exit(1);
}

// Compatibility redirects for links/bookmarks created before Issue and Task were merged.
app.use('/api/issues', (req, res) => {
    res.redirect(308, `/api/tasks${req.url}`);
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        message: 'Route not found'
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('Unhandled Express error:', err.name);
    res.status(status).json({
        message: status >= 500 ? 'Internal Server Error' : err.message
    });
});

// Initialize storage before accepting API traffic.
async function startServer() {
    try {
        require('./services/emailService').validateEmailConfig();
        await require('./services/data').store.initialize();
        require('./services/emailService').startEmailWorker();
        require('./services/notificationService').startNotificationCleanup();
        app.listen(config.port, '0.0.0.0', () => {
            console.info(`Bug Tracker API listening on port ${config.port} with PostgreSQL storage`);
        });

    } catch (err) {
        console.error('Server startup failed:', err.name, err.message);
        process.exit(1);
    }
}

startServer();

// Process Error Handlers
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.name);
    process.exit(1);
});

process.on('unhandledRejection', () => {
    console.error('Unhandled promise rejection');
    process.exit(1);
});