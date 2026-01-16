const express = require('express');
const path = require('path');

// Load environment variables FIRST (before loading routes that need them)
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

// Load user routes with error handling
let userRoutes;
try {
  userRoutes = require('./user_service_api');
  console.log('✅ User service API routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading user service API routes:', error);
  console.error('Error stack:', error.stack);
  // Create a dummy router to prevent app crash
  userRoutes = express.Router();
  userRoutes.get('*', (req, res) => {
    res.status(500).json({
      success: false,
      error: 'User service API not available: ' + error.message
    });
  });
}

// Load map routes with error handling
let mapRoutes;
try {
  mapRoutes = require('./map_service_api');
  console.log('✅ Map service API routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading map service API routes:', error);
  console.error('Error stack:', error.stack);
  // Create a dummy router to prevent app crash
  mapRoutes = express.Router();
  mapRoutes.get('*', (req, res) => {
    res.status(500).json({
      success: false,
      error: 'Map service API not available: ' + error.message
    });
  });
}

// Load token routes with error handling
let tokenRoutes;
try {
  const tokenExtract = require('./token_extract');
  tokenRoutes = tokenExtract.router;
  console.log('✅ Token service API routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading token service API routes:', error);
  console.error('Error stack:', error.stack);
  // Create a dummy router to prevent app crash
  tokenRoutes = express.Router();
  tokenRoutes.get('*', (req, res) => {
    res.status(500).json({
      success: false,
      error: 'Token service API not available: ' + error.message
    });
  });
}

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json());

// Mount user routes
app.use('/', userRoutes);
console.log('🔗 User routes mounted at root path');

// Mount map routes
app.use('/', mapRoutes);
console.log('🔗 Map routes mounted at root path');

// Mount token routes
app.use('/', tokenRoutes);
console.log('🔗 Token routes mounted at root path');

// Debug: Log all registered routes (development only)
if (process.env.NODE_ENV !== 'production') {
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      console.log(`   ${Object.keys(middleware.route.methods).join(', ').toUpperCase()} ${middleware.route.path}`);
    } else if (middleware.name === 'router') {
      console.log(`   Router mounted at: ${middleware.regexp}`);
    }
  });
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'energo-token-extractor'
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📡 GET endpoint available at: http://localhost:${PORT}/token`);
    console.log(`❤️  Health check available at: http://localhost:${PORT}/health`);
});

module.exports = app;
