const express = require('express');
const { Pool } = require('pg');

const router = express.Router();
router.use(express.json());

/** Allowed labels for `ticket_task` enum (Postgres). Order matches product semantics: Urgent Other → red, Other → yellow in UIs. */
const TICKET_TASKS = [
  'High Batteries',
  'Low Batteries',
  'No Batteries',
  'Add Stack',
  'Broken Battery',
  'High Failure Rates',
  'Hardware Malfunction',
  'Unusually Offline',
  'Urgent Other',
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

/**
 * Normalize DB value (ticket_task[]) to string[] for JSON.
 */
function normalizeTaskFromDb(val) {
  if (val == null) {
    return [];
  }
  if (Array.isArray(val)) {
    return val.map((x) => (x == null ? '' : String(x))).filter(Boolean);
  }
  if (typeof val === 'string') {
    return [val];
  }
  return [];
}

/**
 * Parse `task` from request body: non-empty array of enum labels, or legacy single string.
 * @returns {{ tasks: string[] } | { error: string }}
 */
function parseTaskInput(task, { allowEmpty = false } = {}) {
  if (task === undefined) {
    return { tasks: undefined };
  }
  if (task === null) {
    return { error: 'task cannot be null' };
  }

  let arr;
  if (Array.isArray(task)) {
    arr = task.map((t) => String(t).trim()).filter((t) => t.length > 0);
  } else if (typeof task === 'string' && task.trim() !== '') {
    arr = [task.trim()];
  } else {
    return {
      error:
        'task must be a non-empty array of task labels (e.g. ["Low Batteries","Hardware Malfunction"]); a single string is accepted for legacy clients'
    };
  }

  if (!allowEmpty && arr.length === 0) {
    return { error: 'task must include at least one value' };
  }
  if (allowEmpty && arr.length === 0) {
    return { tasks: [] };
  }

  const invalid = arr.filter((t) => !TICKET_TASKS.includes(t));
  if (invalid.length > 0) {
    return {
      error: `Invalid task value(s): ${invalid.join(', ')}. Allowed: ${TICKET_TASKS.join(', ')}`
    };
  }

  return { tasks: [...new Set(arr)] };
}

/**
 * Query param `task`: string or string[]. Filter tickets whose `task` array overlaps (contains any of the given values).
 * @returns {{ tasks: string[] } | { error: string } | null} null = no filter
 */
function parseTaskQueryFilter(taskQuery) {
  if (taskQuery === undefined || taskQuery === null || taskQuery === '') {
    return null;
  }
  const rawList = Array.isArray(taskQuery) ? taskQuery : [taskQuery];
  const validated = [];
  for (const t of rawList) {
    const s = String(t).trim();
    if (!s) {
      continue;
    }
    if (!TICKET_TASKS.includes(s)) {
      return { error: `Invalid task filter: ${s}` };
    }
    validated.push(s);
  }
  if (validated.length === 0) {
    return null;
  }
  return { tasks: [...new Set(validated)] };
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
    task: normalizeTaskFromDb(row.task),
    description: row.description
  };
}

/**
 * GET /tickets
 * Optional query: task (repeatable or array) — tickets where the ticket's task array contains any of the given values (overlap, not exact row match).
 */
router.get('/tickets', async (req, res) => {
  const filterParsed = parseTaskQueryFilter(req.query.task);
  if (filterParsed && filterParsed.error) {
    return res.status(400).json({ success: false, error: filterParsed.error });
  }

  let client;
  try {
    client = await pool.connect();

    let sql = `
      SELECT id, location_name, station_id, latitude, longitude, created_at, task, description
      FROM tickets`;
    const params = [];

    if (filterParsed && filterParsed.tasks.length > 0) {
      params.push(filterParsed.tasks);
      sql += ` WHERE task && $1::text[]::ticket_task[]`;
    }

    sql += ` ORDER BY created_at DESC`;

    const result = await client.query(sql, params);
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
      `SELECT id, location_name, station_id, latitude, longitude, created_at, task, description
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
 * Body: task = string[] (or legacy single string)
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

  const parsed = parseTaskInput(task, { allowEmpty: false });
  if (parsed.error) {
    return res.status(400).json({ success: false, error: parsed.error });
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
       VALUES ($1, $2, $3, $4, $5::text[]::ticket_task[], $6)
       RETURNING id, location_name, station_id, latitude, longitude, created_at, task, description`,
      [
        String(location_name).trim(),
        String(station_id).trim(),
        coords.lat,
        coords.lng,
        parsed.tasks,
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
        error: 'Invalid task or data for ticket_task[]'
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
       RETURNING id, location_name, station_id, latitude, longitude, created_at, task, description`,
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

  const parsed = parseTaskInput(task, { allowEmpty: true });
  if (parsed.error) {
    return res.status(400).json({ success: false, error: parsed.error });
  }
  if (task !== undefined && parsed.tasks !== undefined && parsed.tasks.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'task cannot be an empty array; omit the field or send at least one task label'
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
      updates.push(`task = $${paramIndex++}::text[]::ticket_task[]`);
      values.push(parsed.tasks);
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
      RETURNING id, location_name, station_id, latitude, longitude, created_at, task, description
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

console.log('📦 Maintenance service API router initialized: GET/POST/PATCH/DELETE /tickets (task as ticket_task[])');

module.exports = router;
module.exports.TICKET_TASKS = TICKET_TASKS;
