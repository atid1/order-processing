import type { Collection, WithId } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { OrderRecord, StatusEvent, ShipmentMetadata } from '../types/order';

interface OrderDocument extends OrderRecord {
  _id?: ObjectId;
}

/**
 * MongoDB backed persistence layer for orders. Keeping database specifics isolated here
 * lets the service coordinate business rules without concerning itself with indexes,
 * projection tweaks, or driver return shapes.
 */
export class OrderRepository {
  constructor(private readonly collection: Collection<OrderDocument>) {}

  /**
   * Creates the indexes required for fast lookups and idempotency guarantees.
   * Should be called during application bootstrap before serving traffic.
   */
  async init(): Promise<void> {
    // Unique ids and requestId enforce external idempotency contracts.
    await this.collection.createIndex({ id: 1 }, { unique: true });
    await this.collection.createIndex({ requestId: 1 }, { unique: true });
  }

  /**
   * Persists a new order document.
   *
   * The MongoDB driver clones objects internally, but we copy here to ensure that
   * the repository never mutates the caller's reference inadvertently.
   */
  async create(order: OrderRecord): Promise<OrderRecord> {
    const document: OrderDocument = { ...order };
    await this.collection.insertOne(document);
    return order;
  }

  /**
   * Fetches the order that was created using the provided Idempotency-Key.
   */
  async findByRequestId(requestId: string): Promise<OrderRecord | null> {
    const document = await this.collection.findOne({ requestId });
    return document ? this.map(document) : null;
  }

  /**
   * Retrieves an order by its public identifier.
   */
  async findById(orderId: string): Promise<OrderRecord | null> {
    const document = await this.collection.findOne({ id: orderId });
    return document ? this.map(document) : null;
  }

  /**
   * Atomically appends a new status event when the optimistic `version` matches and the
   * eventId has not yet been processed. Returns the updated document when successful.
   */
  async appendStatusEvent(
    orderId: string,
    event: StatusEvent,
    nextStatus: OrderRecord['status'],
    expectedVersion: number
  ): Promise<OrderRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        id: orderId,
        version: expectedVersion,
        'statusHistory.eventId': { $ne: event.eventId }
      },
      {
        $set: {
          status: nextStatus,
          updatedAt: new Date().toISOString()
        },
        $push: { statusHistory: event },
        $inc: { version: 1 }
      },
      { returnDocument: 'after' }
    );

    // Returning the fresh document lets callers surface the new version/state immediately.
    return updated ? this.map(updated) : null;
  }

  /**
   * Stores shipment metadata obtained from the Delivery service. This call does not change
   * the optimistic version because the information is ancillary and should not block other
   * status transitions.
   */
  async updateShipmentMetadata(
    orderId: string,
    metadata: ShipmentMetadata
  ): Promise<void> {
    await this.collection.updateOne(
      { id: orderId },
      {
        $set: {
          shipment: metadata,
          updatedAt: new Date().toISOString(),
          // no version bump because shipment updates are informative
        }
      }
    );
  }

  /**
   * Normalizes MongoDB documents by removing the internal `_id` field so the domain layer
   * only works with the public representation.
   */
  private map(document: WithId<OrderDocument>): OrderRecord {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, ...rest } = document;
    return rest;
  }
}
