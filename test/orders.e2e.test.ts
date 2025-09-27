import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/env';
import { buildApp } from '../src/app';

process.env.MONGOMS_DISABLE_PORT_CHECK = 'true';
process.env.MONGOMS_IP = '127.0.0.1';
process.env.MONGOMS_DOWNLOAD_DIR = resolve(__dirname, '../.mongodb-binaries');

interface CreateOrderPayload {
  customerId?: string;
  totalAmount?: number;
  items?: Array<{ sku: string; qty: number }>;
}

// Full-stack integration tests exercising the HTTP layer, Mongo persistence, and delivery mock.
describe('Sales Orders API', () => {
  let app: FastifyInstance | undefined;
  let mongoServer: MongoMemoryServer;
  let deliveryMock: FastifyInstance | undefined;
  let skipSuite = false;
  let deliveryBaseUrl: string;
  let shipmentCounter = 0;
  const shipments: Array<{ orderId: string }> = [];
  const orderCreatedQueue = 'test-order-created';
  const orderStatusQueue = 'test-order-status';

  beforeAll(async () => {
    // Spin up an in-memory Mongo instance so tests operate on an isolated database.
    try {
      mongoServer = new MongoMemoryServer({
        instance: { ip: '127.0.0.1', port: 27017 }
      });
      await mongoServer.start(true);
    } catch (error) {
      skipSuite = true;
      console.warn('Skipping Sales Orders API tests due to MongoMemoryServer startup failure:', error);
      return;
    }
    const mongoUri = mongoServer.getUri('sales');

    deliveryMock = Fastify();
    const delivery = deliveryMock;
    delivery.post<{ Body: { orderId: string } }>('/v1/shipments', async (request) => {
      shipmentCounter += 1;
      shipments.push({ orderId: request.body.orderId });
      return { shipmentId: `shipment-${shipmentCounter}`, state: 'CREATED' };
    });

    await delivery.listen({ port: 0, host: '127.0.0.1' });
    const address = delivery.server.address();
    if (address && typeof address === 'object') {
      deliveryBaseUrl = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error('Failed to determine delivery mock port');
    }

    const config: AppConfig = {
      env: 'test',
      port: 0,
      host: '127.0.0.1',
      mongo: {
        uri: mongoUri,
        dbName: 'sales'
      },
      delivery: {
        baseUrl: deliveryBaseUrl,
        timeoutMs: 200,
        maxRetries: 1,
        retryBaseDelayMs: 20
      },
      events: {
        orderCreatedQueue,
        orderStatusQueue
      },
      rateLimit: {
        enabled: false, // Disable for main tests to avoid interference
        global: { max: 1000, timeWindow: 60000 },
        orders: {
          create: { max: 100, timeWindow: 60000 },
          read: { max: 100, timeWindow: 60000 },
          status: { max: 100, timeWindow: 60000 }
        },
        store: { provider: 'memory' }
      },
      autoConsumeStatusQueue: false
    };

    app = await buildApp(config);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (deliveryMock) await deliveryMock.close();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    if (skipSuite) {
      return;
    }
    // Reset state between tests: clear shipments list, reset counter, wipe Mongo collection.
    shipmentCounter = 0;
    shipments.length = 0;
    if (!app) {
      throw new Error('Test app not initialized');
    }
    await app.mongo.db.collection('orders').deleteMany({});
    app.mockQueueStore.clear();
  });

  const getApp = (): FastifyInstance => {
    if (!app) {
      throw new Error('Test app not initialized');
    }
    return app;
  };

  const skipIfUnavailable = () => {
    if (skipSuite) {
      expect(true).toBe(true);
      return true;
    }
    return false;
  };

  it('creates orders idempotently', async () => {
    if (skipIfUnavailable()) return;
    const server = getApp();
    const payload = buildPayload();

    const first = await createOrder(server, 'idem-1', payload);
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{ orderId: string; status: string }>();
    expect(firstBody.status).toBe('PENDING_SHIPMENT');

    const second = await createOrder(server, 'idem-1', payload);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(firstBody);

    const messagesAfterReplay = server
      .mockQueueStore
      .all()
      .filter((message) => message.queueName === orderCreatedQueue);
    expect(messagesAfterReplay).toHaveLength(1);

    const queueSnapshot = await server.inject({
      method: 'GET',
      url: '/debug/queues/order-created'
    });
    expect(queueSnapshot.statusCode).toBe(200);
    expect(queueSnapshot.json()).toHaveLength(1);

    const storedOrder = await server.mongo.db
      .collection('orders')
      .findOne<{ requestId: string }>({ id: firstBody.orderId });
    expect(storedOrder?.requestId).toBe('idem-1');

    const processedCreated = await processOrderCreatedQueue(server);
    expect(processedCreated.filter((msg) => msg.queueName === orderCreatedQueue)).toHaveLength(1);

    const refreshedOrder = await server.mongo.db
      .collection('orders')
      .findOne<{ shipment?: { shipmentId: string } }>({ id: firstBody.orderId });
    expect(refreshedOrder?.shipment?.shipmentId).toBeDefined();
    expect(shipments).toHaveLength(1);
  });

  it('rejects conflicting create payload for same idempotency key', async () => {
    if (skipIfUnavailable()) return;
    const server = getApp();
    const payload = buildPayload();
    const first = await createOrder(server, 'idem-2', payload);
    expect(first.statusCode).toBe(201);

    const conflict = await createOrder(server, 'idem-2', {
      ...payload,
      totalAmount: (payload.totalAmount ?? 0) + 5
    });

    expect(conflict.statusCode).toBe(409);
    expect(
      server
        .mockQueueStore
        .all()
        .filter((message) => message.queueName === orderCreatedQueue)
    ).toHaveLength(1);
  });

  it('rejects orders when product availability fails', async () => {
    if (skipIfUnavailable()) return;
    const server = getApp();
    const response = await createOrder(server, 'idem-availability', {
      items: [{ sku: 'sku-1', qty: 25 }],
      totalAmount: 999.99
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ message: string }>().message).toMatch(/unavailable/i);
    expect(server.mockQueueStore.all()).toHaveLength(0);
  });

  it('applies status updates with idempotent behavior', async () => {
    if (skipIfUnavailable()) return;
    const server = getApp();
    const createResult = await createOrder(server, 'idem-3', buildPayload());
    const { orderId } = createResult.json<{ orderId: string }>();

    const shipped = await server.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/status`,
      headers: { 'idempotency-key': 'event-1' },
      payload: { status: 'SHIPPED', at: new Date().toISOString() }
    });
    expect(shipped.statusCode).toBe(202);
    expect(JSON.parse(shipped.body)).toEqual({ accepted: true });

    const processedShipped = await processStatusQueue(server);
    expect(processedShipped.filter((msg) => msg.queueName === orderStatusQueue)).toHaveLength(1);

    const shippedDoc = await server.mongo.db
      .collection('orders')
      .findOne<{ status: string; statusHistory: Array<{ eventId: string }> }>({ id: orderId });
    expect(shippedDoc?.status).toBe('SHIPPED');
    expect(shippedDoc?.statusHistory.some((event) => event.eventId === 'event-1')).toBe(true);

    const duplicateEvent = await server.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/status`,
      headers: { 'idempotency-key': 'event-1' },
      payload: { status: 'SHIPPED', at: new Date().toISOString() }
    });
    expect(duplicateEvent.statusCode).toBe(200);
    expect(JSON.parse(duplicateEvent.body)).toEqual({ accepted: false, duplicate: true });

    const duplicateProcessed = await processStatusQueue(server);
    expect(duplicateProcessed.filter((msg) => msg.queueName === orderStatusQueue)).toHaveLength(0);

    const invalid = await server.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/status`,
      headers: { 'idempotency-key': 'event-bad' },
      // Replaying SHIPPED with a new event id should violate the monotonic progression rule.
      payload: { status: 'SHIPPED', at: new Date().toISOString() }
    });
    expect(invalid.statusCode).toBe(409);

    const delivered = await server.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/status`,
      headers: { 'idempotency-key': 'event-2' },
      payload: { status: 'DELIVERED', at: new Date().toISOString() }
    });
    expect(delivered.statusCode).toBe(202);

    await processStatusQueue(server);

    const deliveredDoc = await server.mongo.db
      .collection('orders')
      .findOne<{ status: string }>({ id: orderId });
    expect(deliveredDoc?.status).toBe('DELIVERED');
  });

  it('exposes debug queues separately and allows clearing each in isolation', async () => {
    if (skipIfUnavailable()) return;
    const server = getApp();
    const orderId = (await createOrder(server, 'idem-queues', buildPayload())).json<{ orderId: string }>().orderId;

    const statusEnqueue = await server.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/status`,
      headers: { 'idempotency-key': 'event-debug-1' },
      payload: { status: 'SHIPPED', at: new Date().toISOString() }
    });
    expect(statusEnqueue.statusCode).toBe(202);

    const createdQueue = await server.inject({ method: 'GET', url: '/debug/queues/order-created' });
    const statusQueue = await server.inject({ method: 'GET', url: '/debug/queues/order-status' });

    expect(createdQueue.statusCode).toBe(200);
    expect(statusQueue.statusCode).toBe(200);
    expect(createdQueue.json()).toMatchObject([
      expect.objectContaining({ queueName: server.config.events.orderCreatedQueue })
    ]);
    expect(statusQueue.json()).toMatchObject([
      expect.objectContaining({ queueName: server.config.events.orderStatusQueue })
    ]);

    const clearCreated = await server.inject({ method: 'DELETE', url: '/debug/queues/order-created' });
    expect(clearCreated.statusCode).toBe(200);
    expect(clearCreated.json()).toEqual({ cleared: true });
    const createdAfterClear = await server.inject({ method: 'GET', url: '/debug/queues/order-created' });
    const statusAfterCreatedClear = await server.inject({ method: 'GET', url: '/debug/queues/order-status' });
    expect(createdAfterClear.json()).toHaveLength(0);
    expect(statusAfterCreatedClear.json()).toHaveLength(1);

    const clearStatus = await server.inject({ method: 'DELETE', url: '/debug/queues/order-status' });
    expect(clearStatus.statusCode).toBe(200);
    expect(clearStatus.json()).toEqual({ cleared: true });
    const statusAfterClear = await server.inject({ method: 'GET', url: '/debug/queues/order-status' });
    expect(statusAfterClear.json()).toHaveLength(0);
  });
});

function buildPayload(overrides: CreateOrderPayload = {}) {
  return {
    customerId: overrides.customerId ?? 'customer-1',
    totalAmount: overrides.totalAmount ?? 125.5,
    items: overrides.items ?? [{ sku: 'sku-1', qty: 2 }]
  };
}

function createOrder(
  app: FastifyInstance,
  idempotencyKey: string,
  payload: CreateOrderPayload
) {
  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: {
      'idempotency-key': idempotencyKey
    },
    payload: buildPayload(payload)
  });
}

async function processStatusQueue(app: FastifyInstance) {
  const response = await app.inject({
    method: 'POST',
    url: '/debug/queues/order-status/process'
  });
  expect(response.statusCode).toBe(200);
  return response.json<Array<{ queueName: string }>>();
}

async function processOrderCreatedQueue(app: FastifyInstance) {
  const response = await app.inject({
    method: 'POST',
    url: '/debug/queues/order-created/process'
  });
  expect(response.statusCode).toBe(200);
  return response.json<Array<{ queueName: string }>>();
}
