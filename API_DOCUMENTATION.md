# CUUB API Documentation

Base URL: `https://api.cuub.tech`

---

## Health

### 1. Health check

Check service health and availability.

```bash
curl -X GET https://api.cuub.tech/health
```

**Expected response**

```json
{
  "status": "ok",
  "service": "energo-token-extractor",
  "timestamp": "2026-02-06T19:41:35.755Z"
}
```

---

## Users

### 2. Fetch a list of all users

```bash
curl -X GET https://api.cuub.tech/users
```

**Expected response**

```json
{
  "success": true,
  "data": [
    {
      "id": "{id}",
      "username": "SilasMed",
      "type": "HOST",
      "created_at": "2026-01-21T22:50:13.388Z",
      "updated_at": "2026-01-21T22:50:13.388Z",
      "stations": ["{station_id}"]
    }
  ],
  "count": 1
}
```

### 3. Fetch a single user by ID

```bash
curl -X GET https://api.cuub.tech/users/{id}
```

**Expected response**

```json
{
  "success": true,
  "data": {
    "id": "{id}",
    "username": "SilasMed",
    "type": "HOST",
    "created_at": "2026-01-21T22:50:13.388Z",
    "updated_at": "2026-01-21T22:50:13.388Z",
    "stations": ["{station_id}"]
  }
}
```

### 4. Create a new user

```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "NewUser",
    "type": "HOST",
    "station_ids": ["{station_id}"]
  }'
```

**Body fields**

- `username` (required): Username
- `type` (optional): `HOST`, `DISTRIBUTOR`, or `ADMIN`. Default: `HOST`
- `station_id` (optional): Single station ID
- `station_ids` (optional): Array of station IDs

**Expected response**

```json
{
  "success": true,
  "data": {
    "id": "{id}",
    "username": "NewUser",
    "type": "HOST",
    "created_at": "2026-01-21T22:50:13.388Z",
    "updated_at": "2026-01-21T22:50:13.388Z",
    "stations": ["{station_id}"]
  },
  "message": "User created successfully"
}
```

### 5. Update a user

```bash
curl -X PATCH https://api.cuub.tech/users/{id} \
  -H "Content-Type: application/json" \
  -d '{
    "username": "UpdatedUser",
    "type": "DISTRIBUTOR",
    "station_ids": ["{station_id}"]
  }'
```

**Expected response**

```json
{
  "success": true,
  "data": {
    "id": "{id}",
    "username": "UpdatedUser",
    "type": "DISTRIBUTOR",
    "created_at": "2026-01-21T22:50:13.388Z",
    "updated_at": "2026-02-06T19:41:35.755Z",
    "stations": ["{station_id}"]
  },
  "message": "User updated successfully"
}
```

### 6. Delete a user

```bash
curl -X DELETE https://api.cuub.tech/users/{id}
```

**Expected response**

```json
{
  "success": true,
  "message": "User deleted successfully",
  "data": {
    "id": "{id}",
    "username": "SilasMed",
    "type": "HOST"
  }
}
```

---

## Stations

### 7. Fetch a list of all stations

```bash
curl -X GET https://api.cuub.tech/stations
```

**Expected response**

```json
{
  "success": true,
  "data": [
    {
      "id": "{station_id}",
      "title": "Station Name",
      "latitude": 40.7128,
      "longitude": -74.006,
      "updated_at": "2026-01-21T22:50:13.388Z",
      "address": null,
      "screen_id": null,
      "sim_id": null,
      "stripe_id": "cus_xxxxxxxxxxxx",
      "weekday_hours": {
        "mon": { "open": "09:00", "close": "17:00" },
        "tue": { "open": "09:00", "close": "17:00" },
        "wed": { "open": "09:00", "close": "17:00" },
        "thu": { "open": "09:00", "close": "17:00" },
        "fri": { "open": "09:00", "close": "17:00" }
      },
      "filled_slots": 4,
      "open_slots": 2,
      "online": true
    }
  ],
  "count": 1
}
```

`stripe_id` may be `null` if the station has no Stripe customer. `weekday_hours` is the parsed `jsonb` object (or `null` if unset).

### 8. Fetch a single station by ID

```bash
curl -X GET https://api.cuub.tech/stations/{id}
```

**Expected response**

```json
{
  "success": true,
  "data": {
    "id": "{station_id}",
    "title": "Station Name",
    "latitude": 40.7128,
    "longitude": -74.006,
    "updated_at": "2026-01-21T22:50:13.388Z",
    "address": null,
    "screen_id": null,
    "sim_id": null,
    "stripe_id": "cus_xxxxxxxxxxxx",
    "weekday_hours": {
      "mon": { "open": "09:00", "close": "17:00" },
      "tue": { "open": "09:00", "close": "17:00" },
      "wed": { "open": "09:00", "close": "17:00" },
      "thu": { "open": "09:00", "close": "17:00" },
      "fri": { "open": "09:00", "close": "17:00" }
    },
    "filled_slots": 4,
    "open_slots": 2,
    "online": true
  }
}
```

### 9. Export stations as CSV

```bash
curl -X GET https://api.cuub.tech/stations/export -o stations.csv
```

**Expected response**

Returns a CSV file download with columns: `id`, `title`, `latitude`, `longitude`, `updated_at`, `address`, `screen_id`, `sim_id`, `stripe_id`, `weekday_hours` (JSON string in the cell), `filled_slots`, `open_slots`, `online`.

### 10. Create a new station

```bash
curl -X POST https://api.cuub.tech/stations \
  -H "Content-Type: application/json" \
  -d '{
    "id": "STATION001",
    "title": "Main Street Station",
    "latitude": 40.7128,
    "longitude": -74.006
  }'
```

**Expected response**

```json
{
  "success": true,
  "data": {
    "id": "STATION001",
    "title": "Main Street Station",
    "latitude": 40.7128,
    "longitude": -74.006,
    "updated_at": "2026-02-06T19:41:35.755Z"
  },
  "message": "Station created successfully"
}
```

### 11. Update a station

```bash
curl -X PATCH https://api.cuub.tech/stations/{id} \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Station Name",
    "latitude": 40.75,
    "longitude": -74.01
  }'
```

**Expected response**

```json
{
  "success": true,
  "data": {
    "id": "{station_id}",
    "title": "Updated Station Name",
    "latitude": 40.75,
    "longitude": -74.01,
    "updated_at": "2026-02-06T19:41:35.755Z"
  },
  "message": "Station updated successfully"
}
```

### 12. Delete a station

```bash
curl -X DELETE https://api.cuub.tech/stations/{id}
```

**Expected response**

```json
{
  "success": true,
  "message": "Station deleted successfully",
  "data": {
    "id": "{station_id}",
    "title": "Station Name",
    "latitude": 40.7128,
    "longitude": -74.006
  }
}
```

---

## Tickets (maintenance)

Maintenance tickets stored in Postgres (`tickets` table). `station_id` must exist in `stations`.

The `task` column is `ticket_task[]` (array of enums). In JSON it is always a **string array** (e.g. `["Low Batteries", "Hardware Malfunction"]`). Create and update bodies should send `task` as an array. A **single string** is still accepted for legacy clients and is treated as a one-element array.

**Task labels** (use for multi-select UIs): `High Batteries`, `Low Batteries`, `No Batteries`, `Add Stack`, `Broken Battery`, `High Failure Rates`, `Hardware Malfunction`, `Unusually Offline`, `Urgent Other`, `Other`.

**UI hint (dashboards / maps):** treat **`Urgent Other`** as highest-priority styling (e.g. red) and **`Other`** as lower-priority (e.g. yellow); render every selected task in lists and detail views.

**List filtering:** `GET /tickets?task=...` uses **overlap** with the ticket’s array—rows are included if the ticket’s `task` array **contains any** of the filter values (not an exact array match). Repeat the query parameter or use multiple values as your HTTP client allows, e.g. `?task=Low Batteries&task=Other`.

### 13. Fetch a list of all tickets

```bash
curl -X GET https://api.cuub.tech/tickets
```

**Optional query**

- `task` (optional, repeatable): filter to tickets whose `task` array contains **any** of these enum values (PostgreSQL `task && ARRAY[...]::ticket_task[]`).

```bash
curl -G "https://api.cuub.tech/tickets" --data-urlencode "task=Low Batteries" --data-urlencode "task=Other"
```

**Expected response**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "location_name": "Kizami Sushi",
      "station_id": "{station_id}",
      "latitude": 41.88,
      "longitude": -87.63,
      "created_at": "2026-03-28T12:00:00.000Z",
      "task": ["Low Batteries", "Hardware Malfunction"],
      "description": "Optional notes"
    }
  ],
  "count": 1
}
```

### 14. Fetch a single ticket by ID

`{id}` is the numeric ticket primary key (not a station id).

```bash
curl -X GET https://api.cuub.tech/tickets/{id}
```

**Expected response**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "location_name": "Kizami Sushi",
    "station_id": "{station_id}",
    "latitude": 41.88,
    "longitude": -87.63,
    "created_at": "2026-03-28T12:00:00.000Z",
    "task": ["Low Batteries", "Hardware Malfunction"],
    "description": "Optional notes"
  }
}
```

### 15. Create a new ticket

```bash
curl -X POST https://api.cuub.tech/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "location_name": "Kizami Sushi",
    "station_id": "{station_id}",
    "latitude": 41.88,
    "longitude": -87.63,
    "task": ["Low Batteries", "Hardware Malfunction"],
    "description": "Optional notes"
  }'
```

**Body fields**

- `location_name` (required)
- `station_id` (required): must match an existing `stations.id`
- `latitude` (required): number between -90 and 90
- `longitude` (required): number between -180 and 180
- `task` (required): non-empty **array** of labels from the task list above (duplicates are deduplicated). Legacy: a single string is accepted as one task.
- `description` (optional)

**Expected response**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "location_name": "Kizami Sushi",
    "station_id": "{station_id}",
    "latitude": 41.88,
    "longitude": -87.63,
    "created_at": "2026-03-28T12:00:00.000Z",
    "task": ["Low Batteries", "Hardware Malfunction"],
    "description": "Optional notes"
  },
  "message": "Ticket created successfully"
}
```

### 16. Update a ticket

Send at least one field. If updating coordinates, send both `latitude` and `longitude` together. If updating `task`, send a non-empty array (replaces the whole list).

```bash
curl -X PATCH https://api.cuub.tech/tickets/{id} \
  -H "Content-Type: application/json" \
  -d '{
    "location_name": "Updated location name",
    "task": ["Hardware Malfunction", "Urgent Other"],
    "description": "Updated notes"
  }'
```

**Expected response**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "location_name": "Updated location name",
    "station_id": "{station_id}",
    "latitude": 41.88,
    "longitude": -87.63,
    "created_at": "2026-03-28T12:00:00.000Z",
    "task": ["Hardware Malfunction", "Urgent Other"],
    "description": "Updated notes"
  },
  "message": "Ticket updated successfully"
}
```

### 17. Delete a ticket

```bash
curl -X DELETE https://api.cuub.tech/tickets/{id}
```

**Expected response**

```json
{
  "success": true,
  "message": "Ticket deleted successfully",
  "data": {
    "id": 1,
    "location_name": "Kizami Sushi",
    "station_id": "{station_id}",
    "latitude": 41.88,
    "longitude": -87.63,
    "created_at": "2026-03-28T12:00:00.000Z",
    "task": ["Low Batteries", "Hardware Malfunction"],
    "description": "Optional notes"
  }
}
```

---

## Battery & Scans

### 18. Fetch battery information by sticker ID

```bash
curl -X GET https://api.cuub.tech/battery/{sticker_id}
```

**Expected response**

```json
{
  "success": true,
  "data": {
    "manufacture_id": "CUBH5A000513",
    "sticker_id": "A201",
    "startTime": "1736188800000",
    "returnTime": "1736275200000",
    "duration": "18:40:00",
    "amountPaid": 6
  }
}
```

### 19. Create a scan record (POST)

Records a scan for a battery. `sticker_type` is taken from `battery.type` in the database.

```bash
curl -X POST https://api.cuub.tech/battery/{sticker_id} \
  -H "Content-Type: application/json" \
  -H "manufacture_id: CUBH5A000513" \
  -d '{}'
```

**Headers**

- `manufacture_id` (optional): Required only if battery has no `manufacture_id` in DB

**Expected response**

```json
{
  "success": true,
  "data": {
    "scan_id": "125",
    "sticker_id": "A201",
    "order_id": null,
    "scan_time": "2026-02-06T19:41:35.755Z",
    "sticker_type": "Blue",
    "duration_after_rent": null,
    "sizl": true
  }
}
```

### 20. Update a scan record (PATCH)

Updates the most recent scan for the given sticker ID.

```bash
curl -X PATCH https://api.cuub.tech/battery/{sticker_id} \
  -H "manufacture_id: CUBH5A000513" \
  -H "sticker_type: NFC" \
  -H "Content-Type: application/json" \
  -d '{"sizl": true}'
```

**Headers**

- `manufacture_id` (required)
- `sticker_type` (optional)

**Body**

- `sizl` (optional): Boolean

**Expected response**

```json
{
  "success": true,
  "data": {
    "scan_id": "125",
    "sticker_id": "A201",
    "order_id": null,
    "scan_time": "2026-02-06T19:41:35.755Z",
    "sticker_type": "NFC",
    "duration_after_rent": null,
    "sizl": true
  }
}
```

### 21. Fetch all scan records

```bash
curl -X GET https://api.cuub.tech/scans
```

**Expected response**

```json
{
  "success": true,
  "data": [
    {
      "scan_id": "125",
      "sticker_id": "A201",
      "order_id": null,
      "scan_time": "2026-02-06T19:41:35.755Z",
      "sticker_type": "Blue",
      "duration_after_rent": null,
      "sizl": true
    }
  ],
  "count": 1
}
```

---

## Pop (Battery Release)

### 22. Pop battery from a specific slot (1–6)

```bash
curl -X POST https://api.cuub.tech/pop/{station_id}/{slot}
```

**Example**

```bash
curl -X POST https://api.cuub.tech/pop/STATION001/3
```

**Expected response**

```json
{
  "success": true,
  "data": [
    {
      "slot": 3,
      "manufacture_id": "CUBH5A000513"
    }
  ],
  "count": 1
}
```

### 23. Pop all batteries from all slots (1–6)

```bash
curl -X POST https://api.cuub.tech/pop/{station_id}/all
```

**Expected response**

```json
{
  "success": true,
  "data": [
    {
      "slot": 1,
      "manufacture_id": "CUBH5A000501"
    },
    {
      "slot": 2,
      "manufacture_id": "CUBH5A000502"
    }
  ],
  "count": 2
}
```

---

## Rents

### 24. Fetch rent data for a station within a date range

Date range format: `YYYY-MM-DD_YYYY-MM-DD` (e.g., `2026-01-01_2026-01-31`)

```bash
curl -X GET https://api.cuub.tech/rents/{station_id}/{startDate}_{endDate}
```

**Example**

```bash
curl -X GET https://api.cuub.tech/rents/STATION001/2026-01-01_2026-01-31
```

**Expected response**

```json
{
  "success": true,
  "data": {
    "station_id": "STATION001",
    "dateRange": "2026-01-01_2026-01-31",
    "totalAmount": 45.50,
    "totalRents": 15
  }
}
```

---

## Token

### 25. Retrieve Energo API token

Performs login to Energo backend (with captcha solving via OpenAI), saves the token to the database, and returns it.

```bash
curl -X GET https://api.cuub.tech/token
```

**Expected response**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error responses**

- 401: Login failed (invalid credentials)
- 500: Missing env vars (`ENERGO_USERNAME`, `ENERGO_PASSWORD`, `OPENAI_API_KEY`) or token capture failure

---

## Stripe

### 26. List charges

Returns all Stripe charges in a date range (`stripe.charges.list`, paginated until done). Requires `STRIPE_SECRET_KEY` and **from** and **to** query params.

**Query parameters**

- `from` (required): `YYYY-MM-DD` start date (America/Chicago).
- `to` (required): `YYYY-MM-DD` end date (America/Chicago).

**Example**

```bash
curl "https://api.cuub.tech/stripe/charges?from=2025-02-01&to=2025-02-08"
```

**Expected response**

```json
{
  "success": true,
  "data": [ /* Stripe charge objects */ ],
  "has_more": false
}
```

### 27. List balance transactions

Returns all Stripe balance transactions in a date range (`stripe.balanceTransactions.list`, paginated until done). Requires `STRIPE_SECRET_KEY` and **from** and **to** query params.

**Query parameters**

- `from` (required): `YYYY-MM-DD` start date (America/Chicago).
- `to` (required): `YYYY-MM-DD` end date (America/Chicago).

**Example**

```bash
curl "https://api.cuub.tech/stripe/balance-transactions?from=2025-02-01&to=2025-02-08"
```

**Expected response**

```json
{
  "success": true,
  "data": [ /* Stripe balance transaction objects */ ],
  "has_more": false
}
```

### 28. Rents by date range

Returns per-day rent count and net sum from Stripe **balance transactions** for the given date range. Path uses `YYYY-MM-DD_YYYY-MM-DD` (e.g. `2025-02-01_2025-02-08`). Filtered by `REVENUE_TYPES`. Includes previous-month comparison (`ppositive`, `pnegative`, `prents`, `pmoney`). All dates America/Chicago.

**Endpoint:** `GET /rents/:dateRange`

**Path**

- `dateRange`: `YYYY-MM-DD_YYYY-MM-DD` (start_end, underscore-separated).

**Example**

```bash
curl -X GET https://api.cuub.tech/rents/2025-02-01_2025-02-08
```

**Expected response**

```json
{
  "success": true,
  "range": "Feb 1, 2025 – Feb 8, 2025",
  "positive": 426,
  "negative": -57,
  "ppositive": 380,
  "pnegative": -42,
  "data": [
    { "date": "Feb 1, 2025", "rents": 5, "money": "$15", "prents": 4, "pmoney": "$12" },
    { "date": "Feb 2, 2025", "rents": 6, "money": "$18", "prents": 5, "pmoney": "$15" }
  ]
}
```

### 29. Rents by date range (all stations)

Returns net revenue per station for the given date range. Fetches charges in range, groups by `charge.customer` (Stripe ID), maps to `stations` for id/title; **money** = positive − negative. Only stations with at least one charge in the period and existing in DB.

**Endpoint:** `GET /rents/:dateRange/all`

**Path**

- `dateRange`: `YYYY-MM-DD_YYYY-MM-DD` (e.g. `2025-02-01_2025-02-08`).

**Example**

```bash
curl -X GET https://api.cuub.tech/rents/2025-02-01_2025-02-08/all
```

**Expected response**

```json
{
  "success": true,
  "range": "Feb 1, 2025 – Feb 8, 2025",
  "data": [
    { "station_title": "Annoyance Theater", "stripe_id": "cus_TeYJ78uzshxpCu", "station_id": "CUBT062510000029", "money": 120.5 },
    { "station_title": "Kizami Sushi", "stripe_id": "cus_TvTm9txqLOIDGI", "station_id": "CUBH242510000001", "money": 85.25 }
  ]
}
```

### 30. Rents recent (limit only)

Aggregated rents for the most recent N balance transactions, with no date filter. Days in `data` are those that appear in the last N transactions.

**Endpoint:** `GET /rents/recent`

**Query parameters**

- `limit` (optional): number of balance transactions to include (default 10, max 100).

**Example**

```bash
curl "https://api.cuub.tech/rents/recent?limit=10"
```

**Expected response**

```json
{
  "success": true,
  "positive": 45,
  "negative": -3,
  "data": [
    { "date": "Feb 8, 2026", "rents": 2, "money": "$6" },
    { "date": "Feb 9, 2026", "rents": 1, "money": "$3" }
  ]
}
```
