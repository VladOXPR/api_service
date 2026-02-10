const express = require('express');
const router = express.Router();

// Set STRIPE_SECRET_KEY in .env or Cloud Run (never commit the real key)
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null;

/**
 * Parse a date string (YYYY-MM-DD) or "mtd" to Unix seconds (start of day UTC).
 * "mtd" = first day of current month.
 */
function parseDateToUnixSeconds(value, endOfDay = false) {
  let date;
  if (value === 'mtd' || value === undefined) {
    date = new Date();
    date.setUTCDate(1);
    date.setUTCHours(0, 0, 0, 0);
  } else {
    date = new Date(value + 'T00:00:00.000Z');
  }
  if (endOfDay) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return Math.floor(date.getTime() / 1000);
}

/**
 * Fetch all payment intents in a date range (paginates until done).
 */
async function fetchAllPaymentIntentsInRange(gteUnix, lteUnix) {
  const all = [];
  let startingAfter = undefined;
  do {
    const listParams = {
      limit: 100,
      created: { gte: gteUnix, lte: lteUnix },
      ...(startingAfter && { starting_after: startingAfter }),
    };
    const batch = await stripe.paymentIntents.list(listParams);
    all.push(...batch.data);
    startingAfter = batch.has_more ? batch.data[batch.data.length - 1].id : null;
  } while (startingAfter);
  return all;
}

/**
 * Format date as "Feb 1, 2026"
 */
function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00.000Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * GET /rents/mtd
 * Returns month-to-date rents: per-day count and sum of amount_received from Stripe payment intents.
 */
router.get('/rents/mtd', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ success: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' });
  }
  try {
    const now = new Date();
    const gte = parseDateToUnixSeconds('mtd', false);
    const lte = Math.floor(now.getTime() / 1000);

    const paymentIntents = await fetchAllPaymentIntentsInRange(gte, lte);

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayCount = Math.round((today - monthStart) / (24 * 60 * 60 * 1000)) + 1;

    const byDay = {};
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(monthStart);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      byDay[key] = { date: formatDateLabel(key), rents: 0, amountCents: 0 };
    }

    for (const pi of paymentIntents) {
      const amount = pi.amount_received != null ? pi.amount_received : 0;
      if (amount <= 0) continue;
      const created = new Date(pi.created * 1000);
      const key = created.toISOString().slice(0, 10);
      if (byDay[key]) {
        byDay[key].rents += 1;
        byDay[key].amountCents += amount;
      }
    }

    const firstDayStr = monthStart.toISOString().slice(0, 10);
    const lastDayStr = now.toISOString().slice(0, 10);

    const data = Object.keys(byDay)
      .sort()
      .map((key) => ({
        date: byDay[key].date,
        rents: byDay[key].rents,
        money: '$' + (byDay[key].amountCents / 100).toFixed(0),
      }));

    res.json({
      success: true,
      mtd: `${formatDateLabel(firstDayStr)} – ${formatDateLabel(lastDayStr)}`,
      data,
    });
  } catch (error) {
    console.error('Stripe API error (rents/mtd):', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to fetch rents mtd',
    });
  }
});

/**
 * GET /stripe/payment-intents
 * Returns Stripe payment intents, optionally filtered by date range.
 * Query:
 *   - limit (optional, default 10, max 100) when no date filter.
 *   - from (optional): YYYY-MM-DD or "mtd" for month-to-date (first day of current month).
 *   - to (optional): YYYY-MM-DD; defaults to today when "from" is set.
 */
router.get('/stripe/payment-intents', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ success: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' });
  }
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 100);
    const fromParam = req.query.from;
    const toParam = req.query.to;

    const listParams = { limit };

    if (fromParam !== undefined && fromParam !== '') {
      const gte = parseDateToUnixSeconds(fromParam === 'mtd' ? 'mtd' : fromParam, false);
      const lte = toParam
        ? parseDateToUnixSeconds(toParam, true)
        : parseDateToUnixSeconds(new Date().toISOString().slice(0, 10), true);
      listParams.created = { gte, lte };
    }

    const paymentIntents = await stripe.paymentIntents.list(listParams);

    res.json({
      success: true,
      data: paymentIntents.data,
      has_more: paymentIntents.has_more,
    });
  } catch (error) {
    console.error('Stripe API error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to fetch payment intents',
    });
  }
});

module.exports = router;
