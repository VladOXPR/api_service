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

### Create a HOST user
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "username": "janesmith",
    "email": "jane.smith@example.com",
    "password": "janePassword123",
    "type": "HOST"
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

### Update multiple fields
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

### Update only name
```bash
curl -X PATCH https://api.cuub.tech/users/16050213-9187-46d3-a526-acec0723bc8f \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Name"
  }'
```

### Update only email
```bash
curl -X PATCH https://api.cuub.tech/users/16050213-9187-46d3-a526-acec0723bc8f \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newemail@example.com"
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

### Pretty-print response
```bash
curl -X PATCH https://api.cuub.tech/users/16050213-9187-46d3-a526-acec0723bc8f \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Name",
    "email": "updated@example.com"
  }' | jq .
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

## POST /pop/:station_id/:slot - Pop out a battery from a specific slot

### Pop battery from slot 1
```bash
curl -X POST https://api.cuub.tech/pop/CUBT062510000029/1
```

### Pop battery from slot 3
```bash
curl -X POST https://api.cuub.tech/pop/CUBT062510000029/3
```

### Pop battery from slot 6
```bash
curl -X POST https://api.cuub.tech/pop/CUBT062510000029/6
```

### Pop battery from different station
```bash
curl -X POST https://api.cuub.tech/pop/CUBT062510000030/2
```

### Pretty-print response (with jq)
```bash
curl -X POST https://api.cuub.tech/pop/CUBT062510000029/1 | jq .
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "lockid": 1,
    "update_time": 1768787700528,
    "batteryid": "CUBH5A000513",
    "cabinetStr": "CUBT062510000029",
    "borrowstatus": true
  },
  "message": "Battery popped from slot 1"
}
```

---

## POST /pop/:station_id/all - Pop out all batteries from all slots (1-6)

### Pop all batteries from station
```bash
curl -X POST https://api.cuub.tech/pop/RL3T062411030004/all
```

### Pop all batteries from different station
```bash
curl -X POST https://api.cuub.tech/pop/CUBT062510000030/all
```

### Pretty-print response (with jq)
```bash
curl -X POST https://api.cuub.tech/pop/CUBT062510000029/all | jq .
```

**Expected Response (all successful):**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "slot": 1,
        "success": true,
        "data": {
          "lockid": 1,
          "update_time": 1768787700528,
          "batteryid": "CUBH5A000513",
          "cabinetStr": "CUBT062510000029",
          "borrowstatus": true
        }
      },
      ...
    ]
  },
  "message": "Popped batteries from 6 out of 6 slots",
  "summary": {
    "successful": 6,
    "failed": 0,
    "total": 6
  }
}
```

**Expected Response (partial success):**
```json
{
  "success": false,
  "data": {
    "results": [
      {
        "slot": 1,
        "success": true,
        "data": {...}
      },
      ...
    ],
    "errors": [
      {
        "slot": 4,
        "success": false,
        "error": "Failed to pop battery from slot"
      }
    ]
  },
  "message": "Popped batteries from 5 out of 6 slots",
  "summary": {
    "successful": 5,
    "failed": 1,
    "total": 6
  }
}
```

---

## Notes

### User Service API
- All endpoints return JSON responses
- Required fields for POST `/users`: `name`, `username`, `email`, `password`
- Optional field for POST `/users`: `type` (must be one of: `HOST`, `DISTRIBUTOR`, `ADMIN`)
- User ID is a UUID automatically generated by the database
- Passwords are stored as plain text (consider hashing in production)
- GET endpoints exclude password fields from responses

### Pop Battery Endpoints
- **POST `/pop/:station_id/:slot`**: Pops out a battery from a specific slot (1-6) without renting
  - Uses the Relink API to send the pop command
  - Automatically handles token refresh if the token expires
  - Returns the Relink API response including `lockid`, `update_time`, `batteryid`, `cabinetStr`, and `borrowstatus`
- **POST `/pop/:station_id/all`**: Pops out all batteries from all 6 slots
  - Sends 6 sequential requests (one for each slot from 1 to 6)
  - Returns a summary with results for each slot
  - Status code 200 if all successful, 207 if partial success, 500 if all failed
  - Includes a summary with counts of successful and failed operations
- Both endpoints require a valid token in the `token` table in the database
- The token is automatically refreshed if it expires during the request
