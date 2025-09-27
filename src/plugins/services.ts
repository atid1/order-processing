import fp from 'fastify-plugin';
import { OrderRepository } from '../repositories/order-repository';
import { DeliveryClient } from '../clients/delivery-client';
import { OrderService } from '../services/order-service';
import { ProductAvailabilityService } from '../services/product-availability-service';
import {
  InMemoryQueueClient,
  InMemoryQueueConsumer,
  InMemoryQueueStore,
  OutboundEventService,
  type OrderCreatedQueuePayload,
  type StatusUpdateQueuePayload
} from '../services/outbound-event-service';
import type { OrderRecord } from '../types/order';

/**
 * Fastify plugin that wires together repositories, outbound clients, and the OrderService.
 * Registering it once keeps downstream route modules simple—they can rely on
 * `fastify.services.orderService` without constructing dependencies in every handler.
 */
const servicesPlugin = fp(async (fastify) => {
  const ordersCollection = fastify.mongo.db.collection<OrderRecord>('orders');
  const repository = new OrderRepository(ordersCollection);
  await repository.init();

  const deliveryClient = new DeliveryClient(fastify.config.delivery, fastify.log);
  const availabilityService = new ProductAvailabilityService();
  const queueStore = new InMemoryQueueStore();
  // Queue client + service give us a seam to swap in a real broker without touching call sites.
  const queueClient = new InMemoryQueueClient(queueStore);
  const outboundEventService = new OutboundEventService(queueClient, {
    orderCreatedQueue: fastify.config.events.orderCreatedQueue,
    orderStatusQueue: fastify.config.events.orderStatusQueue
  });
  const orderService = new OrderService(
    repository,
    deliveryClient,
    availabilityService,
    outboundEventService,
    fastify.log
  );

  // Worker that turns order-created events into outbound Delivery requests + metadata updates.
  const orderCreatedQueueConsumer = new InMemoryQueueConsumer(queueStore, async (message) => {
    const payload = message.payload as OrderCreatedQueuePayload;
    await orderService.handleOrderCreatedEvent(payload.orderId);
  });

  // Worker that applies Delivery status callbacks off the request path.
  const statusQueueConsumer = new InMemoryQueueConsumer(queueStore, async (message) => {
    const payload = message.payload as StatusUpdateQueuePayload;
    await orderService.applyStatusUpdate(payload.orderId, payload.event);
  });

  fastify.decorate('mockQueueStore', queueStore);
  fastify.decorate('orderCreatedQueueConsumer', orderCreatedQueueConsumer);
  fastify.decorate('statusQueueConsumer', statusQueueConsumer);
  fastify.decorate('services', { orderService, outboundEventService });
});

export default servicesPlugin;
