import { describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { OrderRecord, StatusEvent, StatusUpdateInput } from '../src/types/order';
import { OrderService } from '../src/services/order-service';
import type { OrderRepository } from '../src/repositories/order-repository';
import type { DeliveryClient } from '../src/clients/delivery-client';
import type { ProductAvailabilityService } from '../src/services/product-availability-service';
import type { OutboundEventService } from '../src/services/outbound-event-service';

function cloneOrder<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class StubOrderRepository {
  private order: OrderRecord;
  private contendedEventId?: string;

  constructor(order: OrderRecord) {
    this.order = cloneOrder(order);
  }

  simulateContention(eventId: string): void {
    this.contendedEventId = eventId;
  }

  async findById(orderId: string): Promise<OrderRecord | null> {
    if (orderId !== this.order.id) {
      return null;
    }
    return cloneOrder(this.order);
  }

  async appendStatusEvent(
    orderId: string,
    event: StatusEvent,
    nextStatus: OrderRecord['status'],
    expectedVersion: number
  ): Promise<OrderRecord | null> {
    if (orderId !== this.order.id) {
      return null;
    }

    if (this.contendedEventId === event.eventId) {
      // Simulate a concurrent writer winning the race before this append executes.
      this.applyEvent(event, nextStatus);
      this.contendedEventId = undefined;
      return null;
    }

    if (expectedVersion !== this.order.version) {
      return null;
    }

    if (this.order.statusHistory.some((item) => item.eventId === event.eventId)) {
      return null;
    }

    this.applyEvent(event, nextStatus);
    return cloneOrder(this.order);
  }

  private applyEvent(event: StatusEvent, nextStatus: OrderRecord['status']): void {
    this.order = {
      ...this.order,
      status: nextStatus,
      statusHistory: [...this.order.statusHistory, cloneOrder(event)],
      updatedAt: new Date().toISOString(),
      version: this.order.version + 1
    };
  }
}

const noopDeliveryClient = {} as DeliveryClient;
const noopAvailability = {} as ProductAvailabilityService;
const noopOutbound = {} as OutboundEventService;

function buildLogger(): FastifyBaseLogger {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => logger)
  } as unknown as FastifyBaseLogger;

  return logger;
}

function buildOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const createdAt = new Date('2024-01-01T00:00:00.000Z').toISOString();
  const base: OrderRecord = {
    id: 'order-1',
    customerId: 'customer-123',
    items: [{ sku: 'sku-1', qty: 1 }],
    totalAmount: 42,
    status: 'PENDING_SHIPMENT',
    requestId: 'req-1',
    payloadHash: 'hash-1',
    createdAt,
    updatedAt: createdAt,
    version: 1,
    statusHistory: [
      {
        eventId: 'order-created-req-1',
        status: 'PENDING_SHIPMENT',
        at: createdAt
      }
    ]
  };

  const statusHistory = overrides.statusHistory ?? base.statusHistory;

  return {
    ...base,
    ...overrides,
    statusHistory: statusHistory.map((event) => cloneOrder(event)),
    items: (overrides.items ?? base.items).map((item) => cloneOrder(item))
  };
}

function buildService(order: OrderRecord, repository?: StubOrderRepository, logger = buildLogger()) {
  const repo = repository ?? new StubOrderRepository(order);
  const service = new OrderService(
    repo as unknown as OrderRepository,
    noopDeliveryClient,
    noopAvailability,
    noopOutbound,
    logger
  );

  return { service, repository: repo, logger };
}

describe('OrderService status update guardrails', () => {
  it('treats duplicate event ids as a no-op', async () => {
    const duplicateEventId = 'event-1';
    const order = buildOrder({
      statusHistory: [
        {
          eventId: 'order-created-req-1',
          status: 'PENDING_SHIPMENT',
          at: '2024-01-01T00:00:00.000Z'
        },
        {
          eventId: duplicateEventId,
          status: 'SHIPPED',
          at: '2024-01-02T00:00:00.000Z'
        }
      ],
      status: 'SHIPPED',
      version: 2,
      updatedAt: '2024-01-02T00:00:00.000Z'
    });

    const { service } = buildService(order);

    const result = await service.validateStatusUpdate(order.id, {
      status: 'DELIVERED',
      at: '2024-01-03T00:00:00.000Z',
      eventId: duplicateEventId
    });

    expect(result.event).toBeUndefined();
  });

  it('ignores stale timestamps using millisecond comparisons', async () => {
    const order = buildOrder({
      statusHistory: [
        {
          eventId: 'order-created-req-1',
          status: 'PENDING_SHIPMENT',
          at: '2024-01-01T00:00:00.000Z'
        },
        {
          eventId: 'event-ship',
          status: 'SHIPPED',
          at: '2024-01-02T00:00:00.000Z'
        }
      ],
      status: 'SHIPPED',
      version: 2,
      updatedAt: '2024-01-02T00:00:00.000Z'
    });

    const { service, logger } = buildService(order);

    const result = await service.validateStatusUpdate(order.id, {
      status: 'DELIVERED',
      at: '2024-01-02T00:00:00.000Z',
      eventId: 'event-delivery-stale'
    });

    expect(result.event).toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith(
      { orderId: order.id, eventId: 'event-delivery-stale' },
      'Stale status event ignored'
    );
  });

  it('drops non-monotonic transitions as a no-op', async () => {
    const order = buildOrder();
    const { service, logger } = buildService(order);

    const result = await service.validateStatusUpdate(order.id, {
      status: 'DELIVERED',
      at: '2024-01-02T00:00:00.000Z',
      eventId: 'event-out-of-order'
    });

    expect(result.event).toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith(
      {
        orderId: order.id,
        from: 'PENDING_SHIPMENT',
        to: 'DELIVERED',
        eventId: 'event-out-of-order'
      },
      'Ignoring non-monotonic status transition'
    );
  });

  it('treats a concurrent writer inserting the same event as success after optimistic lock failure', async () => {
    const order = buildOrder();
    const repository = new StubOrderRepository(order);
    const { service } = buildService(order, repository);

    const statusUpdate: StatusUpdateInput = {
      status: 'SHIPPED',
      at: '2024-01-02T00:00:00.000Z',
      eventId: 'event-concurrent'
    };

    repository.simulateContention(statusUpdate.eventId);

    const updated = await service.applyStatusUpdate(order.id, statusUpdate);

    expect(updated.status).toBe('SHIPPED');
    expect(updated.version).toBe(2);
    expect(updated.statusHistory).toHaveLength(2);
    expect(updated.statusHistory[1]).toMatchObject({ eventId: 'event-concurrent', status: 'SHIPPED' });
  });
});
