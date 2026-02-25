const express = require('express');
const { DateTime } = require('luxon');
const { Pool } = require('pg');
const router = express.Router();

const CHICAGO_ZONE = 'America/Chicago';

// Set STRIPE_SECRET_KEY in .env or Cloud Run (never commit the real key)
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null;

// Database pool for station lookup (stations.stripe_id = charge.customer)
const CLOUD_SQL_CONNECTION_NAME = process.env.CLOUD_SQL_CONNECTION_NAME || 'keyextract-482721:us-central1:cuub-db';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASS = process.env.DB_PASS || '1Cuubllc!';
const DB_NAME = process.env.DB_NAME || 'postgres';
const poolConfig = {
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
};
if (CLOUD_SQL_CONNECTION_NAME && CLOUD_SQL_CONNECTION_NAME.includes(':')) {
  poolConfig.host = `/cloudsql/${CLOUD_SQL_CONNECTION_NAME}`;
} else {
  poolConfig.host = process.env.DB_HOST || 'localhost';
  poolConfig.port = process.env.DB_PORT || 5432;
}
const pool = new Pool(poolConfig);

/**
 * Return YYYY-MM-DD for a Unix timestamp (seconds) in Chicago time (for grouping and mtd range).
 */
function chicagoDateStringFromUnix(unixSeconds) {
  return DateTime.fromSeconds(unixSeconds, { zone: 'utc' }).setZone(CHICAGO_ZONE).toISODate().slice(0, 10);
}

/**
 * Parse a date string (YYYY-MM-DD) to Unix seconds. America/Chicago.
 * endOfDay: if true, use end of day; else start of day.
 */
function parseDateToUnixSeconds(value, endOfDay = false) {
  const dt = DateTime.fromISO(value + 'T00:00:00', { zone: CHICAGO_ZONE });
  const d = endOfDay ? dt.endOf('day') : dt.startOf('day');
  return Math.floor(d.toSeconds());
}

/**
 * Parse path param dateRange "YYYY-MM-DD_YYYY-MM-DD" into { fromStr, toStr }.
 * Returns null if invalid.
 */
function parseDateRangeParam(dateRange) {
  if (!dateRange || typeof dateRange !== 'string') return null;
  const parts = dateRange.split('_');
  if (parts.length !== 2) return null;
  const [fromStr, toStr] = parts.map((s) => s.trim());
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromStr) || !re.test(toStr)) return null;
  const fromDt = DateTime.fromISO(fromStr + 'T00:00:00', { zone: CHICAGO_ZONE });
  const toDt = DateTime.fromISO(toStr + 'T00:00:00', { zone: CHICAGO_ZONE });
  if (!fromDt.isValid || !toDt.isValid || fromDt > toDt) return null;
  return { fromStr, toStr };
}

/**
 * Fetch all balance transactions in a date range (paginates until done).
 */
async function fetchAllBalanceTransactionsInRange(gteUnix, lteUnix) {
  const all = [];
  let startingAfter = undefined;
  do {
    const listParams = {
      limit: 100,
      created: { gte: gteUnix, lte: lteUnix },
      ...(startingAfter && { starting_after: startingAfter }),
    };
    const batch = await stripe.balanceTransactions.list(listParams);
    all.push(...batch.data);
    startingAfter = batch.has_more ? batch.data[batch.data.length - 1].id : null;
  } while (startingAfter);
  return all;
}

/**
 * Fetch all charges in a date range (paginates until done).
 * @param {number} gteUnix - start of range (Unix seconds)
 * @param {number} lteUnix - end of range (Unix seconds)
 * @param {string} [customerId] - optional Stripe customer ID (maps to stations.stripe_id) to filter by
 */
async function fetchAllChargesInRange(gteUnix, lteUnix, customerId = null) {
  const all = [];
  let startingAfter = undefined;
  do {
    const listParams = {
      limit: 100,
      created: { gte: gteUnix, lte: lteUnix },
      ...(customerId && { customer: customerId }),
      ...(startingAfter && { starting_after: startingAfter }),
    };
    const batch = await stripe.charges.list(listParams);
    all.push(...batch.data);
    startingAfter = batch.has_more ? batch.data[batch.data.length - 1].id : null;
  } while (startingAfter);
  return all;
}

/**
 * Format date string YYYY-MM-DD as "Feb 1, 2026" (interpreted as local date for display).
 */
function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

// Transaction types included in positive/negative revenue (customer revenue + fee types for true net).
const REVENUE_TYPES = new Set([
  'charge',
  'payment',
  'payment_refund',
  'refund',
  'payment_reversal',
  'payment_failure_refund',
  'stripe_fee',
  'stripe_fx_fee',
  'tax_fee',
]);

/**
 * Aggregate balance transactions into positive/negative totals and per-day rents/money.
 * @param {Array} balanceTransactions - from Stripe
 * @param {string[]} [dayKeys] - optional sorted list of YYYY-MM-DD keys; if provided, byDay is pre-initialized with these days
 * @returns {{ positiveCents: number, negativeCents: number, byDay: Object }}
 */
function aggregateRents(balanceTransactions, dayKeys = null) {
  const byDay = {};
  if (Array.isArray(dayKeys)) {
    for (const key of dayKeys) {
      byDay[key] = { date: formatDateLabel(key), rents: 0, netCents: 0 };
    }
  }
  let positiveCents = 0;
  let negativeCents = 0;
  for (const bt of balanceTransactions) {
    const net = bt.net != null ? bt.net : 0;
    const type = bt.type || '';
    const key = chicagoDateStringFromUnix(bt.created);
    if (!REVENUE_TYPES.has(type)) continue;
    if (net > 0) positiveCents += net;
    else if (net < 0) negativeCents += net;
    if (!byDay[key]) byDay[key] = { date: formatDateLabel(key), rents: 0, netCents: 0 };
    byDay[key].netCents += net;
    if (type === 'charge' && net > 0) byDay[key].rents += 1;
  }
  return { positiveCents, negativeCents, byDay };
}

/**
 * Aggregate charges into positive/negative totals and per-day rents/money.
 * positive = sum of amount_captured; negative = sum of amount_refunded; money = net (amount_captured - amount_refunded) per day.
 * @param {Array} charges - from stripe.charges.list
 * @param {string[]} [dayKeys] - optional sorted list of YYYY-MM-DD keys
 * @returns {{ positiveCents: number, negativeCents: number, byDay: Object }}
 */
function aggregateCharges(charges, dayKeys = null) {
  const byDay = {};
  if (Array.isArray(dayKeys)) {
    for (const key of dayKeys) {
      byDay[key] = { date: formatDateLabel(key), rents: 0, netCents: 0 };
    }
  }
  let positiveCents = 0;
  let negativeCents = 0;
  for (const ch of charges) {
    const captured = ch.amount_captured ?? ch.amount ?? 0;
    const refunded = ch.amount_refunded ?? 0;
    // Only count refunds when there was a capture (exclude amount_captured:0, amount_refunded:300)
    const net = captured > 0 ? captured - refunded : 0;
    const refundForNegative = captured > 0 ? refunded : 0;
    const key = chicagoDateStringFromUnix(ch.created);
    positiveCents += captured;
    negativeCents += refundForNegative;
    if (!byDay[key]) byDay[key] = { date: formatDateLabel(key), rents: 0, netCents: 0 };
    byDay[key].netCents += net;
    if (net > 0) byDay[key].rents += 1;
  }
  return { positiveCents, negativeCents, byDay };
}

/**
 * GET /rents/:dateRange
 * dateRange format: YYYY-MM-DD_YYYY-MM-DD (e.g. 2025-02-01_2025-02-08).
 * Aggregated rents for that range from Stripe balance transactions. Includes previous-month comparison.
 */
router.get('/rents/:dateRange', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ success: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' });
  }
  const parsed = parseDateRangeParam(req.params.dateRange);
  if (!parsed) {
    return res.status(400).json({ success: false, error: 'Invalid dateRange. Use YYYY-MM-DD_YYYY-MM-DD (e.g. 2025-02-01_2025-02-08).' });
  }
  const { fromStr: fromParam, toStr: toParam } = parsed;
  try {
    const fromDt = DateTime.fromISO(fromParam + 'T00:00:00', { zone: CHICAGO_ZONE });
    const toDt = DateTime.fromISO(toParam + 'T00:00:00', { zone: CHICAGO_ZONE });
    const dayKeys = [];
    let d = fromDt;
    while (d <= toDt) {
      dayKeys.push(d.toISODate().slice(0, 10));
      d = d.plus({ days: 1 });
    }
    const prevFromDt = fromDt.minus({ months: 1 });
    const prevToDt = toDt.minus({ months: 1 });
    const prevFromParam = prevFromDt.toISODate().slice(0, 10);
    const prevToParam = prevToDt.toISODate().slice(0, 10);
    const gte = parseDateToUnixSeconds(fromParam, false);
    const lte = parseDateToUnixSeconds(toParam, true);
    const gtePrev = parseDateToUnixSeconds(prevFromParam, false);
    const ltePrev = parseDateToUnixSeconds(prevToParam, true);

    const [balanceTransactions, prevBalanceTransactions] = await Promise.all([
      fetchAllBalanceTransactionsInRange(gte, lte),
      fetchAllBalanceTransactionsInRange(gtePrev, ltePrev),
    ]);

    const prevDayKeys = [];
    let dp = prevFromDt;
    while (dp <= prevToDt) {
      prevDayKeys.push(dp.toISODate().slice(0, 10));
      dp = dp.plus({ days: 1 });
    }

    const { positiveCents, negativeCents, byDay } = aggregateRents(balanceTransactions, dayKeys);
    const { positiveCents: ppositiveCents, negativeCents: pnegativeCents, byDay: byDayPrev } = aggregateRents(prevBalanceTransactions, prevDayKeys);

    const data = dayKeys.map((key) => {
      const [y, m, day] = key.split('-').map(Number);
      const prevKey = DateTime.fromObject({ year: y, month: m, day }, { zone: CHICAGO_ZONE })
        .minus({ months: 1 })
        .toISODate()
        .slice(0, 10);
      const prev = byDayPrev[prevKey];
      return {
        date: byDay[key].date,
        rents: byDay[key].rents,
        money: '$' + (byDay[key].netCents / 100).toFixed(0),
        prents: prev ? prev.rents : 0,
        pmoney: prev ? '$' + (prev.netCents / 100).toFixed(0) : '$0',
      };
    });

    res.json({
      success: true,
      range: `${formatDateLabel(fromParam)} – ${formatDateLabel(toParam)}`,
      positive: positiveCents / 100,
      negative: negativeCents / 100,
      ppositive: ppositiveCents / 100,
      pnegative: pnegativeCents / 100,
      data,
    });
  } catch (error) {
    console.error('Stripe API error (rents/:dateRange):', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to fetch rents for date range',
    });
  }
});

/**
 * GET /rents/:dateRange/all
 * dateRange format: YYYY-MM-DD_YYYY-MM-DD. Returns net revenue per station for that range.
 */
router.get('/rents/:dateRange/all', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ success: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' });
  }
  const parsed = parseDateRangeParam(req.params.dateRange);
  if (!parsed) {
    return res.status(400).json({ success: false, error: 'Invalid dateRange. Use YYYY-MM-DD_YYYY-MM-DD (e.g. 2025-02-01_2025-02-08).' });
  }
  const { fromStr, toStr } = parsed;
  let client;
  try {
    const gte = parseDateToUnixSeconds(fromStr, false);
    const lte = parseDateToUnixSeconds(toStr, true);

    const charges = await fetchAllChargesInRange(gte, lte);
    const byStripeId = {};
    for (const ch of charges) {
      const sid = ch.customer || '';
      if (!sid) continue;
      if (!byStripeId[sid]) byStripeId[sid] = [];
      byStripeId[sid].push(ch);
    }

    client = await pool.connect();
    const stationResult = await client.query(
      "SELECT id, title, stripe_id FROM stations WHERE stripe_id IS NOT NULL AND stripe_id != ''"
    );
    const stationByStripeId = {};
    for (const r of stationResult.rows) {
      const sid = (r.stripe_id || '').trim();
      if (sid) stationByStripeId[sid] = r;
    }

    const data = [];
    for (const sid of Object.keys(stationByStripeId)) {
      const station = stationByStripeId[sid];
      if (!station) continue;
      const chargesForStation = byStripeId[sid] || [];
      const { positiveCents, negativeCents } = aggregateCharges(chargesForStation);
      const money = (positiveCents - negativeCents) / 100;
      data.push({
        station_title: station.title || '',
        stripe_id: sid,
        station_id: station.id || '',
        money: Math.round(money * 100) / 100,
      });
    }
    data.sort((a, b) => (b.money - a.money) || String(a.station_id).localeCompare(b.station_id));

    res.json({
      success: true,
      range: `${formatDateLabel(fromStr)} – ${formatDateLabel(toStr)}`,
      data,
    });
  } catch (error) {
    console.error('Stripe API error (rents/:dateRange/all):', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to fetch rents all for date range',
    });
  } finally {
    if (client) client.release();
  }
});

/**
 * GET /rents/recent?limit=N
 * Aggregated rents for the most recent N balance transactions (no date filter). Default limit 10, max 100.
 */
router.get('/rents/recent', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ success: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' });
  }
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const listResult = await stripe.balanceTransactions.list({ limit });
    const balanceTransactions = listResult.data;
    const { positiveCents, negativeCents, byDay } = aggregateRents(balanceTransactions);
    const dayKeys = Object.keys(byDay).sort();
    const data = dayKeys.map((key) => ({
      date: byDay[key].date,
      rents: byDay[key].rents,
      money: '$' + (byDay[key].netCents / 100).toFixed(0),
    }));
    res.json({
      success: true,
      positive: positiveCents / 100,
      negative: negativeCents / 100,
      data,
    });
  } catch (error) {
    console.error('Stripe API error (rents/recent):', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to fetch rents recent',
    });
  }
});

/**
 * GET /stripe/charges?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns all Stripe charges in the date range (paginates until done). from and to required.
 */
router.get('/stripe/charges', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ success: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' });
  }
  const fromParam = req.query.from;
  const toParam = req.query.to;
  if (!fromParam || !toParam) {
    return res.status(400).json({ success: false, error: 'Query params from and to (YYYY-MM-DD) are required.' });
  }
  try {
    const fromDt = DateTime.fromISO(fromParam + 'T00:00:00', { zone: CHICAGO_ZONE });
    const toDt = DateTime.fromISO(toParam + 'T00:00:00', { zone: CHICAGO_ZONE });
    if (fromDt > toDt) {
      return res.status(400).json({ success: false, error: 'from must be on or before to.' });
    }
    const gte = parseDateToUnixSeconds(fromParam, false);
    const lte = parseDateToUnixSeconds(toParam, true);
    const charges = await fetchAllChargesInRange(gte, lte);
    res.json({
      success: true,
      data: charges,
      has_more: false,
    });
  } catch (error) {
    console.error('Stripe API error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to fetch charges',
    });
  }
});

/**
 * GET /stripe/balance-transactions?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns all Stripe balance transactions in the date range (paginates until done). from and to required.
 */
router.get('/stripe/balance-transactions', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ success: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' });
  }
  const fromParam = req.query.from;
  const toParam = req.query.to;
  if (!fromParam || !toParam) {
    return res.status(400).json({ success: false, error: 'Query params from and to (YYYY-MM-DD) are required.' });
  }
  try {
    const fromDt = DateTime.fromISO(fromParam + 'T00:00:00', { zone: CHICAGO_ZONE });
    const toDt = DateTime.fromISO(toParam + 'T00:00:00', { zone: CHICAGO_ZONE });
    if (fromDt > toDt) {
      return res.status(400).json({ success: false, error: 'from must be on or before to.' });
    }
    const gte = parseDateToUnixSeconds(fromParam, false);
    const lte = parseDateToUnixSeconds(toParam, true);
    const balanceTransactions = await fetchAllBalanceTransactionsInRange(gte, lte);
    res.json({
      success: true,
      data: balanceTransactions,
      has_more: false,
    });
  } catch (error) {
    console.error('Stripe API error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to fetch balance transactions',
    });
  }
});

module.exports = router;
