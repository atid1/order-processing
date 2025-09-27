# Repository File Map

## Top-Level
- `README.md`, `DESIGN.md`, `AGENT_BRIEF.md`: Documentation describing service goals and interviewing details.
- `package.json`, `package-lock.json`: Node tooling and scripts.
- `docker-compose.yml`, `Dockerfile`: Containerization assets for local setup.
- `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`: TypeScript and testing configuration.
- `delivery-mock/`: Companion HTTP service used in tests and local dev to mimic the Delivery system.
- `scripts/`: Utility scripts (e.g., load testing).
- `src/`: Application source.
- `test/`: Vitest integration/e2e suites.
- `dist/`: Build artefacts (ignored during edits).

## `src/` structure
- `server.ts`: Process entry point that loads config and starts Fastify.
- `app.ts`: Pure factory wiring plugins, routes, and queue workers.
- `config/`
  - `env.ts`: Environment schema + loader.
- `plugins/`
  - `mongo.ts`: Fastify plugin establishing Mongo client.
  - `services.ts`: Composes repositories, services, queue store/consumers, and decorates Fastify.
  - `rate-limit.ts`: Wraps `@fastify/rate-limit` and exposes shared per-route configs.
  - `rate-limit-store.ts`: Factory that provides either in-memory or Redis-backed rate-limit stores.
- `routes/`
  - `orders.ts`: Public order APIs (create, fetch, status update).
  - `debug.ts`: Dev-only queue inspection/endpoints.
- `services/`
  - `order-service.ts`: Core domain logic and worker handlers.
  - `outbound-event-service.ts`: Queue abstraction + in-memory implementations.
  - `product-availability-service.ts`: Stub availability checker.
  - `outbound-event-service.ts` (also exports queue store/client/consumer types).
- `clients/`
  - `delivery-client.ts`: HTTP client with retry/backoff.
- `repositories/`
  - `order-repository.ts`: Mongo persistence layer + optimistic concurrency.
- `types/`
  - `order.ts`: Shared domain types.
  - `fastify.d.ts`: Fastify module augmentation for decorated properties.
- `utils/`
  - `queue-workers.ts`: In-process queue polling loops.
  - `hash.ts`: Deterministic payload hashing.
  - `retry.ts`: Generic retry helper.
- `config`, `plugins`, `routes`, `services`, etc., align with Fastify modular structure.

## `scripts/`
- `perf/order-create-benchmark.ts`: Autocannon benchmark driver for create-order endpoint.

## `test/`
- `orders.e2e.test.ts`: Full-stack integration tests covering create/read/status flows and queue debug helpers.
