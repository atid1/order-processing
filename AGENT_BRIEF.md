# Assignment Handoff (Scope + Design)

## Scope (authoritative)
- Production-ready **Sales** service only (order intake, validation, availability check via stub, persistence, idempotency, delivery initiation call).
- **Delivery** side will be mocked/stubbed; no real Delivery implementation required.
- **Security** (authentication/authorization) and **Observability** (metrics/tracing dashboards) are explicitly **out of scope**.
- Provide a **Design Doc** (Markdown) covering architecture, APIs (Application Programming Interfaces), data model, idempotency, and tradeoffs.
- Final result: **Dockerized** service with `Dockerfile` and `docker-compose.yml`, suitable for deployment in a shared environment/registry.

## Deliverables
- `DESIGN.md` – design document (context/goals, non-goals, architecture, REST (Representational State Transfer) APIs, data model, idempotency & retries, testing, deployment).
- Running service: `npm run dev`, `npm run test`, `npm run start:prod`.
- Containerization: multi-stage `Dockerfile` + `docker-compose.yml` (MongoDB – document database).
- Mocks:
  - Outbound: Sales → Delivery Mock client (HTTP (Hypertext Transfer Protocol) call with retries/backoff).
  - Inbound: Delivery Mock → Sales callback route to update status (`SHIPPED`/`DELIVERED`), idempotent.

## Minimal API
- `POST /v1/orders`  (Headers: `Idempotency-Key`; Body: `{ customerId, items[{sku,qty}], totalAmount }`) → `{ orderId, status:"PENDING_SHIPMENT" }`
- `GET /v1/orders/{orderId}` → Order document
- `POST /v1/orders/{orderId}/status` (Delivery Mock → Sales) → `{ status: "SHIPPED" | "DELIVERED", at: ISO-8601 }`
- `POST /v1/shipments` (Sales → Delivery Mock) → `{ shipmentId, state:"CREATED" }`

## Data Model (Sales)
- Order: `{ id: UUID (Universally Unique Identifier), customerId, items[{sku,qty}], totalAmount, status: "PENDING_SHIPMENT"|"SHIPPED"|"DELIVERED", requestId, payloadHash, createdAt, updatedAt, version }`
- EventLog (optional): `{ eventId, orderId, status, appliedAt }`

## Idempotency & Consistency
- Create: reuse `Idempotency-Key` + `payloadHash` → return existing order; mismatch → `409 Conflict`.
- Status updates: dedupe by `eventId`; monotonic state machine (no regressions).
- Retries: exponential backoff with jitter; Delivery Mock failures don’t block client response.

## Testing
- Unit: validators, state transitions, idempotent create, callback dedupe.
- Integration: Sales ↔ Delivery Mock happy-path + retry scenarios.
- Smoke load: short autocannon to capture p95 (95th percentile) latency & RPS (Requests Per Second).

## Deployment
- `Dockerfile` (multi-stage), `docker-compose.yml`
- Health: `/healthz`, `/readyz`
- Config: 12-Factor via environment variables; strict schema check at boot.

## Future (documented, not implemented)
- Swap HTTP with broker (Kafka – distributed log / SQS – Amazon Simple Queue Service).
- Security (JWT – JSON Web Token / mTLS – mutual Transport Layer Security), full Observability (RED – Rate/Errors/Duration).
- Multi-region locality and conflict resolution.