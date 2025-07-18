const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Force JSON for API routes
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Basic chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    // Simple echo response for now
    res.json({
      success: true,
      response: `Echo: ${message}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Chat service temporarily unavailable'
    });
  }
});

// GitHub repos endpoint
app.get('/api/github/repos', (req, res) => {
  res.json({
    success: true,
    repos: [],
    message: 'GitHub integration available but requires token configuration'
  });
});

// Default route
app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// Catch-all for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.path}`
  });
});

// Simple error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  if (req.path.startsWith('/api/')) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  } else {
    res.status(500).send('Internal server error');
  }
});

// Start server
console.log(`🚀 Starting AI Coding Assistant on port ${PORT}...`);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
  console.log(`🌍 Replit deployment ready`);
  console.log(`📱 Open webview to access the app`);
});

server.on('error', (err) => {
  console.error('❌ Server error:', err.message);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('📴 Shutting down...');
  server.close(() => {
    process.exit(0);
  });
});