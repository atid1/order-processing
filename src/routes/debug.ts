import type { FastifyPluginAsync } from 'fastify';

/**
 * Debug-only routes that expose internal mocks (e.g., in-memory queue store) for manual testing.
 */
const debugRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/queues/order-created', async () => {
    const orderCreatedQueue = fastify.config.events.orderCreatedQueue;
    return fastify.mockQueueStore
      .all()
      .filter((message) => message.queueName === orderCreatedQueue);
  });

  fastify.get('/queues/order-status', async () => {
    const orderStatusQueue = fastify.config.events.orderStatusQueue;
    return fastify.mockQueueStore
      .all()
      .filter((message) => message.queueName === orderStatusQueue);
  });

  fastify.delete('/queues/order-created', async () => {
    const orderCreatedQueue = fastify.config.events.orderCreatedQueue;
    fastify.mockQueueStore.clearQueue(orderCreatedQueue);
    return { cleared: true };
  });

  fastify.delete('/queues/order-status', async () => {
    const orderStatusQueue = fastify.config.events.orderStatusQueue;
    fastify.mockQueueStore.clearQueue(orderStatusQueue);
    return { cleared: true };
  });

  fastify.post('/queues/order-created/process', async () => {
    const processed = [] as Array<{ queueName: string; sentAt: string; processedAt?: string }>;
    while (true) {
      const message = await fastify.orderCreatedQueueConsumer.consumeOne(
        fastify.config.events.orderCreatedQueue
      );
      if (!message) {
        break;
      }
      processed.push(message);
    }
    return processed;
  });

  fastify.post('/queues/order-status/process', async () => {
    const processed = [] as Array<{ queueName: string; sentAt: string; processedAt?: string }>;
    while (true) {
      const message = await fastify.statusQueueConsumer.consumeOne(
        fastify.config.events.orderStatusQueue
      );
      if (!message) {
        break;
      }
      processed.push(message);
    }
    return processed;
  });
};

export default debugRoutes;
