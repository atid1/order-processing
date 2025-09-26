## Order Processing – Sales Service (Assignment)

This repository contains the implementation of the Sales service for the Order Processing Integration assignment.
The goal is to demonstrate a production-ready design of the Sales side, while mocking the Delivery system.

## Scope

## Implemented
	•	Sales service exposing REST APIs to create and track orders.
	•	Order validation, stubbed availability check, persistence, and idempotent creation.
	•	Delivery initiation via a mocked Delivery service.
	•	Delivery status callbacks (SHIPPED, DELIVERED) handled idempotently.
	•	Ready-to-deploy Docker.
	•	Design document included (DESIGN.md).

## Out of Scope
	•	Full Delivery implementation (replaced by mocks).
	•	Payments, inventory/warehouse logistics.
	•	Security (authentication/authorization).
	•	Observability (metrics, tracing dashboards).

## Architecture Overview
	•	Sales Service: Node.js (TypeScript, Fastify – a high-performance Node.js web framework), MongoDB for persistence.
	•	Delivery Mock: lightweight stub to simulate shipment creation and status callbacks.
	•	Rate Limit Plugin: Fastify wrapper around `@fastify/rate-limit` providing global and endpoint-specific throttling.
	•	Flow:
	1.	Client → Sales: POST /v1/orders
	2.	Sales validates input, persists the order (PENDING_SHIPMENT), and publishes an order-created event to the queue
	3.	Worker consumes the order-created queue, calls the Delivery mock, and stores shipment metadata
	4.	Delivery Mock → Sales: status callbacks enqueued on the status queue and processed asynchronously
	5.	Sales reflects updates in order state

## APIs

## Sales – Public
	•	POST /v1/orders – Create a new order (supports Idempotency-Key).
	•	GET /v1/orders/{orderId} – Retrieve order details.

## Sales – Private (Delivery → Sales callbacks)
	•	POST /v1/orders/{orderId}/status – Delivery status updates.

## Delivery Mock (Sales → Delivery)
	•	POST /v1/shipments – Initiate shipment (mocked).

## Data Model


```typescript
type Order = {
  id: string;                       // UUID (Universally Unique Identifier)
  customerId: string;
  items: { sku: string; qty: number }[];
  totalAmount: number;
  status: "PENDING_SHIPMENT" | "SHIPPED" | "DELIVERED";
  requestId: string;                // for idempotency
  payloadHash: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;                  // optimistic concurrency token
  statusHistory: {
    eventId: string;
    status: "PENDING_SHIPMENT" | "SHIPPED" | "DELIVERED";
    at: Date;
  }[];
  shipment?: {
    shipmentId: string;
    state: string;
    requestedAt: Date;
  };
};
```

## Running Locally

# Install dependencies
npm install

# Start MongoDB with Docker Compose
docker-compose up -d

# Run in dev mode (set AUTO_CONSUME_STATUS_QUEUE=true to auto-drain queues)
npm run dev

# Run tests (Vitest + MongoMemoryServer)
npm test

> **Note:** The integration suite spins up MongoMemoryServer. Ensure the sandbox can download MongoDB binaries (or cache them under `MONGOMS_DOWNLOAD_DIR`) before running `npm test`.

### MongoMemoryServer offline setup

When outbound network access is restricted, download the MongoDB binaries once and point the test runner at the cached directory:

```
export MONGOMS_DOWNLOAD_DIR="$HOME/.cache/mongodb-binaries"
export MONGOMS_VERSION=7.0.14
npm test
```

The first run downloads the archive; subsequent executions reuse the cached files so CI and air-gapped environments stay green.

## Rate Limiting

- Controlled via environment variables (`RATE_LIMIT_*`); see `.env.example` for defaults.
- Detailed behaviour and tuning guidance live in `docs/RATE_LIMITING.md`.
- Defaults use the in-memory store; set `RATE_LIMIT_STORE_PROVIDER=redis` and related `RATE_LIMIT_REDIS_*` vars to share limits across instances.
- When enabling the Redis store, install the optional dependency `ioredis` (`npm install ioredis`).
- Docker users can enable the bundled Redis container via Compose profiles: `docker-compose --profile redis-rate-limit up` (otherwise the service continues to use the in-memory store).

## Performance Smoke Test

With the service running locally (for example `npm run dev`):

```
npm run perf:orders
```

Customize via environment variables when needed:

- `PERF_TARGET` (default `http://localhost:3000`)
- `PERF_PATH` (default `/v1/orders`)
- `PERF_CONNECTIONS` (default `25`)
- `PERF_DURATION` (default `30` seconds)
- `PERF_PIPELINING` (default `1` request per connection)

Each request carries a unique `Idempotency-Key`, allowing the benchmark to hammer persistence and event publishing without triggering replay conflicts. The output includes throughput and latency statistics from `autocannon`.

## Deployment

A multi-stage Dockerfile is provided.
Build and run:

# Build an image named "sales-service"
docker build -t sales-service .

# Run the container, exposing port 3000
docker run -p 3000:3000 sales-service

## cURL Playground

All commands assume the service listens on `http://localhost:3000` (via `npm run dev` or `docker-compose up`). Replace placeholders like `<ORDER_ID>` and `<IDEMPOTENCY_KEY>` before executing. Queue events land in the in-memory store; when driving the app programmatically you can inspect `fastify.mockQueueStore.all()` to see the raw payloads.

### 1. Create an Order

```bash
curl -i http://localhost:3000/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 11111111-2222-3333-4444-555555555555' \
  -d '{
        "customerId": "cust-123",
        "totalAmount": 199.99,
        "items": [
          { "sku": "widget", "qty": 2 }
        ]
      }'
```

### 2. Replay the Same Request (Idempotent 200)

```bash
curl -i http://localhost:3000/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 11111111-2222-3333-4444-555555555555' \
  -d '{
        "customerId": "cust-123",
        "totalAmount": 199.99,
        "items": [
          { "sku": "widget", "qty": 2 }
        ]
      }'
```

### 3. Retrieve an Order

```bash
curl -i http://localhost:3000/v1/orders/<ORDER_ID>
```

Replace `<ORDER_ID>` with the identifier returned in step 1.

### 4. Attempt an Order That Fails Availability

```bash
curl -i http://localhost:3000/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: insufficient-stock-1' \
  -d '{
        "customerId": "cust-123",
        "totalAmount": 999.99,
        "items": [
          { "sku": "widget", "qty": 25 }
        ]
      }'
```

### 5. Mark Order as `SHIPPED` (Enqueue)

```bash
curl -i http://localhost:3000/v1/orders/<ORDER_ID>/status \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: shipment-event-1' \
  -d '{
        "status": "SHIPPED",
        "at": "2024-05-01T12:00:00.000Z"
      }'
```

Response is `202 Accepted`; drain the status queue (step 11) to persist the change.

### 6. Replay the `SHIPPED` Callback (Idempotent 200)

```bash
curl -i http://localhost:3000/v1/orders/<ORDER_ID>/status \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: shipment-event-1' \
  -d '{
        "status": "SHIPPED",
        "at": "2024-05-01T12:00:00.000Z"
      }'
```

### 7. Mark Order as `DELIVERED` (Enqueue)

```bash
curl -i http://localhost:3000/v1/orders/<ORDER_ID>/status \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: shipment-event-2' \
  -d '{
        "status": "DELIVERED",
        "at": "2024-05-02T12:00:00.000Z"
      }'
```

### 8. Optional: Call Delivery Mock Directly

If `docker-compose` is running, the delivery stub listens on `http://localhost:4000`.

```bash
curl -i http://localhost:4000/v1/shipments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: <IDEMPOTENCY_KEY>' \
  -d '{
        "orderId": "<ORDER_ID>",
        "customerId": "cust-123",
        "totalAmount": 199.99,
        "items": [
          { "sku": "widget", "qty": 2 }
        ]
      }'
```

### 9. Inspect the In-Memory Queue (Debug)

```bash
curl -s http://localhost:3000/debug/queues/order-created | jq
```

### 10. Clear the In-Memory Queue (Debug)

```bash
curl -X DELETE http://localhost:3000/debug/queues/order-created
```

### 11. Process the Status Queue (Debug Worker)

```bash
curl -X POST http://localhost:3000/debug/queues/order-status/process | jq
```

## Deliverables
	•	Production-shaped Sales service with mocks for Delivery.
	•	Design document (DESIGN.md).
	•	Docker-ready setup (Dockerfile, docker-compose.yml).
	•	Automated tests (unit + integration).
