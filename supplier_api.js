const { Pool } = require('pg');
const { loginToEnergo, closeBrowser } = require('./energoLogin');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

// Database configuration (reusing same connection config)
const CLOUD_SQL_CONNECTION_NAME = process.env.CLOUD_SQL_CONNECTION_NAME || 'keyextract-482721:us-central1:cuub-db';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASS = process.env.DB_PASS || '1Cuubllc!';
const DB_NAME = process.env.DB_NAME || 'postgres';

// Create connection pool for token operations
const poolConfig = {
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
};

const useCloudSql = process.env.CLOUD_SQL_CONNECTION_NAME || CLOUD_SQL_CONNECTION_NAME.includes(':');
if (useCloudSql) {
  poolConfig.host = `/cloudsql/${CLOUD_SQL_CONNECTION_NAME}`;
} else {
  poolConfig.host = process.env.DB_HOST || 'localhost';
  poolConfig.port = process.env.DB_PORT || 5432;
}

const pool = new Pool(poolConfig);

// Add fetch for Node.js if not available
let fetch;
if (typeof globalThis.fetch === 'undefined') {
  fetch = require('node-fetch');
} else {
  fetch = globalThis.fetch;
}

/**
 * Get token from the token table in database
 * @returns {Promise<string|null>} The token or null if not found
 */
async function getTokenFromDatabase() {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT value FROM token LIMIT 1');
    
    if (result.rows.length > 0 && result.rows[0].value) {
      return result.rows[0].value.trim();
    }
    return null;
  } catch (error) {
    console.error('Error getting token from database:', error);
    return null;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Update token in the token table
 * @param {string} newToken - The new token to store
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function updateTokenInDatabase(newToken) {
  let client;
  try {
    client = await pool.connect();
    
    // Check if a row exists
    const checkResult = await client.query('SELECT COUNT(*) FROM token');
    const rowCount = parseInt(checkResult.rows[0].count);
    
    if (rowCount > 0) {
      // Update existing row
      await client.query('UPDATE token SET value = $1', [newToken]);
    } else {
      // Insert new row
      await client.query('INSERT INTO token (value) VALUES ($1)', [newToken]);
    }
    
    console.log('✅ Token updated in database');
    return true;
  } catch (error) {
    console.error('Error updating token in database:', error);
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Get a new token by running the energoLogin script
 * @returns {Promise<string|null>} The new token or null if failed
 */
async function refreshToken() {
  try {
    console.log('🔄 Refreshing token via energoLogin...');
    
    // Get credentials from environment variables
    const username = process.env.ENERGO_USERNAME;
    const password = process.env.ENERGO_PASSWORD;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    
    if (!username || !password) {
      console.error('❌ ENERGO_USERNAME and ENERGO_PASSWORD environment variables are required');
      return null;
    }
    
    if (!openaiApiKey) {
      console.error('❌ OPENAI_API_KEY environment variable is required');
      return null;
    }
    
    // Perform login to get the token
    const loginResult = await loginToEnergo({
      username: username,
      password: password,
      captcha: undefined, // Will be solved using OpenAI
      openaiApiKey: openaiApiKey,
      headless: true, // Run in headless mode for server
      timeout: 30000
    });
    
    // Close browser
    if (loginResult) {
      await closeBrowser(loginResult);
    }
    
    if (!loginResult.success || !loginResult.token) {
      console.error('❌ Failed to get token from energoLogin');
      return null;
    }
    
    console.log('✅ Successfully obtained new token');
    
    // Update token in database
    await updateTokenInDatabase(loginResult.token);
    
    return loginResult.token;
  } catch (error) {
    console.error('❌ Error refreshing token:', error);
    return null;
  }
}

/**
 * Get station battery availability from Relink API
 * @param {string} stationId - The station ID (cabinetId)
 * @param {string} token - The authorization token
 * @returns {Promise<Object|null>} The API response or null if failed. Returns {error: 'unauthorized'} for 401/403
 */
async function getStationInfoFromRelink(stationId, token) {
  try {
    const url = `https://backend.energo.vip/api/cabinet?cabinetId=${encodeURIComponent(stationId)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Referer': 'https://backend.energo.vip/device/list',
        'oid': '3526',
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      // Check if it's an authentication error
      if (response.status === 401 || response.status === 403) {
        console.error(`❌ Relink API unauthorized error (${response.status}): Token may be invalid`);
        return { error: 'unauthorized' };
      }
      console.error(`❌ Relink API error: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Error calling Relink API:', error);
    return null;
  }
}

/**
 * Get station slot information (Open Slots and Filled Slots) from Relink API
 * Handles token refresh if API call fails
 * @param {string} stationId - The station ID (cabinetId)
 * @param {boolean} retryOnFailure - Whether to retry after token refresh if failed (default: true)
 * @returns {Promise<Object|null>} Object with openSlots and filledSlots, or null if failed
 */
async function getStationSlots(stationId, retryOnFailure = true) {
  try {
    // Get token from database
    let token = await getTokenFromDatabase();
    
    if (!token) {
      console.log('⚠️ No token found in database, attempting to get new token...');
      token = await refreshToken();
      if (!token) {
        console.error('❌ Failed to get token');
        return null;
      }
    }
    
    // First attempt to get station info
    let stationInfo = await getStationInfoFromRelink(stationId, token);
    
    // Only refresh token if the API call specifically failed due to authentication (401/403)
    // For other errors (network, 404, 500, etc.), don't refresh token
    if (stationInfo && stationInfo.error === 'unauthorized' && retryOnFailure) {
      console.log(`⚠️ Relink API returned unauthorized for ${stationId}, refreshing token and retrying...`);
      token = await refreshToken();
      
      if (token) {
        // Retry with new token
        stationInfo = await getStationInfoFromRelink(stationId, token);
      }
    }
    
    // Parse the response to get slot information
    if (stationInfo && stationInfo.content && stationInfo.content.length > 0) {
      const positionInfo = stationInfo.content[0].positionInfo;
      
      if (positionInfo) {
        return {
          openSlots: positionInfo.returnNum || 0,
          filledSlots: positionInfo.borrowNum || 0
        };
      }
    }
    
    console.warn(`⚠️ No position info found for station ${stationId}`);
    return {
      openSlots: 0,
      filledSlots: 0
    };
  } catch (error) {
    console.error(`❌ Error getting station slots for ${stationId}:`, error);
    return null;
  }
}

module.exports = {
  getTokenFromDatabase,
  updateTokenInDatabase,
  refreshToken,
  getStationInfoFromRelink,
  getStationSlots
};

