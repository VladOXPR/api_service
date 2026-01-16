# CURL Examples for User Service API

## POST /users - Create a new user

### Basic example (creates a HOST user by default)
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "username": "johndoe",
    "email": "john.doe@example.com",
    "password": "securePassword123"
  }'
```

### Create an ADMIN user
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin User",
    "username": "admin_user",
    "email": "admin@example.com",
    "password": "adminPassword123",
    "type": "ADMIN"
  }'
```

### Create a DISTRIBUTOR user
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Distributor Name",
    "username": "distributor1",
    "email": "distributor@example.com",
    "password": "distPassword123",
    "type": "DISTRIBUTOR"
  }'
```

### Pretty-print response (with jq)
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "username": "janesmith",
    "email": "jane.smith@example.com",
    "password": "janePassword123",
    "type": "HOST"
  }' | jq .
```

---

## GET /users - List all users

```bash
curl https://api.cuub.tech/users
```

### Pretty-print response
```bash
curl https://api.cuub.tech/users | jq .
```

---

## GET /users/:id - Get user by ID

```bash
curl https://api.cuub.tech/users/16050213-9187-46d3-a526-acec0723bc8f
```

### Pretty-print response
```bash
curl https://api.cuub.tech/users/16050213-9187-46d3-a526-acec0723bc8f | jq .
```

---

## PATCH /users/:id - Update user

```bash
curl -X PATCH https://api.cuub.tech/users/16050213-9187-46d3-a526-acec0723bc8f \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Name",
    "email": "updated@example.com"
  }'
```

### Update only password
```bash
curl -X PATCH https://api.cuub.tech/users/16050213-9187-46d3-a526-acec0723bc8f \
  -H "Content-Type: application/json" \
  -d '{
    "password": "newPassword123"
  }'
```

### Update user type
```bash
curl -X PATCH https://api.cuub.tech/users/16050213-9187-46d3-a526-acec0723bc8f \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ADMIN"
  }'
```

---

## DELETE /users/:id - Delete user

```bash
curl -X DELETE https://api.cuub.tech/users/16050213-9187-46d3-a526-acec0723bc8f
```

### Pretty-print response
```bash
curl -X DELETE https://api.cuub.tech/users/16050213-9187-46d3-a526-acec0723bc8f | jq .
```

---

---

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

---

## GET /stations/:id - Get station by ID

```bash
curl https://api.cuub.tech/stations/station-001
```

### Pretty-print response
```bash
curl https://api.cuub.tech/stations/station-001 | jq .
```

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

---

## DELETE /stations/:id - Delete station

```bash
curl -X DELETE https://api.cuub.tech/stations/station-001
```

### Pretty-print response
```bash
curl -X DELETE https://api.cuub.tech/stations/station-001 | jq .
```

---

## Notes

### User Service API
- All endpoints return JSON responses
- Required fields for POST: `name`, `username`, `email`, `password`
- Optional field: `type` (must be one of: `HOST`, `DISTRIBUTOR`, `ADMIN`)
- User ID is a UUID automatically generated by the database
- Passwords are stored as plain text (consider hashing in production)

### Map Service API (Stations)
- All endpoints return JSON responses
- Required fields for POST: `id`, `title`, `latitude`, `longitude`
- Station `id` is a text field (not auto-generated, must be provided)
- `latitude` must be between -90 and 90
- `longitude` must be between -180 and 180
- `updated_at` is automatically set/updated by the database

