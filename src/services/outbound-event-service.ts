import type { OrderRecord, StatusUpdateInput } from '../types/order';

export interface QueueMessage {
  queueName: string;
  payload: unknown;
  sentAt: string;
  processedAt?: string;
}

export interface QueueClient {
  sendMessage(queueName: string, payload: unknown): Promise<void>;
}

/**
 * In-memory queue store used as a stand-in for SQS during local development/tests. It keeps
 * every message that would have been enqueued so assertions and debugging are straightforward.
 */
export class InMemoryQueueStore {
  private messages: QueueMessage[] = [];

  enqueue(message: QueueMessage): void {
    this.messages.push(message);
  }

  all(): QueueMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  dequeue(predicate: (message: QueueMessage) => boolean): QueueMessage | undefined {
    const idx = this.messages.findIndex(predicate);
    if (idx === -1) {
      return undefined;
    }
    const [message] = this.messages.splice(idx, 1);
    return message;
  }
}

export class InMemoryQueueClient implements QueueClient {
  constructor(private readonly store: InMemoryQueueStore) {}

  async sendMessage(queueName: string, payload: unknown): Promise<void> {
    this.store.enqueue({
      queueName,
      payload,
      sentAt: new Date().toISOString()
    });
  }
}

export interface OutboundEventConfig {
  orderCreatedQueue: string;
  orderStatusQueue: string;
}

export interface OrderCreatedQueuePayload {
  orderId: string;
  customerId: OrderRecord['customerId'];
  totalAmount: OrderRecord['totalAmount'];
  status: OrderRecord['status'];
  createdAt: OrderRecord['createdAt'];
  items: OrderRecord['items'];
}

/**
 * Publishes domain events to the configured queue backend. The abstraction mirrors how we would
 * integrate with SQS/SNS in production, while defaulting to an in-memory mock for this exercise.
 */
export class OutboundEventService {
  constructor(
    private readonly queueClient: QueueClient,
    private readonly config: OutboundEventConfig
  ) {}

  async publishOrderCreated(order: OrderRecord): Promise<void> {
    const payload: OrderCreatedQueuePayload = {
      orderId: order.id,
      customerId: order.customerId,
      totalAmount: order.totalAmount,
      status: order.status,
      createdAt: order.createdAt,
      items: order.items
    };

    await this.queueClient.sendMessage(this.config.orderCreatedQueue, payload);
  }

  async enqueueStatusUpdate(orderId: string, event: StatusUpdateInput): Promise<void> {
    const payload: StatusUpdateQueuePayload = {
      orderId,
      event
    };

    await this.queueClient.sendMessage(this.config.orderStatusQueue, payload);
  }
}

export interface StatusUpdateQueuePayload {
  orderId: string;
  event: StatusUpdateInput;
}

/**
 * Consumer-like helper for processing in-memory queue messages. In production this would be
 * replaced with a dedicated worker pulling from SQS/SNS/Kinesis; here we model the behavior so
 * the flow can be demonstrated end-to-end.
 */
export class InMemoryQueueConsumer {
  constructor(
    private readonly store: InMemoryQueueStore,
    private readonly handler: (message: QueueMessage) => Promise<void>
  ) {}

  async consumeOne(queueName: string): Promise<QueueMessage | undefined> {
    const message = this.store.dequeue((item) => item.queueName === queueName);
    if (!message) {
      return undefined;
    }

    try {
      await this.handler(message);
    } catch (error) {
      this.store.enqueue(message);
      throw error;
    }
    return {
      ...message,
      processedAt: new Date().toISOString()
    };
  }
}
