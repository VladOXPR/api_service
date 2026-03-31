const express = require('express');
const { Pool } = require('pg');

const router = express.Router();
router.use(express.json());

const TICKET_TASKS = [
  'High Batteries',
  'Low Batteries',
  'No Batteries',
  'Add Stack',
  'Broken Battery',
  'High Failure Rates',
  'Hardware Malfunction',
  'Unusually Offline',
  'Other'
];

const CLOUD_SQL_CONNECTION_NAME = process.env.CLOUD_SQL_CONNECTION_NAME || 'keyextract-482721:us-central1:cuub-db';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASS = process.env.DB_PASS || '1Cuubllc!';
const DB_NAME = process.env.DB_NAME || 'postgres';

const poolConfig = {
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
};

const useCloudSql = process.env.CLOUD_SQL_CONNECTION_NAME || CLOUD_SQL_CONNECTION_NAME.includes(':');
if (useCloudSql) {
  poolConfig.host = `/cloudsql/${CLOUD_SQL_CONNECTION_NAME}`;
  console.log('🔌 Maintenance Service: Using Cloud SQL Unix socket connection');
} else {
  poolConfig.host = process.env.DB_HOST || 'localhost';
  poolConfig.port = process.env.DB_PORT || 5432;
  console.log('🔌 Maintenance Service: Using TCP connection');
}

const pool = new Pool(poolConfig);

console.log('🔌 Maintenance Service: Database connection config:', {
  host: poolConfig.host,
  user: poolConfig.user,
  database: poolConfig.database,
  port: poolConfig.port || 'N/A (Unix socket)'
});

pool.on('connect', () => {
  console.log('✅ Maintenance Service: Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Maintenance Service: Unexpected error on idle client', err);
});

function parseTicketId(param) {
  const id = Number.parseInt(String(param), 10);
  if (!Number.isFinite(id) || id < 1) {
    return null;
  }
  return id;
}

function isValidLatLng(lat, lng) {
  const latNum = typeof lat === 'number' ? lat : parseFloat(lat);
  const lngNum = typeof lng === 'number' ? lng : parseFloat(lng);
  if (Number.isNaN(latNum) || latNum < -90 || latNum > 90) {
    return { ok: false, error: 'Latitude must be a number between -90 and 90' };
  }
  if (Number.isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
    return { ok: false, error: 'Longitude must be a number between -180 and 180' };
  }
  return { ok: true, lat: latNum, lng: lngNum };
}

function rowToTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    location_name: row.location_name,
    station_id: row.station_id,
    latitude: row.latitude != null ? parseFloat(row.latitude) : null,
    longitude: row.longitude != null ? parseFloat(row.longitude) : null,
    created_at: row.created_at,
    task: row.task,
    description: row.description
  };
}

/**
 * GET /tickets
 * List all tickets (newest first)
 */
router.get('/tickets', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT id, location_name, station_id, latitude, longitude, created_at, task::text AS task, description
       FROM tickets
       ORDER BY created_at DESC`
    );
    const data = result.rows.map(rowToTicket);
    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch tickets'
    });
  } finally {
    if (client) client.release();
  }
});

/**
 * GET /tickets/:id
 * Fetch a single ticket by id
 */
router.get('/tickets/:id', async (req, res) => {
  const id = parseTicketId(req.params.id);
  if (id === null) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ticket id'
    });
  }

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT id, location_name, station_id, latitude, longitude, created_at, task::text AS task, description
       FROM tickets
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }

    res.json({
      success: true,
      data: rowToTicket(result.rows[0])
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch ticket'
    });
  } finally {
    if (client) client.release();
  }
});

/**
 * POST /tickets
 * Create a new ticket
 */
router.post('/tickets', async (req, res) => {
  const { location_name, station_id, latitude, longitude, task, description } = req.body || {};

  if (!location_name || String(location_name).trim() === '') {
    return res.status(400).json({ success: false, error: 'location_name is required' });
  }
  if (!station_id || String(station_id).trim() === '') {
    return res.status(400).json({ success: false, error: 'station_id is required' });
  }
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
    return res.status(400).json({ success: false, error: 'latitude and longitude are required' });
  }
  if (!task || String(task).trim() === '') {
    return res.status(400).json({ success: false, error: 'task is required' });
  }
  if (!TICKET_TASKS.includes(task)) {
    return res.status(400).json({
      success: false,
      error: `task must be one of: ${TICKET_TASKS.join(', ')}`
    });
  }

  const coords = isValidLatLng(latitude, longitude);
  if (!coords.ok) {
    return res.status(400).json({ success: false, error: coords.error });
  }

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO tickets (location_name, station_id, latitude, longitude, task, description)
       VALUES ($1, $2, $3, $4, $5::ticket_task, $6)
       RETURNING id, location_name, station_id, latitude, longitude, created_at, task::text AS task, description`,
      [
        String(location_name).trim(),
        String(station_id).trim(),
        coords.lat,
        coords.lng,
        task,
        description === undefined || description === null ? null : String(description)
      ]
    );

    res.status(201).json({
      success: true,
      data: rowToTicket(result.rows[0]),
      message: 'Ticket created successfully'
    });
  } catch (error) {
    console.error('Error creating ticket:', error);
    if (error.code === '23503') {
      return res.status(400).json({
        success: false,
        error: 'station_id does not reference an existing station'
      });
    }
    if (error.code === '22P02') {
      return res.status(400).json({
        success: false,
        error: 'Invalid task or data for ticket_task enum'
      });
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create ticket'
    });
  } finally {
    if (client) client.release();
  }
});

/**
 * DELETE /tickets/:id
 */
router.delete('/tickets/:id', async (req, res) => {
  const id = parseTicketId(req.params.id);
  if (id === null) {
    return res.status(400).json({ success: false, error: 'Invalid ticket id' });
  }

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `DELETE FROM tickets WHERE id = $1
       RETURNING id, location_name, station_id, latitude, longitude, created_at, task::text AS task, description`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    res.json({
      success: true,
      message: 'Ticket deleted successfully',
      data: rowToTicket(result.rows[0])
    });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete ticket'
    });
  } finally {
    if (client) client.release();
  }
});

/**
 * PATCH /tickets/:id
 */
router.patch('/tickets/:id', async (req, res) => {
  const id = parseTicketId(req.params.id);
  if (id === null) {
    return res.status(400).json({ success: false, error: 'Invalid ticket id' });
  }

  const { location_name, station_id, latitude, longitude, task, description } = req.body || {};

  if (
    location_name === undefined &&
    station_id === undefined &&
    latitude === undefined &&
    longitude === undefined &&
    task === undefined &&
    description === undefined
  ) {
    return res.status(400).json({
      success: false,
      error: 'At least one field must be provided: location_name, station_id, latitude, longitude, task, description'
    });
  }

  if (task === null) {
    return res.status(400).json({ success: false, error: 'task cannot be null' });
  }
  if (task !== undefined && !TICKET_TASKS.includes(task)) {
    return res.status(400).json({
      success: false,
      error: `task must be one of: ${TICKET_TASKS.join(', ')}`
    });
  }

  if (latitude !== undefined && longitude !== undefined) {
    const coords = isValidLatLng(latitude, longitude);
    if (!coords.ok) {
      return res.status(400).json({ success: false, error: coords.error });
    }
  } else if (latitude !== undefined || longitude !== undefined) {
    return res.status(400).json({
      success: false,
      error: 'latitude and longitude must be updated together'
    });
  }

  let client;
  try {
    client = await pool.connect();

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (location_name !== undefined) {
      if (String(location_name).trim() === '') {
        return res.status(400).json({ success: false, error: 'location_name cannot be empty' });
      }
      updates.push(`location_name = $${paramIndex++}`);
      values.push(String(location_name).trim());
    }
    if (station_id !== undefined) {
      if (String(station_id).trim() === '') {
        return res.status(400).json({ success: false, error: 'station_id cannot be empty' });
      }
      updates.push(`station_id = $${paramIndex++}`);
      values.push(String(station_id).trim());
    }
    if (latitude !== undefined && longitude !== undefined) {
      const coords = isValidLatLng(latitude, longitude);
      updates.push(`latitude = $${paramIndex++}`);
      values.push(coords.lat);
      updates.push(`longitude = $${paramIndex++}`);
      values.push(coords.lng);
    }
    if (task !== undefined) {
      updates.push(`task = $${paramIndex++}::ticket_task`);
      values.push(task);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description === null ? null : String(description));
    }

    values.push(id);
    const query = `
      UPDATE tickets
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, location_name, station_id, latitude, longitude, created_at, task::text AS task, description
    `;

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    res.json({
      success: true,
      data: rowToTicket(result.rows[0]),
      message: 'Ticket updated successfully'
    });
  } catch (error) {
    console.error('Error updating ticket:', error);
    if (error.code === '23503') {
      return res.status(400).json({
        success: false,
        error: 'station_id does not reference an existing station'
      });
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update ticket'
    });
  } finally {
    if (client) client.release();
  }
});

console.log('📦 Maintenance service API router initialized: GET/POST/PATCH/DELETE /tickets');

module.exports = router;
