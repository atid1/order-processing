import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import type { AppConfig } from './config/env';
import mongoPlugin from './plugins/mongo';
import servicesPlugin from './plugins/services';
import rateLimitPlugin from './plugins/rate-limit';
import ordersRoutes from './routes/orders';
import debugRoutes from './routes/debug';
import { startOrderCreatedQueueWorker, startStatusQueueWorker } from './utils/queue-workers';

/**
 * Factory that wires together the Fastify instance, global plugins, and feature routes.
 * Keeping it pure (returning an app without calling `listen`) makes it straightforward to
 * reuse in tests where we want to exercise the HTTP layer via injection.
 */
export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      level: config.env === 'production' ? 'info' : 'debug'
    }
  });

  app.decorate('config', config);

  // Sensible attaches common HTTP errors before route registration; helmet/cors harden defaults.
  await app.register(sensible);
  await app.register(helmet);
  await app.register(cors, { origin: true });

  // Rate limiting should be registered early to protect all routes
  await app.register(rateLimitPlugin, config.rateLimit);

  await app.register(mongoPlugin, {
    uri: config.mongo.uri,
    dbName: config.mongo.dbName
  });

  // Compose domain dependencies (repositories, clients, queues) behind a single Fastify plugin.
  await app.register(servicesPlugin);

  // Liveness probe: returns immediately to signal the process is running.
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async () => {
    // Ready probe blocks until Mongo responds, matching Kubernetes style expectations.
    await app.mongo.db.command({ ping: 1 });
    return { status: 'ready' };
  });

  await app.register(ordersRoutes, { prefix: '/v1' });
  await app.register(debugRoutes, { prefix: '/debug' });

  // Optional dev helper: spin up in-process pollers so queues drain without manual intervention.
  if (config.autoConsumeStatusQueue) {
    startOrderCreatedQueueWorker(app);
    startStatusQueueWorker(app);
  }

  return app;
}
