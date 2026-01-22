# CURL Examples for User Service API

## POST /users - Create a new user

### Basic example (creates a HOST user by default)
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "johndoe"
  }'
```

### Create an ADMIN user
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin_user",
    "type": "ADMIN"
  }'
```

### Create a DISTRIBUTOR user
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "distributor1",
    "type": "DISTRIBUTOR"
  }'
```

### Create a HOST user
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "janesmith",
    "type": "HOST"
  }'
```

### Create user with single station assignment
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "hostuser1",
    "type": "HOST",
    "station_id": "CUBT062510000029"
  }'
```

### Create user with multiple station assignments
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "adminuser1",
    "type": "ADMIN",
    "station_ids": ["CUBT062510000029", "CUBT062510000030", "CUBT062510000031"]
  }'
```

### Pretty-print response (with jq)
```bash
curl -X POST https://api.cuub.tech/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "janesmith",
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
curl https://api.cuub.tech/users/21
```

### Pretty-print response
```bash
curl https://api.cuub.tech/users/21 | jq .
```

---

## PATCH /users/:id - Update user

### Update username
```bash
curl -X PATCH https://api.cuub.tech/users/21 \
  -H "Content-Type: application/json" \
  -d '{
    "username": "new_username"
  }'
```

### Update user type
```bash
curl -X PATCH https://api.cuub.tech/users/21 \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ADMIN"
  }'
```

### Update both username and type
```bash
curl -X PATCH https://api.cuub.tech/users/21 \
  -H "Content-Type: application/json" \
  -d '{
    "username": "updated_username",
    "type": "DISTRIBUTOR"
  }'
```

### Update station assignments (single station)
```bash
curl -X PATCH https://api.cuub.tech/users/21 \
  -H "Content-Type: application/json" \
  -d '{
    "station_id": "CUBT062510000029"
  }'
```

### Update station assignments (multiple stations)
```bash
curl -X PATCH https://api.cuub.tech/users/21 \
  -H "Content-Type: application/json" \
  -d '{
    "station_ids": ["CUBT062510000029", "CUBT062510000030", "CUBT062510000031"]
  }'
```

### Update user and station assignments together
```bash
curl -X PATCH https://api.cuub.tech/users/21 \
  -H "Content-Type: application/json" \
  -d '{
    "username": "updated_user",
    "type": "ADMIN",
    "station_ids": ["CUBT062510000029", "CUBT062510000030"]
  }'
```

### Pretty-print response
```bash
curl -X PATCH https://api.cuub.tech/users/21 \
  -H "Content-Type: application/json" \
  -d '{
    "username": "new_username",
    "type": "ADMIN"
  }' | jq .
```

---

## DELETE /users/:id - Delete user

```bash
curl -X DELETE https://api.cuub.tech/users/21
```

### Pretty-print response
```bash
curl -X DELETE https://api.cuub.tech/users/21 | jq .
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
  "data": [
    {
      "slot": 1,
      "manufacture_id": "CUBH5A000513"
    }
  ],
  "count": 1
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

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "slot": 1,
      "manufacture_id": "CUBH5A000513"
    },
    {
      "slot": 2,
      "manufacture_id": "CUBH5A000514"
    },
    ...
  ],
  "count": 6
}
```

---

## Notes

### User Service API
- All endpoints return JSON responses
- Required field for POST `/users`: `username`
- Optional fields for POST `/users`: 
  - `type` (must be one of: `HOST`, `DISTRIBUTOR`, `ADMIN`, defaults to `HOST`)
  - `station_id` (single station ID string) or `station_ids` (array of station ID strings) - assigns stations to the user
- User ID is auto-generated by the database (text format)
- PATCH `/users/:id` allows updating `username`, `type`, and/or `station_id`/`station_ids`
  - Providing `station_id` or `station_ids` will replace all existing station assignments
- All GET endpoints return: `id`, `username`, `type`, `created_at`, `updated_at`, `stations` (array of station IDs)
- POST and PATCH endpoints return the user object with the `stations` array included

### Pop Battery Endpoints
- **POST `/pop/:station_id/:slot`**: Pops out a battery from a specific slot (1-6) without renting
  - Uses the Relink API to send the pop command
  - Automatically handles token refresh if the token expires
  - Returns a simplified response with `data` array containing `slot` and `manufacture_id`
- **POST `/pop/:station_id/all`**: Pops out all batteries from all 6 slots
  - Sends 6 sequential requests (one for each slot from 1 to 6)
  - Returns a simplified response with `data` array containing all successful pops
  - Status code 200 if all successful, 207 if partial success, 500 if all failed
  - Response includes `success`, `data` array, and `count`
- Both endpoints require a valid token in the `token` table in the database
- The token is automatically refreshed if it expires during the request
