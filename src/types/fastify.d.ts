import type { AppConfig } from '../config/env';
import type { OrderService } from '../services/order-service';
import type { Db, MongoClient } from 'mongodb';
import type {
  OutboundEventService,
  InMemoryQueueStore,
  InMemoryQueueConsumer
} from '../services/outbound-event-service';
import type * as RateLimitNS from '@fastify/rate-limit';

type RouteRateLimitConfig = RateLimitNS.RateLimitOptions;

/**
 * Type augmentation that advertises the custom properties we decorate onto the Fastify
 * instance at runtime (configuration, Mongo client handle, and resolved services). By
 * declaring it in `src/`, the project tsconfig picks it up automatically so handlers can
 * access `fastify.config`, `fastify.mongo`, and `fastify.services.orderService` without
 * running into "property does not exist" errors.
 */

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    mongo: {
      client: MongoClient;
      db: Db;
    };
    services: {
      orderService: OrderService;
      outboundEventService: OutboundEventService;
    };
    mockQueueStore: InMemoryQueueStore;
    orderCreatedQueueConsumer: InMemoryQueueConsumer;
    statusQueueConsumer: InMemoryQueueConsumer;
    rateLimiters: {
      orderCreate: {
        config: RouteRateLimitConfig;
      };
      orderRead: {
        config: RouteRateLimitConfig;
      };
      orderStatus: {
        config: RouteRateLimitConfig;
      };
    };
    redisRateLimit?: {
      getClient: () => unknown;
    } | undefined;
  }
}
