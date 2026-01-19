# CURL Examples for Scan Service API

## POST /battery/:sticker_id - Create a scan record

### Basic example (with default session_length = 0)
```bash
curl -X POST https://api.cuub.tech/battery/A201 \
  -H "Content-Type: application/json" \
  -H "manufacture_id: CUBH5A000513" \
  -H "sticker_type: QR_CODE" \
  -d '{}'
```

### Create scan with session_length (1 hour in seconds)
```bash
curl -X POST https://api.cuub.tech/battery/A201 \
  -H "Content-Type: application/json" \
  -H "manufacture_id: CUBH5A000513" \
  -H "sticker_type: QR_CODE" \
  -d '{
    "session_length": 3600
  }'
```

### Create scan with session_length (2 hours in seconds)
```bash
curl -X POST https://api.cuub.tech/battery/A201 \
  -H "Content-Type: application/json" \
  -H "manufacture_id: CUBH5A000513" \
  -H "sticker_type: NFC" \
  -d '{
    "session_length": 7200
  }'
```

### Create scan with session_length (30 minutes in seconds)
```bash
curl -X POST https://api.cuub.tech/battery/A201 \
  -H "Content-Type: application/json" \
  -H "manufacture_id: CUBH5A000513" \
  -H "sticker_type: QR_CODE" \
  -d '{
    "session_length": 1800
  }'
```

### Create scan with different sticker_id
```bash
curl -X POST https://api.cuub.tech/battery/B301 \
  -H "Content-Type: application/json" \
  -H "manufacture_id: CUBH5A000514" \
  -H "sticker_type: NFC" \
  -d '{
    "session_length": 4500
  }'
```

### Pretty-print response (with jq)
```bash
curl -X POST https://api.cuub.tech/battery/A201 \
  -H "Content-Type: application/json" \
  -H "manufacture_id: CUBH5A000513" \
  -H "sticker_type: QR_CODE" \
  -d '{
    "session_length": 1800
  }' | jq .
```

---

## PATCH /battery/:sticker_id - Update a scan record

### Update with manufacture_id only (refreshes order_id and duration_after_rent)
```bash
curl -X PATCH https://api.cuub.tech/battery/A201 \
  -H "manufacture_id: CUBH5A000513"
```

### Update sticker_type
```bash
curl -X PATCH https://api.cuub.tech/battery/A201 \
  -H "manufacture_id: CUBH5A000513" \
  -H "sticker_type: NFC"
```

### Update session_length (1.5 hours in seconds)
```bash
curl -X PATCH https://api.cuub.tech/battery/A201 \
  -H "session_length: 5400"
```

### Update multiple fields
```bash
curl -X PATCH https://api.cuub.tech/battery/A201 \
  -H "manufacture_id: CUBH5A000513" \
  -H "sticker_type: QR_CODE" \
  -H "session_length: 3600"
```

### Update different sticker_id
```bash
curl -X PATCH https://api.cuub.tech/battery/B301 \
  -H "manufacture_id: CUBH5A000514" \
  -H "sticker_type: NFC" \
  -H "session_length: 7200"
```

### Pretty-print response (with jq)
```bash
curl -X PATCH https://api.cuub.tech/battery/A201 \
  -H "manufacture_id: CUBH5A000513" \
  -H "sticker_type: NFC" \
  -H "session_length: 7200" | jq .
```

---

## GET /scans - List all scan records

```bash
curl https://api.cuub.tech/scans
```

### Pretty-print response
```bash
curl https://api.cuub.tech/scans | jq .
```

**Note:** This endpoint returns all scan records ordered by `scan_time` (descending).

---

## GET /battery/:sticker_id - Get battery information by sticker_id

```bash
curl https://api.cuub.tech/battery/A201
```

### Get battery info for different sticker_id
```bash
curl https://api.cuub.tech/battery/B301
```

### Pretty-print response
```bash
curl https://api.cuub.tech/battery/A201 | jq .
```

**Note:** This endpoint returns battery information including:
- `manufacture_id`
- `sticker_id`
- `startTime` (epoch timestamp)
- `returnTime` (epoch timestamp, null if not returned)
- `duration` (formatted as HH:MM:SS)
- `amountPaid` (calculated based on pricing model)

---

## Notes

### Scan Service API
- All endpoints return JSON responses
- **POST `/battery/:sticker_id`**:
  - Required headers: `manufacture_id`, `sticker_type`
  - Optional body field: `session_length` (defaults to 0, in seconds)
  - Automatically fetches `order_id` and calculates `duration_after_rent` from Relink API
  - Creates a new scan record in the `scans` table
- **PATCH `/battery/:sticker_id`**:
  - Required header: `manufacture_id`
  - Optional headers: `sticker_type`, `session_length` (in seconds)
  - Updates the most recent scan record for the given `sticker_id`
  - Automatically refreshes `order_id` and `duration_after_rent` from Relink API if `manufacture_id` is provided
- **GET `/scans`**:
  - Returns all scan records ordered by `scan_time` (descending)
  - Includes: `scan_id`, `sticker_id`, `order_id`, `scan_time`, `session_length`, `sticker_type`, `duration_after_rent`
- **GET `/battery/:sticker_id`**:
  - Returns battery information including `duration` and `amountPaid`
  - `duration` is calculated from `startTime` to `returnTime` (or current time if `returnTime` is null)
  - `amountPaid` follows pricing: $3 per 24 hours, max $21 for 7 days, $24 penalty after 7 days
