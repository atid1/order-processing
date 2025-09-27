import type { FastifyInstance } from 'fastify';

// Lightweight in-process polling loops used in dev/test to simulate real queue workers.
const DEFAULT_POLL_INTERVAL_MS = 200;

export function startStatusQueueWorker(app: FastifyInstance, intervalMs = DEFAULT_POLL_INTERVAL_MS) {
  let timer: NodeJS.Timeout | null = setInterval(async () => {
    try {
      let processed = true;
      while (processed) {
        // Consume messages until the queue returns no more work for this iteration
        const message = await app.statusQueueConsumer.consumeOne(app.config.events.orderStatusQueue);
        processed = Boolean(message);
      }
    } catch (error) {
      app.log.error({ err: error }, 'Status queue worker failed to drain message');
    }
  }, intervalMs);

  app.addHook('onClose', async () => {
    if (timer) {
      // Ensure we stop polling when the Fastify instance shuts down
      clearInterval(timer);
      timer = null;
    }
  });
}

export function startOrderCreatedQueueWorker(
  app: FastifyInstance,
  intervalMs = DEFAULT_POLL_INTERVAL_MS
) {
  let timer: NodeJS.Timeout | null = setInterval(async () => {
    try {
      let processed = true;
      while (processed) {
        // Drain order-created messages so shipment creation happens asynchronously
        const message = await app.orderCreatedQueueConsumer.consumeOne(
          app.config.events.orderCreatedQueue
        );
        processed = Boolean(message);
      }
    } catch (error) {
      app.log.error({ err: error }, 'Order-created queue worker failed to drain message');
    }
  }, intervalMs);

  app.addHook('onClose', async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });
}
