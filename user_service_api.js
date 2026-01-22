const express = require('express');
const { Pool } = require('pg');
const path = require('path');

// Add fetch for HTTP requests
let fetch;
if (typeof globalThis.fetch === 'undefined') {
  fetch = require('node-fetch');
} else {
  fetch = globalThis.fetch;
}

const router = express.Router();
router.use(express.json());

// Database configuration
const CLOUD_SQL_CONNECTION_NAME = process.env.CLOUD_SQL_CONNECTION_NAME || 'keyextract-482721:us-central1:cuub-db';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASS = process.env.DB_PASS || '1Cuubllc!';
const DB_NAME = process.env.DB_NAME || 'postgres';

// Create connection pool
// For Cloud SQL, use Unix socket when running on Cloud Run
const poolConfig = {
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
};


const useCloudSql = process.env.CLOUD_SQL_CONNECTION_NAME || CLOUD_SQL_CONNECTION_NAME.includes(':');
if (useCloudSql) {
  poolConfig.host = `/cloudsql/${CLOUD_SQL_CONNECTION_NAME}`;
  console.log('🔌 Using Cloud SQL Unix socket connection');
} else {
  poolConfig.host = process.env.DB_HOST || 'localhost';
  poolConfig.port = process.env.DB_PORT || 5432;
  console.log('🔌 Using TCP connection');
}

const pool = new Pool(poolConfig);

// Log connection configuration (without password)
console.log('🔌 Database connection config:', {
  host: poolConfig.host,
  user: poolConfig.user,
  database: poolConfig.database,
  port: poolConfig.port || 'N/A (Unix socket)'
});

// Test database connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
});

// Token refresh lock to prevent concurrent token refresh requests
let tokenRefreshPromise = null;

/**
 * Helper function to get token from database
 */
async function getTokenFromDatabase() {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT value FROM token LIMIT 1');
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0].value;
  } catch (error) {
    console.error('Error fetching token from database:', error);
    return null;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Helper function to refresh token by calling the token endpoint
 * Uses promise-based locking to prevent concurrent refresh requests
 * @returns {Promise<string|null>} - Returns the new token or null if refresh failed
 */
async function refreshToken() {
  // If a token refresh is already in progress, wait for it and return the result
  if (tokenRefreshPromise) {
    console.log('⏳ Token refresh already in progress, waiting for existing refresh...');
    try {
      return await tokenRefreshPromise;
    } catch (error) {
      console.error('Error waiting for token refresh:', error);
      return null;
    }
  }
  
  // Create new refresh promise
  tokenRefreshPromise = (async () => {
    try {
      console.log('🔄 Token expired, refreshing token...');
      const response = await fetch('https://api.cuub.tech/token', {
        method: 'GET'
      });

      if (!response.ok) {
        console.error(`Token refresh failed: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      if (data.success && data.token) {
        console.log('✅ Token refreshed successfully');
        return data.token;
      }
      
      console.error('Token refresh response missing token:', data);
      return null;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return null;
    } finally {
      // Clear the promise after a short delay to allow concurrent calls to see the result
      setTimeout(() => {
        tokenRefreshPromise = null;
      }, 2000);
    }
  })();
  
  const result = await tokenRefreshPromise;
  return result;
}

/**
 * Helper function to send pop command to Relink API for a specific slot
 * @param {string} stationId - The station ID
 * @param {number} slot - The slot number (1-6)
 * @param {string} token - The authorization token
 * @param {boolean} isRetry - Whether this is a retry after token refresh
 * @returns {Promise<Object|null>} - Returns the response data or null if failed
 */
async function sendPopCommand(stationId, slot, token, isRetry = false) {
  try {
    const url = 'https://backend.energo.vip/api/command/sendCommandBySign';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Referer': 'https://backend.energo.vip/device/list',
        'oid': '3526',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cabinetId: stationId,
        rlSeq: 1,
        rlSlot: slot,
        commandSign: 'SendCompulsoryBorrowDevice'
      })
    });

    // If request fails and we haven't retried yet, refresh token and retry
    if (!response.ok && !isRetry) {
      console.log(`⚠️ Relink API error for pop command (station ${stationId}, slot ${slot}): ${response.status} ${response.statusText}. Attempting token refresh...`);
      
      // Refresh the token
      const newToken = await refreshToken();
      
      if (newToken) {
        // Update token in database
        let dbClient;
        try {
          dbClient = await pool.connect();
          await dbClient.query('DELETE FROM token');
          await dbClient.query('INSERT INTO token (value) VALUES ($1)', [newToken]);
          console.log('✅ Updated token in database');
        } catch (dbError) {
          console.error('Error updating token in database:', dbError);
        } finally {
          if (dbClient) {
            dbClient.release();
          }
        }
        
        // Retry the request with new token
        return sendPopCommand(stationId, slot, newToken, true);
      } else {
        console.error(`Failed to refresh token for pop command (station ${stationId}, slot ${slot})`);
        return null;
      }
    }

    if (!response.ok) {
      console.error(`Relink API error for pop command (station ${stationId}, slot ${slot}) after retry: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    // If it's a network/API error and we haven't retried, try refreshing token
    if (!isRetry && (error.message?.includes('fetch') || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT')) {
      console.log(`⚠️ Network error for pop command (station ${stationId}, slot ${slot}). Attempting token refresh...`);
      
      const newToken = await refreshToken();
      
      if (newToken) {
        // Update token in database
        let dbClient;
        try {
          dbClient = await pool.connect();
          await dbClient.query('DELETE FROM token');
          await dbClient.query('INSERT INTO token (value) VALUES ($1)', [newToken]);
          console.log('✅ Updated token in database');
        } catch (dbError) {
          console.error('Error updating token in database:', dbError);
        } finally {
          if (dbClient) {
            dbClient.release();
          }
        }
        
        // Retry the request with new token
        return sendPopCommand(stationId, slot, newToken, true);
      }
    }
    
    console.error(`Error sending pop command for station ${stationId}, slot ${slot}:`, error);
    return null;
  }
}

/**
 * GET /users
 * Fetch a list of all users
 */
router.get('/users', async (req, res) => {
  console.log('GET /users endpoint called');
  let client;
  try {
    client = await pool.connect();
    
    // Get all users
    const usersResult = await client.query(
      'SELECT id, username, type, created_at, updated_at FROM users ORDER BY created_at DESC'
    );
    
    // Get all station associations
    // Note: If the table name is different, update it here
    const stationsResult = await client.query(
      'SELECT user_id, station_id FROM user_stations'
    );
    
    // Group stations by user_id
    const stationsByUserId = {};
    stationsResult.rows.forEach(row => {
      if (!stationsByUserId[row.user_id]) {
        stationsByUserId[row.user_id] = [];
      }
      stationsByUserId[row.user_id].push(row.station_id);
    });
    
    // Add stations array to each user
    const usersWithStations = usersResult.rows.map(user => {
      return {
        ...user,
        stations: stationsByUserId[user.id] || []
      };
    });
    
    res.json({
      success: true,
      data: usersWithStations,
      count: usersWithStations.length
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    
    // Check if it's a "table does not exist" error and provide helpful message
    if (error.message && error.message.includes('does not exist')) {
      console.error('Join table might have a different name. Common names: user_stations, users_stations, user_station');
    }
    
    // Provide helpful error messages for common connection issues
    let errorMessage = error.message || 'Failed to fetch users';
    let statusCode = 500;
    
    if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
      errorMessage = 'Database connection refused. Please ensure: 1) Cloud SQL instance is added to Cloud Run service connections, 2) Service account has Cloud SQL Client role, 3) Cloud SQL Admin API is enabled.';
      statusCode = 503;
    } else if (error.message?.includes('NOT_AUTHORIZED') || error.message?.includes('permission')) {
      errorMessage = 'Database permission denied. Please ensure the Cloud Run service account has the "Cloud SQL Client" IAM role.';
      statusCode = 503;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV !== 'production' ? {
        code: error.code,
        connectionName: CLOUD_SQL_CONNECTION_NAME
      } : undefined
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

/**
 * GET /users/:id
 * Fetch single user data by id
 */
router.get('/users/:id', async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    
    client = await pool.connect();
    
    // Get user data
    const userResult = await client.query(
      'SELECT id, username, type, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const user = userResult.rows[0];
    
    // Get associated stations from join table
    // Note: If the table name is different, update it here
    // Common names: user_stations, users_stations, user_station
    const stationsResult = await client.query(
      'SELECT station_id FROM user_stations WHERE user_id = $1',
      [id]
    );
    
    // Extract station IDs into an array
    const stations = stationsResult.rows.map(row => row.station_id);
    
    // Add stations array to user data
    user.stations = stations;
    
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    
    // Check if it's a "table does not exist" error and provide helpful message
    if (error.message && error.message.includes('does not exist')) {
      console.error('Join table might have a different name. Common names: user_stations, users_stations, user_station');
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch user'
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

/**
 * POST /users
 * Create a new user
 */
router.post('/users', async (req, res) => {
  let client;
  try {
    const { username, type, station_id, station_ids } = req.body;
    
    // Validate required fields
    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: username is required'
      });
    }
    
    // Validate type if provided
    if (type && !['HOST', 'DISTRIBUTOR', 'ADMIN'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid type. Must be one of: HOST, DISTRIBUTOR, ADMIN'
      });
    }
    
    client = await pool.connect();
    
    // Start a transaction
    await client.query('BEGIN');
    
    try {
      // Insert new user (id will be auto-generated by the database)
      const result = await client.query(
        `INSERT INTO users (username, type, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING id, username, type, created_at, updated_at`,
        [username, type || 'HOST']
      );
      
      const user = result.rows[0];
      const userId = user.id;
      
      // Handle station assignments
      // Support both station_id (single) and station_ids (array)
      let stationsToAssign = [];
      if (station_ids && Array.isArray(station_ids)) {
        stationsToAssign = station_ids;
      } else if (station_id) {
        stationsToAssign = [station_id];
      }
      
      // Insert station assignments if provided
      if (stationsToAssign.length > 0) {
        // Get user type for role in join table (default to HOST)
        const userRole = type || 'HOST';
        
        for (const stationId of stationsToAssign) {
          await client.query(
            `INSERT INTO user_stations (user_id, station_id, role, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())`,
            [userId, stationId, userRole]
          );
        }
      }
      
      // Fetch stations for the response
      const stationsResult = await client.query(
        'SELECT station_id FROM user_stations WHERE user_id = $1',
        [userId]
      );
      const stations = stationsResult.rows.map(row => row.station_id);
      
      // Commit transaction
      await client.query('COMMIT');
      
      // Add stations to user object
      user.stations = stations;
      
      res.status(201).json({
        success: true,
        data: user,
        message: 'User created successfully'
      });
    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error creating user:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({
        success: false,
        error: error.constraint?.includes('username') 
          ? 'Username already exists' 
          : 'User-station assignment already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create user'
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

/**
 * DELETE /users/:id
 * Delete a user by id
 */
router.delete('/users/:id', async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    
    client = await pool.connect();
    
    // Start a transaction
    await client.query('BEGIN');
    
    try {
      // Delete station associations first (foreign key constraint)
      await client.query(
        'DELETE FROM user_stations WHERE user_id = $1',
        [id]
      );
      
      // Delete user
      const result = await client.query(
        'DELETE FROM users WHERE id = $1 RETURNING id, username, type',
        [id]
      );
      
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      // Commit transaction
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'User deleted successfully',
        data: result.rows[0]
      });
    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete user'
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

/**
 * PATCH /users/:id
 * Update data for existing user
 */
router.patch('/users/:id', async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    const { username, type, station_id, station_ids } = req.body;
    
    // Check if at least one field is being updated
    if (username === undefined && type === undefined && station_id === undefined && station_ids === undefined) {
      return res.status(400).json({
        success: false,
        error: 'At least one field (username, type, station_id/station_ids) must be provided'
      });
    }
    
    // Validate type if provided
    if (type && !['HOST', 'DISTRIBUTOR', 'ADMIN'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid type. Must be one of: HOST, DISTRIBUTOR, ADMIN'
      });
    }
    
    client = await pool.connect();
    
    // Start a transaction
    await client.query('BEGIN');
    
    try {
      // First, get current user to check if exists and get current type
      const currentUserResult = await client.query(
        'SELECT id, username, type FROM users WHERE id = $1',
        [id]
      );
      
      if (currentUserResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const currentUser = currentUserResult.rows[0];
      const updatedType = type !== undefined ? type : currentUser.type;
      
      // Build dynamic UPDATE query for user fields
      const updates = [];
      const values = [];
      let paramIndex = 1;
      
      if (username !== undefined) {
        updates.push(`username = $${paramIndex++}`);
        values.push(username);
      }
      if (type !== undefined) {
        updates.push(`type = $${paramIndex++}`);
        values.push(type);
      }
      
      // Always update updated_at
      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        
        // Add id as the last parameter
        values.push(id);
        
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, type, created_at, updated_at`;
        const result = await client.query(query, values);
        var updatedUser = result.rows[0];
      } else {
        // No user fields to update, use current user
        const currentFullUserResult = await client.query(
          'SELECT id, username, type, created_at, updated_at FROM users WHERE id = $1',
          [id]
        );
        updatedUser = currentFullUserResult.rows[0];
      }
      
      // Handle station assignments if provided
      if (station_id !== undefined || station_ids !== undefined) {
        // Delete existing station assignments
        await client.query(
          'DELETE FROM user_stations WHERE user_id = $1',
          [id]
        );
        
        // Prepare stations to assign
        let stationsToAssign = [];
        if (station_ids && Array.isArray(station_ids)) {
          stationsToAssign = station_ids;
        } else if (station_id) {
          stationsToAssign = [station_id];
        }
        
        // Insert new station assignments
        if (stationsToAssign.length > 0) {
          for (const stationId of stationsToAssign) {
            await client.query(
              `INSERT INTO user_stations (user_id, station_id, role, created_at, updated_at)
               VALUES ($1, $2, $3, NOW(), NOW())`,
              [id, stationId, updatedType]
            );
          }
        }
      }
      
      // Fetch updated stations for the response
      const stationsResult = await client.query(
        'SELECT station_id FROM user_stations WHERE user_id = $1',
        [id]
      );
      const stations = stationsResult.rows.map(row => row.station_id);
      
      // Commit transaction
      await client.query('COMMIT');
      
      // Add stations to user object
      updatedUser.stations = stations;
      
      res.json({
        success: true,
        data: updatedUser,
        message: 'User updated successfully'
      });
    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error updating user:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({
        success: false,
        error: error.constraint?.includes('username')
          ? 'Username already exists'
          : 'User-station assignment already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update user'
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

/**
 * POST /pop/:station_id/all - Pop out all batteries from all slots (1-6)
 */
router.post('/pop/:station_id/all', async (req, res) => {
  console.log(`POST /pop/${req.params.station_id}/all endpoint called`);
  try {
    const { station_id } = req.params;
    
    // Get token from database
    const token = await getTokenFromDatabase();
    if (!token) {
      return res.status(503).json({
        success: false,
        error: 'Token not available. Please ensure token is set in database.'
      });
    }
    
    // Send pop commands for all 6 slots
    const data = [];
    
    for (let slot = 1; slot <= 6; slot++) {
      const result = await sendPopCommand(station_id, slot, token);
      if (result && result.borrowstatus) {
        data.push({
          slot: result.lockid || slot,
          manufacture_id: result.batteryid || ''
        });
      }
    }
    
    res.json({
      success: true,
      data: data,
      count: data.length
    });
  } catch (error) {
    console.error('Error popping all batteries:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to pop all batteries'
    });
  }
});

/**
 * POST /pop/:station_id/:slot - Pop out a battery from a specific slot
 */
router.post('/pop/:station_id/:slot', async (req, res) => {
  console.log(`POST /pop/${req.params.station_id}/${req.params.slot} endpoint called`);
  try {
    const { station_id, slot } = req.params;
    
    // Validate slot number (1-6)
    const slotNum = parseInt(slot);
    if (isNaN(slotNum) || slotNum < 1 || slotNum > 6) {
      return res.status(400).json({
        success: false,
        error: 'Invalid slot number. Must be between 1 and 6'
      });
    }
    
    // Get token from database
    const token = await getTokenFromDatabase();
    if (!token) {
      return res.status(503).json({
        success: false,
        error: 'Token not available. Please ensure token is set in database.'
      });
    }
    
    // Send pop command to Relink API
    const result = await sendPopCommand(station_id, slotNum, token);
    
    if (!result || !result.borrowstatus) {
      return res.status(500).json({
        success: false,
        error: 'Failed to send pop command to Relink API'
      });
    }
    
    res.json({
      success: true,
      data: [
        {
          slot: result.lockid || slotNum,
          manufacture_id: result.batteryid || ''
        }
      ],
      count: 1
    });
  } catch (error) {
    console.error('Error popping battery:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to pop battery'
    });
  }
});

// Log when router is loaded
console.log('📦 User service API router initialized with routes: GET, POST, PATCH, DELETE /users, POST /pop/:station_id/:slot, POST /pop/:station_id/all');

module.exports = router;

