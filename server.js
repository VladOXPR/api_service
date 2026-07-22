const express = require('express');
const path = require('path');

// Log startup
console.log('🚀 Starting server...');
console.log('📋 Node version:', process.version);
console.log('📋 NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('📋 PORT:', process.env.PORT || '8080 (default)');

// Load environment variables FIRST (before loading routes that need them)
try {
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
  console.log('✅ Environment variables loaded');
} catch (error) {
  console.warn('⚠️ Error loading .env files (may not exist):', error.message);
}

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
let tokenExtractModule;
try {
  tokenExtractModule = require('./token_extract');
  if (!tokenExtractModule || !tokenExtractModule.router) {
    throw new Error('token_extract module did not export router');
  }
  tokenRoutes = tokenExtractModule.router;
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

// Load scan routes with error handling
let scanRoutes;
try {
  scanRoutes = require('./scan_service_api');
  console.log('✅ Scan service API routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading scan service API routes:', error);
  console.error('Error stack:', error.stack);
  // Create a dummy router to prevent app crash
  scanRoutes = express.Router();
  scanRoutes.get('*', (req, res) => {
    res.status(500).json({
      success: false,
      error: 'Scan service API not available: ' + error.message
    });
  });
}

// Load maintenance (tickets) routes with error handling
let maintenanceRoutes;
try {
  maintenanceRoutes = require('./maintenance_service_api');
  console.log('✅ Maintenance service API routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading maintenance service API routes:', error);
  console.error('Error stack:', error.stack);
  maintenanceRoutes = express.Router();
  maintenanceRoutes.get('*', (req, res) => {
    res.status(500).json({
      success: false,
      error: 'Maintenance service API not available: ' + error.message
    });
  });
}

// Load Stripe routes with error handling
let stripeRoutes;
try {
  stripeRoutes = require('./stripe_api');
  console.log('✅ Stripe API routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading Stripe API routes:', error);
  stripeRoutes = express.Router();
  stripeRoutes.get('*', (req, res) => {
    res.status(500).json({
      success: false,
      error: 'Stripe API not available: ' + error.message
    });
  });
}

// Load POS (rents) routes with error handling
let posRoutes;
try {
  posRoutes = require('./pos_service');
  console.log('✅ POS service API routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading POS service API routes:', error);
  console.error('Error stack:', error.stack);
  posRoutes = express.Router();
  posRoutes.get('*', (req, res) => {
    res.status(500).json({
      success: false,
      error: 'POS service API not available: ' + error.message
    });
  });
}

const app = express();
const PORT = process.env.PORT || 8080;

/**
 * Health check endpoint - define early for Cloud Run startup probe
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'energo-token-extractor',
        timestamp: new Date().toISOString()
    });
});

/**
 * Human-friendly API documentation page.
 * Served before express.json() middleware since it just returns a static file.
 */
app.get(['/docs', '/docs/'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

// Serve static assets (logos, css, etc.) from /public
app.use('/public', express.static(path.join(__dirname, 'public')));

// Middleware
app.use(express.json());

// Mount Stripe routes BEFORE user routes so /rents/:dateRange and /rents/:dateRange/all match first
// (user routes has /rents/:station_id/:dateRange which has two path segments)
app.use('/', stripeRoutes);
console.log('🔗 Stripe routes mounted at root path');

// Mount user routes
app.use('/', userRoutes);
console.log('🔗 User routes mounted at root path');

// Mount map routes
app.use('/', mapRoutes);
console.log('🔗 Map routes mounted at root path');

// Mount token routes
app.use('/', tokenRoutes);
console.log('🔗 Token routes mounted at root path');

// Mount scan routes
app.use('/', scanRoutes);
console.log('🔗 Scan routes mounted at root path');

// Mount maintenance (tickets) routes
app.use('/', maintenanceRoutes);
console.log('🔗 Maintenance routes mounted at root path');

// Mount POS (rents lifecycle) routes
app.use('/', posRoutes);
console.log('🔗 POS routes mounted at root path');

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

// Start the server with error handling
// Bind to 0.0.0.0 to listen on all network interfaces (required for Cloud Run)
try {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
        console.log(`📡 GET /token and GET /token/health available at port ${PORT}`);
        console.log(`❤️  Health check available at: http://0.0.0.0:${PORT}/health`);
        console.log(`📖 API docs available at: http://0.0.0.0:${PORT}/docs`);
        console.log(`✅ Server is ready to accept connections`);
    });
        
    // Handle server errors
    server.on('error', (error) => {
        console.error('❌ Server listen error:', error);
        if (error.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} is already in use`);
        }
        process.exit(1);
    });

        // Handle process errors
    process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught Exception:', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
        // Don't exit on unhandled rejection, just log it
    });
} catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
}

// ========================================
// AUTOMATIC TOKEN REFRESH SCHEDULER
// ========================================

// Add fetch for HTTP requests
let fetch;
if (typeof globalThis.fetch === 'undefined') {
  fetch = require('node-fetch');
} else {
  fetch = globalThis.fetch;
}

const TOKEN_HEALTH_CHECK_INTERVAL_MS = parseInt(
  process.env.TOKEN_HEALTH_CHECK_INTERVAL_MS || String(15 * 60 * 1000),
  10
);
const TOKEN_BACKUP_REFRESH_HOURS = parseInt(process.env.TOKEN_BACKUP_REFRESH_HOURS || '24', 10);
const isExtractionInProgress = tokenExtractModule && tokenExtractModule.isExtractionInProgress;

let lastBackupRefreshAt = Date.now();

function getInternalBaseUrl() {
  const port = process.env.PORT || 8080;
  return process.env.TOKEN_REFRESH_INTERNAL_BASE_URL || `http://127.0.0.1:${port}`;
}

/**
 * Check stored token health via internal /token/health endpoint.
 */
async function checkTokenHealth() {
  const url = `${getInternalBaseUrl()}/token/health`;
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Token health check failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Refresh token when health requires it, or on periodic backup interval.
 */
async function maybeRefreshToken() {
  try {
    if (isExtractionInProgress && isExtractionInProgress()) {
      console.log('Token extraction already in progress, skipping scheduled refresh');
      return false;
    }

    let health;
    try {
      health = await checkTokenHealth();
    } catch (healthErr) {
      console.error('⚠️ Token health check failed, attempting refresh:', healthErr.message);
      health = { tokenNeedsAttention: true, tokenPresent: false };
    }

    const needsRefresh = health.tokenNeedsAttention === true || health.tokenPresent === false;
    const backupDue =
      Date.now() - lastBackupRefreshAt >= TOKEN_BACKUP_REFRESH_HOURS * 60 * 60 * 1000;

    if (!needsRefresh && !backupDue) {
      console.log('✅ Token health OK; skipping Puppeteer refresh');
      return true;
    }

    if (backupDue && !needsRefresh) {
      console.log('🔄 Backup token refresh due (TOKEN_BACKUP_REFRESH_HOURS)');
    } else {
      console.log('🔄 Token needs attention; running Puppeteer refresh...');
    }

    const refreshUrl = `${getInternalBaseUrl()}/token`;
    const response = await fetch(refreshUrl, { method: 'GET' });

    if (!response.ok) {
      console.error(`⚠️ Automatic token refresh failed: ${response.status} ${response.statusText}`);
      const body = await response.text().catch(() => '');
      if (body) console.error('Refresh response body:', body.slice(0, 500));
      return false;
    }

    const data = await response.json();
    if (data.success && data.token) {
      console.log('✅ Automatic token refresh successful');
      lastBackupRefreshAt = Date.now();
      return true;
    }

    console.error('⚠️ Automatic token refresh response missing token:', data);
    return false;
  } catch (error) {
    console.error('❌ Error during automatic token refresh:', error.message);
    return false;
  }
}

/**
 * Schedule the next token health check / conditional refresh.
 */
function scheduleNextTokenRefresh() {
  const minutes = Math.round(TOKEN_HEALTH_CHECK_INTERVAL_MS / 1000 / 60);
  console.log(`⏰ Next token health check scheduled in ${minutes} minutes`);

  setTimeout(async () => {
    await maybeRefreshToken();
    scheduleNextTokenRefresh();
  }, TOKEN_HEALTH_CHECK_INTERVAL_MS);
}

// Start the automatic token refresh scheduler
// Wait a bit after server starts before the first check
setTimeout(() => {
  console.log('🚀 Starting token health scheduler (health-driven refresh)...');
  maybeRefreshToken().then(() => {
    scheduleNextTokenRefresh();
  });
}, 60000); // Wait 1 minute after server starts

module.exports = app;
