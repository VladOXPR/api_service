const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const router = express.Router();

/**
 * POS service — endpoints for recording battery rent lifecycle events into POS-DB.rents.
 *
 * Table public.rents (POS-DB):
 *   rent_id        char(6)    PK, auto-generated as R##### via rents_seq
 *   battery_id     bigint     nullable
 *   stripe_pi      text       NOT NULL, UNIQUE
 *   start_time     timestamptz NOT NULL, default now()
 *   station_start  text       NOT NULL
 *   end_time       timestamptz nullable (set when battery is returned)
 *   station_end    text       nullable (set when battery is returned)
 */

const CLOUD_SQL_CONNECTION_NAME = process.env.CLOUD_SQL_CONNECTION_NAME || 'keyextract-482721:us-central1:cuub-db';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASS = process.env.DB_PASS || '1Cuubllc!';
// POS rents live in a dedicated database on the same Cloud SQL instance.
const POS_DB_NAME = process.env.POS_DB_NAME || 'POS-DB';

/**
 * Shared secret for /pos/* endpoints. Loaded once at module init.
 * If it isn't configured the middleware fails closed (503) — we never want the
 * POS endpoints reachable without a token, even if someone forgets to set it.
 */
const POS_API_TOKEN = process.env.POS_API_TOKEN || '';
const POS_API_TOKEN_HASH = POS_API_TOKEN
  ? crypto.createHash('sha256').update(POS_API_TOKEN).digest()
  : null;
if (!POS_API_TOKEN_HASH) {
  console.warn(
    '⚠️  POS Service: POS_API_TOKEN is not set — /pos/* endpoints will reject all requests with 503 until configured.'
  );
}

/**
 * Extract the bearer token from the request. Accepts either:
 *   - `Authorization: Bearer <token>`
 *   - `x-api-key: <token>`
 * Returns null if neither header is present / well-formed.
 */
function extractToken(req) {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].trim() !== '') {
      return match[1].trim();
    }
  }
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim() !== '') {
    return apiKey.trim();
  }
  return null;
}

/**
 * Auth middleware: gates every /pos/* endpoint mounted on this router.
 *   - 503 if the server has no POS_API_TOKEN configured (fail closed).
 *   - 401 if the client sent no token at all.
 *   - 403 if the token doesn't match.
 * Comparison is timing-safe over SHA-256 digests so neither length nor content can leak.
 */
function authenticatePos(req, res, next) {
  if (!POS_API_TOKEN_HASH) {
    return res.status(503).json({
      success: false,
      error: 'POS service is not configured (missing POS_API_TOKEN on server)'
    });
  }

  const provided = extractToken(req);
  if (!provided) {
    return res.status(401).json({
      success: false,
      error: 'Missing API token. Provide Authorization: Bearer <token> or x-api-key: <token>.'
    });
  }

  const providedHash = crypto.createHash('sha256').update(provided).digest();
  if (!crypto.timingSafeEqual(providedHash, POS_API_TOKEN_HASH)) {
    return res.status(403).json({ success: false, error: 'Invalid API token' });
  }

  return next();
}

// IMPORTANT: scope these to /pos. The router is mounted at '/' alongside the other
// services, so an unscoped router.use() would run for every request flowing through
// — auth would 401 unrelated endpoints (/users, /stations, …) before they could match.
router.use('/pos', authenticatePos);
router.use('/pos', express.json());

const poolConfig = {
  user: DB_USER,
  password: DB_PASS,
  database: POS_DB_NAME,
};

const useCloudSql = process.env.CLOUD_SQL_CONNECTION_NAME || CLOUD_SQL_CONNECTION_NAME.includes(':');
if (useCloudSql) {
  poolConfig.host = `/cloudsql/${CLOUD_SQL_CONNECTION_NAME}`;
  console.log('🔌 POS Service: Using Cloud SQL Unix socket connection');
} else {
  poolConfig.host = process.env.DB_HOST || 'localhost';
  poolConfig.port = process.env.DB_PORT || 5432;
  console.log('🔌 POS Service: Using TCP connection');
}

const pool = new Pool(poolConfig);

console.log('🔌 POS Service: Database connection config:', {
  host: poolConfig.host,
  user: poolConfig.user,
  database: poolConfig.database,
  port: poolConfig.port || 'N/A (Unix socket)'
});

pool.on('connect', () => {
  console.log('✅ POS Service: Connected to POS-DB');
});

pool.on('error', (err) => {
  console.error('❌ POS Service: Unexpected error on idle client', err);
});

function rowToRent(row) {
  if (!row) return null;
  return {
    rent_id: row.rent_id,
    battery_id: row.battery_id != null ? String(row.battery_id) : null,
    stripe_pi: row.stripe_pi,
    start_time: row.start_time,
    station_start: row.station_start,
    end_time: row.end_time,
    station_end: row.station_end
  };
}

/**
 * Validate and normalize an incoming battery_id.
 * The DB column is bigint and nullable. Accept number or numeric string.
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
function parseBatteryId(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  const str = String(raw).trim();
  if (!/^-?\d+$/.test(str)) {
    return { ok: false, error: 'battery_id must be an integer (or omitted)' };
  }
  return { ok: true, value: str };
}

/**
 * Validate an ISO-ish timestamp string. Accept anything Postgres can cast to timestamptz —
 * we let pg surface 22007 (invalid_datetime_format) as a 400 if the client sends garbage.
 */
function parseTimestamp(raw, fieldName) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  const value = String(raw).trim();
  if (!value) {
    return { ok: false, error: `${fieldName} cannot be an empty string` };
  }
  return { ok: true, value };
}

/**
 * POST /pos/start_rent
 * Body: { battery_id?, stripe_pi, start_time?, station_start }
 *   - stripe_pi (required): unique Stripe Payment Intent id for the rent.
 *   - station_start (required): station id where the battery was taken.
 *   - battery_id (optional): bigint reference to the rented battery.
 *   - start_time (optional): ISO timestamp; defaults to DB now().
 */
router.post('/pos/start_rent', async (req, res) => {
  const { battery_id, stripe_pi, start_time, station_start } = req.body || {};

  if (!stripe_pi || String(stripe_pi).trim() === '') {
    return res.status(400).json({ success: false, error: 'stripe_pi is required' });
  }
  if (!station_start || String(station_start).trim() === '') {
    return res.status(400).json({ success: false, error: 'station_start is required' });
  }

  const battery = parseBatteryId(battery_id);
  if (!battery.ok) {
    return res.status(400).json({ success: false, error: battery.error });
  }

  const startTime = parseTimestamp(start_time, 'start_time');
  if (!startTime.ok) {
    return res.status(400).json({ success: false, error: startTime.error });
  }

  let client;
  try {
    client = await pool.connect();

    // start_time is omitted from the column list when null so the column default (now()) applies.
    const cols = ['battery_id', 'stripe_pi', 'station_start'];
    const placeholders = ['$1', '$2', '$3'];
    const values = [battery.value, String(stripe_pi).trim(), String(station_start).trim()];

    if (startTime.value !== null) {
      cols.push('start_time');
      placeholders.push(`$${values.length + 1}`);
      values.push(startTime.value);
    }

    const sql = `
      INSERT INTO rents (${cols.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING rent_id, battery_id, stripe_pi, start_time, station_start, end_time, station_end
    `;

    const result = await client.query(sql, values);
    return res.status(201).json({
      success: true,
      data: rowToRent(result.rows[0]),
      message: 'Rent started successfully'
    });
  } catch (error) {
    console.error('Error starting rent:', error);
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A rent with that stripe_pi already exists'
      });
    }
    if (error.code === '22P02' || error.code === '22007') {
      return res.status(400).json({
        success: false,
        error: 'Invalid value for one of the fields (check battery_id / start_time format)'
      });
    }
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to start rent'
    });
  } finally {
    if (client) client.release();
  }
});

/**
 * PATCH /pos/end_rent
 * Body: { battery_id, station_end, end_time? }
 *   - battery_id (required): id of the powerbank being returned. The endpoint closes
 *     the currently-open rent (end_time IS NULL) for this battery.
 *   - station_end (required): station id where the battery was returned.
 *   - end_time (optional): ISO timestamp; defaults to current server time.
 *
 * battery_id is not unique in `rents` (the same battery is reused across rents),
 * so we scope the update to the single open rent for that battery. If — due to a
 * data anomaly — more than one open rent exists for the same battery, we refuse
 * the update with 409 so an operator can investigate instead of silently picking one.
 */
router.patch('/pos/end_rent', async (req, res) => {
  const { battery_id, end_time, station_end } = req.body || {};

  const battery = parseBatteryId(battery_id);
  if (!battery.ok) {
    return res.status(400).json({ success: false, error: battery.error });
  }
  if (battery.value === null) {
    return res.status(400).json({ success: false, error: 'battery_id is required' });
  }

  if (!station_end || String(station_end).trim() === '') {
    return res.status(400).json({ success: false, error: 'station_end is required' });
  }

  const endTime = parseTimestamp(end_time, 'end_time');
  if (!endTime.ok) {
    return res.status(400).json({ success: false, error: endTime.error });
  }

  let client;
  try {
    client = await pool.connect();

    // Resolve the one open rent for this battery first so we can return clear
    // 404 / 409 errors instead of an opaque "0 rows updated".
    const findSql = `
      SELECT rent_id
      FROM rents
      WHERE battery_id = $1 AND end_time IS NULL
      ORDER BY start_time DESC
    `;
    const open = await client.query(findSql, [battery.value]);

    if (open.rows.length === 0) {
      // Either the battery has no rent history at all, or every rent for it is closed.
      const anyRow = await client.query(
        'SELECT 1 FROM rents WHERE battery_id = $1 LIMIT 1',
        [battery.value]
      );
      if (anyRow.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `No rent found for battery_id ${battery.value}`
        });
      }
      return res.status(409).json({
        success: false,
        error: `No open rent for battery_id ${battery.value} (already returned)`
      });
    }

    if (open.rows.length > 1) {
      return res.status(409).json({
        success: false,
        error: `Multiple open rents found for battery_id ${battery.value} — manual reconciliation required`,
        rent_ids: open.rows.map((r) => r.rent_id)
      });
    }

    const rentId = open.rows[0].rent_id;
    const updateSql = `
      UPDATE rents
      SET end_time = $1, station_end = $2
      WHERE rent_id = $3
      RETURNING rent_id, battery_id, stripe_pi, start_time, station_start, end_time, station_end
    `;
    const result = await client.query(updateSql, [
      endTime.value !== null ? endTime.value : new Date().toISOString(),
      String(station_end).trim(),
      rentId
    ]);

    return res.json({
      success: true,
      data: rowToRent(result.rows[0]),
      message: 'Rent ended successfully'
    });
  } catch (error) {
    console.error('Error ending rent:', error);
    if (error.code === '22P02' || error.code === '22007') {
      return res.status(400).json({
        success: false,
        error: 'Invalid value for one of the fields (check battery_id / end_time format)'
      });
    }
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to end rent'
    });
  } finally {
    if (client) client.release();
  }
});

/**
 * GET /pos/rents
 * Returns all rent records, newest first.
 */
router.get('/pos/rents', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT rent_id, battery_id, stripe_pi, start_time, station_start, end_time, station_end
       FROM rents
       ORDER BY start_time DESC`
    );
    const data = result.rows.map(rowToRent);
    return res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching rents:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch rents'
    });
  } finally {
    if (client) client.release();
  }
});

console.log('📦 POS service API router initialized: POST /pos/start_rent, PATCH /pos/end_rent, GET /pos/rents');

module.exports = router;
