# Order Processing System Overview

The diagram below summarizes the Sales service, supporting infrastructure, and the asynchronous flows that power order creation and delivery tracking.

```mermaid
flowchart LR
  subgraph Client Side
    A["Client Apps<br>(e.g. Web, Mobile)"]
  end

  subgraph Sales_Service["Sales Service (Fastify + TypeScript)"]
    direction TB
    H["HTTP Layer<br>• Fastify routes<br>• Schema validation<br>• Idempotency header enforcement"]
    subgraph Plugins["Core Plugins"]
      RL["Rate Limit Plugin<br>(global + per-route, Redis optional)"]
      MG["Mongo Plugin<br>(shared client)"]
      SV["Services Plugin<br>(domain dependency wiring)"]
    end
    subgraph DomainServices["Domain Services"]
      OS["OrderService<br>• Create/read/status logic<br>• State machine enforcement"]
      AV["ProductAvailabilityService<br>(stubbed inventory checks)"]
      OR["OrderRepository<br>(Mongo persistence + indexes)"]
      OE["OutboundEventService<br>(queue abstraction, in-memory SQS mock)"]
      DC["DeliveryClient<br>HTTP + retries + idempotency"]
    end
    subgraph DevTooling["Dev/Debug Utilities"]
      DBG["/debug routes<br>(queue inspection & draining)"]
      WK["In-process Workers<br>(auto-drain order/status queues)"]
    end
  end

  subgraph Infra["Support Services"]
    MONGO[("MongoDB<br>orders collection")]
    QSTORE[("InMemoryQueueStore<br>(replaceable with SQS/Kafka)")]
    DELIVERY["Delivery Mock Service<br>Fastify stub"]
    REDIS[("Redis (optional)<br>for distributed rate limiting")]
  end

  A -->|POST /v1/orders<br>Idempotency-Key| H
  H --> RL
  RL --> SV
  SV --> OS
  OS --> OR
  OR <--> MONGO
  OS --> AV
  OS --> OE
  OE -->|order-created event| QSTORE
  WK -->|drain order-created| QSTORE
  WK -->|drain status updates| QSTORE
  WK --> OS
  OS --> DC
  DC -->|POST /v1/shipments<br>Idempotency-Key=requestId| DELIVERY
  DELIVERY -->|callbacks /v1/orders/:id/status<br>Idempotency-Key=eventId| H
  H --> SV
  SV --> OS
  OS --> OE
  OE -->|order-status event| QSTORE
  OS --> OR

  RL -. optional store .-> REDIS
  DBG --> QSTORE
  DBG --> MONGO
```

## Capability Highlights
- **Resilient intake**: Idempotent REST APIs, schema validation, rate limiting, and optimistic locking guard against retries and abuse.
- **Async orchestration**: Order-created events fan out to workers that call the Delivery service with retries, keeping the request path fast.
- **Status lifecycle**: Delivery callbacks enqueue status updates, preserving ordering and idempotency before appending to Mongo.
- **Debuggability**: Dedicated `/debug` routes, queue inspectors, and optional auto-draining workers simplify demos and tests.
- **Swap-friendly design**: In-memory queue and delivery mock mimic SQS/real downstreams, making it clear how production dependencies would slot in.
- **Configurable limits**: Rate limiting supports memory or Redis stores, highlighting readiness for horizontal scaling.
