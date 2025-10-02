import { describe, expect, it } from 'vitest';
import {
  InMemoryQueueStore,
  InMemoryQueueClient,
  InMemoryQueueConsumer
} from '../src/services/outbound-event-service';

describe('InMemoryQueueConsumer', () => {
  it('routes exhausted messages to the dead-letter queue', async () => {
    const store = new InMemoryQueueStore();
    const client = new InMemoryQueueClient(store);
    const queueName = 'primary';
    const deadLetterQueue = 'primary-dlq';
    await client.sendMessage(queueName, { sample: 'payload' });

    const consumer = new InMemoryQueueConsumer(
      store,
      async () => {
        throw new Error('handler failure');
      },
      {
        maxDeliveries: 2,
        deadLetterQueue
      }
    );

    await expect(consumer.consumeOne(queueName)).rejects.toThrow('handler failure');

    const requeued = store
      .all()
      .filter((message) => message.queueName === queueName);
    expect(requeued).toHaveLength(1);
    expect(requeued[0].attempts).toBe(1);
    expect(requeued[0].lastError).toBe('handler failure');
    expect(requeued[0].lastFailedAt).toBeDefined();

    await expect(consumer.consumeOne(queueName)).rejects.toThrow('handler failure');

    const dlqMessages = store
      .all()
      .filter((message) => message.queueName === deadLetterQueue);
    expect(dlqMessages).toHaveLength(1);
    expect(dlqMessages[0].attempts).toBe(2);
    expect(dlqMessages[0].deadLetteredAt).toBeDefined();
    expect(dlqMessages[0].lastError).toBe('handler failure');
  });

  it('returns processed metadata including attempts on success', async () => {
    const store = new InMemoryQueueStore();
    const client = new InMemoryQueueClient(store);
    const queueName = 'primary-success';
    await client.sendMessage(queueName, { sample: 'payload' });

    const consumer = new InMemoryQueueConsumer(
      store,
      async () => {
        // success
      },
      {
        maxDeliveries: 3,
        deadLetterQueue: 'unused-dlq'
      }
    );

    const processed = await consumer.consumeOne(queueName);
    expect(processed).toBeDefined();
    expect(processed?.queueName).toBe(queueName);
    expect(processed?.attempts).toBe(1);
    expect(processed?.processedAt).toBeDefined();

    const remaining = store
      .all()
      .filter((message) => message.queueName === queueName);
    expect(remaining).toHaveLength(0);
  });
});
