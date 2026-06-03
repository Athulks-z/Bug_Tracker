const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

console.log('=================================');
console.log('Starting Bug Tracker Backend...');
console.log('Node Version:', process.version);
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('PORT:', process.env.PORT || 'not set');
console.log('MONGODB_URI Present:', !!process.env.MONGODB_URI);
console.log('JWT_SECRET Present:', !!process.env.JWT_SECRET);
console.log('CLIENT_URL:', process.env.CLIENT_URL || 'not set');
console.log('=================================');

const app = express();

const path = require('path');

// Middleware
app.use(cors({
    origin: process.env.CLIENT_URL || '*',
    credentials: true
}));

app.use(express.json());

// serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health Check
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Route Loading
try {
    console.log('Loading auth routes...');
    app.use('/api/auth', require('./routes/auth'));

    console.log('Loading users routes...');
    app.use('/api/users', require('./routes/users'));

    console.log('Loading projects routes...');
    app.use('/api/projects', require('./routes/projects'));

    console.log('Loading issues routes...');
    app.use('/api/issues', require('./routes/issues'));

    console.log('Loading templates routes...');
    app.use('/api/templates', require('./routes/templates'));

    console.log('Loading tasks routes...');
    app.use('/api/tasks', require('./routes/tasks'));
    console.log('Loading notifications routes...');
    app.use('/api/notifications', require('./routes/notifications'));
    console.log('Loading sprints routes...');
    app.use('/api/sprints', require('./routes/sprints'));

    console.log('Loading releases routes...');
    app.use('/api/releases', require('./routes/releases'));

    console.log('All routes loaded successfully.');
} catch (err) {
    console.error('Route loading failed!');
    console.error(err);
    process.exit(1);
}

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        message: 'Route not found'
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Express Error:', err);

    res.status(500).json({
        message: 'Internal Server Error'
    });
});

const PORT = process.env.PORT || 5000;

// MongoDB Connection
async function startServer() {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error(
                'MONGODB_URI environment variable is missing'
            );
        }

        console.log('Connecting to MongoDB...');

        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 30000
        });

        console.log('MongoDB connected successfully.');

        app.listen(PORT, '0.0.0.0', () => {
            console.log('=================================');
            console.log(`Server running on port ${PORT}`);
            console.log('Backend startup complete.');
            console.log('=================================');
        });

    } catch (err) {
        console.error('=================================');
        console.error('SERVER STARTUP FAILED');
        console.error(err);
        console.error('=================================');
        process.exit(1);
    }
}

startServer();

// Process Error Handlers
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION');
    console.error(err);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION');
    console.error(reason);
    process.exit(1);
});