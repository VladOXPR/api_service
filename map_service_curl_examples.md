# CURL Examples for Map Service API (Stations)

## POST /stations - Create a new station

### Basic example
```bash
curl -X POST https://api.cuub.tech/stations \
  -H "Content-Type: application/json" \
  -d '{
    "id": "station-001",
    "title": "Downtown Station",
    "latitude": 40.7128,
    "longitude": -74.0060
  }'
```

### Create station with different coordinates
```bash
curl -X POST https://api.cuub.tech/stations \
  -H "Content-Type: application/json" \
  -d '{
    "id": "station-002",
    "title": "Airport Station",
    "latitude": 40.6413,
    "longitude": -73.7781
  }'
```

### Create station with address, screen_id, and sim_id
```bash
curl -X POST https://api.cuub.tech/stations \
  -H "Content-Type: application/json" \
  -d '{
    "id": "station-003",
    "title": "Central Park Station",
    "latitude": 40.7829,
    "longitude": -73.9654,
    "address": "123 Central Park West, New York, NY",
    "screen_id": "SCREEN-001",
    "sim_id": "SIM-001"
  }'
```

### Pretty-print response (with jq)
```bash
curl -X POST https://api.cuub.tech/stations \
  -H "Content-Type: application/json" \
  -d '{
    "id": "station-003",
    "title": "Central Park Station",
    "latitude": 40.7829,
    "longitude": -73.9654
  }' | jq .
```

---

## GET /stations - List all stations

```bash
curl https://api.cuub.tech/stations
```

### Pretty-print response
```bash
curl https://api.cuub.tech/stations | jq .
```

**Note:** This endpoint returns stations enriched with `filled_slots` and `open_slots` data fetched from the Relink API.

---

## GET /stations/:id - Get station by ID

```bash
curl https://api.cuub.tech/stations/station-001
```

### Get station by actual station ID
```bash
curl https://api.cuub.tech/stations/CUBT062510000029
```

### Pretty-print response
```bash
curl https://api.cuub.tech/stations/station-001 | jq .
```

**Note:** This endpoint returns the station enriched with `filled_slots` and `open_slots` data fetched from the Relink API.

---

## GET /stations/export - Export stations to CSV

```bash
curl https://api.cuub.tech/stations/export
```

### Save CSV to file
```bash
curl https://api.cuub.tech/stations/export -o stations_export.csv
```

### Pretty-print CSV (if viewing in terminal)
```bash
curl https://api.cuub.tech/stations/export
```

**Note:** This endpoint exports all stations data to CSV format with filename `stations_{YYYY-MM-DD}.csv`. The CSV includes `latitude`, `longitude`, `updated_at`, `title`, `id`, `address`, `screen_id`, `sim_id`, `filled_slots`, and `open_slots`.

---

## PATCH /stations/:id - Update station

### Update title and coordinates
```bash
curl -X PATCH https://api.cuub.tech/stations/station-001 \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Station Name",
    "latitude": 40.7589,
    "longitude": -73.9851
  }'
```

### Update only title
```bash
curl -X PATCH https://api.cuub.tech/stations/station-001 \
  -H "Content-Type: application/json" \
  -d '{
    "title": "New Station Name"
  }'
```

### Update only coordinates
```bash
curl -X PATCH https://api.cuub.tech/stations/station-001 \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 40.7589,
    "longitude": -73.9851
  }'
```

### Update only latitude
```bash
curl -X PATCH https://api.cuub.tech/stations/station-001 \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 40.7589
  }'
```

### Update address, screen_id, and sim_id
```bash
curl -X PATCH https://api.cuub.tech/stations/station-001 \
  -H "Content-Type: application/json" \
  -d '{
    "address": "456 New Street, Chicago, IL",
    "screen_id": "SCREEN-002",
    "sim_id": "SIM-002"
  }'
```

### Update multiple fields
```bash
curl -X PATCH https://api.cuub.tech/stations/station-001 \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Station",
    "latitude": 41.8781,
    "longitude": -87.6298,
    "address": "789 Michigan Ave, Chicago, IL"
  }'
```

### Pretty-print response
```bash
curl -X PATCH https://api.cuub.tech/stations/station-001 \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Station Name",
    "latitude": 40.7589,
    "longitude": -73.9851
  }' | jq .
```

---

## DELETE /stations/:id - Delete station

```bash
curl -X DELETE https://api.cuub.tech/stations/station-001
```

### Delete station by actual station ID
```bash
curl -X DELETE https://api.cuub.tech/stations/CUBT062510000029
```

### Pretty-print response
```bash
curl -X DELETE https://api.cuub.tech/stations/station-001 | jq .
```

---

## Notes

### Map Service API (Stations)
- All endpoints return JSON responses (except `/stations/export` which returns CSV)
- Required fields for POST: `id`, `title`, `latitude`, `longitude`
- Optional fields for POST: `address`, `screen_id`, `sim_id`
- Station `id` is a text field (not auto-generated, must be provided)
- `latitude` must be between -90 and 90
- `longitude` must be between -180 and 180
- `updated_at` is automatically set/updated by the database
- GET endpoints (`/stations` and `/stations/:id`) automatically fetch and include `filled_slots` and `open_slots` from the Relink API
- The `/stations/export` endpoint exports data to CSV format with all station information including battery availability data
