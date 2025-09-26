import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'crypto';
import { hashPayload } from '../utils/hash';
import type {
  CreateOrderInput,
  OrderRecord,
  OrderStatus,
  StatusEvent,
  StatusUpdateInput
} from '../types/order';
import { OrderRepository } from '../repositories/order-repository';
import { DeliveryClient } from '../clients/delivery-client';
import { ProductAvailabilityService } from './product-availability-service';

/**
 * Minimal lifecycle state machine that documents the only forward transitions the
 * Sales service allows. Housing the mapping near the business logic makes it easy
 * for reviewers to audit future state additions and provides a single source of
 * truth for monotonic progression checks.
 */
const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING_SHIPMENT: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: []
};

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} not found`);
    this.name = 'OrderNotFoundError';
  }
}

export class StatusConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatusConflictError';
  }
}

export class ProductUnavailableError extends Error {
  constructor(
    message: string,
    public readonly details?: {
      sku: string;
      requestedQty: number;
      maxAvailable: number;
    }[]
  ) {
    super(message);
    this.name = 'ProductUnavailableError';
  }
}

interface CreateOrderResult {
  order: OrderRecord;
  created: boolean;
}

/**
 * Central coordination point for Sales domain rules. The service keeps HTTP routes thin
 * by owning idempotent create semantics, enforcing lifecycle transitions, and orchestrating
 * asynchronous shipment scheduling. It leans on the repository for persistence and the
 * delivery client for outbound calls so each concern remains independently testable.
 */
export class OrderService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly deliveryClient: DeliveryClient,
    private readonly availabilityService: ProductAvailabilityService,
    private readonly logger: FastifyBaseLogger
  ) {}

  /**
   * Process an inbound order create request.
   *
   * @param payload - Client supplied order details.
   * @param idempotencyKey - Unique request token used to deduplicate retries.
   * @returns The persisted order along with a flag indicating whether it was newly created.
   *
   * The method hashes the payload to detect conflicting replays, persists the order when
   * appropriate, and kicks off shipment creation in the background. Returning the
   * `created` flag lets the controller respond with either 201 or 200 without recomputing
   * the branching logic.
   */
  async createOrder(
    payload: CreateOrderInput,
    idempotencyKey: string
  ): Promise<CreateOrderResult> {
    const payloadHash = hashPayload(payload);
    const existing = await this.repository.findByRequestId(idempotencyKey);

    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new IdempotencyConflictError('Payload mismatch for provided Idempotency-Key');
      }

      // Replay with same payload returns persisted response without touching storage.
      return { order: existing, created: false };
    }

    const availability = await this.availabilityService.checkAvailability(payload.items);
    if (!availability.available) {
      throw new ProductUnavailableError(
        availability.message ?? 'Requested items are unavailable',
        availability.unavailableItems
      );
    }

    const now = new Date().toISOString();
    const order: OrderRecord = {
      id: randomUUID(),
      customerId: payload.customerId,
      items: payload.items,
      totalAmount: payload.totalAmount,
      status: 'PENDING_SHIPMENT',
      requestId: idempotencyKey,
      payloadHash,
      createdAt: now,
      updatedAt: now,
      version: 1,
      statusHistory: [
        {
          eventId: `order-created-${idempotencyKey}`,
          status: 'PENDING_SHIPMENT',
          at: now
        }
      ]
    };

    await this.repository.create(order);
    this.scheduleShipment(order);
    return { order, created: true };
  }

  /**
   * Fetches the latest representation of an order.
   *
   * @throws OrderNotFoundError when the id does not exist, allowing callers to
   *         convert the failure into a 404 without leaking repository details.
   */
  async getOrder(orderId: string): Promise<OrderRecord> {
    const order = await this.repository.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    return order;
  }

  /**
   * Applies a Delivery status callback while preserving idempotency and monotonicity.
   *
   * @param orderId - Target order id.
   * @param input - Delivery supplied status payload plus event id.
   * @returns The authoritative order document after the update.
   *
   * Duplicate event ids return early, invalid transitions raise a conflict, and write
   * races are resolved via optimistic locking. When a race is lost we re-fetch to see
   * whether the same event already landed, treating the retry as successful when it has.
   */
  async applyStatusUpdate(orderId: string, input: StatusUpdateInput): Promise<OrderRecord> {
    const order = await this.repository.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    if (order.statusHistory.some((event) => event.eventId === input.eventId)) {
      // Delivery retries send the same event id; short-circuit to keep handler idempotent.
      return order;
    }

    if (!this.canTransition(order.status, input.status)) {
      throw new StatusConflictError(
        `Invalid status transition from ${order.status} to ${input.status}`
      );
    }

    const canonicalTimestamp = new Date(input.at).toISOString();
    const event: StatusEvent = {
      eventId: input.eventId,
      status: input.status,
      at: canonicalTimestamp
    };

    const updated = await this.repository.appendStatusEvent(
      orderId,
      event,
      input.status,
      order.version
    );

    if (!updated) {
      const latest = await this.repository.findById(orderId);
      if (latest && latest.statusHistory.some((item) => item.eventId === input.eventId)) {
        // Concurrent writer won the race but processed the same event; treat as success.
        return latest;
      }

      throw new StatusConflictError('Concurrent modification detected while updating status');
    }

    return updated;
  }

  /**
   * Checks whether an order can move from `current` to `next`.
   *
   * Returning a boolean keeps the calling code expressive (an invalid transition
   * results in a specific StatusConflictError) while keeping the state machine
   * definition centralized above.
   */
  private canTransition(current: OrderStatus, next: OrderStatus): boolean {
    if (current === next) {
      return false;
    }
    return allowedTransitions[current]?.includes(next) ?? false;
  }

  /**
   * Schedules shipment creation with the Delivery mock in a fire-and-forget manner.
   *
   * Errors are logged for visibility but do not bubble to clients; retries are handled
   * by the DeliveryClient using exponential backoff.
   */
  private scheduleShipment(order: OrderRecord): void {
    // Fire-and-forget keeps client latency low while still wiring shipment creation.
    void this.deliveryClient
      .createShipment(order)
      .then(async (response) => {
        const metadata = this.deliveryClient.buildShipmentMetadata(response);
        await this.repository.updateShipmentMetadata(order.id, metadata);
      })
      .catch((error) => {
        this.logger.error(
          { err: error, orderId: order.id },
          'Failed to create shipment with Delivery service'
        );
      });
  }
}
