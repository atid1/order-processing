import type { FastifyBaseLogger } from 'fastify';
import { fetch } from 'undici';
import { executeWithRetry } from '../utils/retry';
import type { OrderRecord, ShipmentMetadata } from '../types/order';

/**
 * Tunable parameters for communicating with the Delivery mock. They are injected via
 * configuration so the same client can run in tests (fast timeouts, few retries) and
 * production (higher ceilings) without code changes.
 */
export interface DeliveryClientConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

export interface DeliveryShipmentResponse {
  shipmentId: string;
  state: string;
}

/**
 * Internal error type that carries HTTP status information returned by the Delivery service.
 * Having a distinct class simplifies the retry predicate because we can branch on status.
 */
class DeliveryHttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'DeliveryHttpError';
  }
}

/**
 * Thin HTTP client responsible for posting shipments to the Delivery service with
 * retry-and-timeout behavior baked in. It keeps network concerns outside the domain
 * service and ensures logs capture retry decisions with relevant context.
 */
export class DeliveryClient {
  constructor(
    private readonly config: DeliveryClientConfig,
    private readonly logger: FastifyBaseLogger
  ) {}

  /**
   * Issues the outbound shipment creation request. The Idempotency-Key mirrors the order
   * request id so Delivery can deduplicate retries, matching the contract we expect from
   * downstream partners.
   */
  async createShipment(order: OrderRecord): Promise<DeliveryShipmentResponse> {
    const requestPayload = {
      orderId: order.id,
      customerId: order.customerId,
      items: order.items,
      totalAmount: order.totalAmount
    };

    const operation = async (): Promise<DeliveryShipmentResponse> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await fetch(`${this.config.baseUrl}/v1/shipments`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': order.requestId
          },
          body: JSON.stringify(requestPayload),
          signal: controller.signal
        });

        if (!response.ok) {
          const bodyText = await response.text().catch(() => undefined);
          throw new DeliveryHttpError(
            `Delivery service responded with status ${response.status}`,
            response.status,
            bodyText
          );
        }

        const data = (await response.json()) as DeliveryShipmentResponse;
        return data;
      } finally {
        clearTimeout(timeout);
      }
    };

    return executeWithRetry(
      operation,
      {
        maxRetries: this.config.maxRetries,
        baseDelayMs: this.config.retryBaseDelayMs,
        maxDelayMs: this.config.retryBaseDelayMs * 10
      },
      {
        shouldRetry: (error) => {
          if (error instanceof DeliveryHttpError) {
            if (error.statusCode >= 500 || error.statusCode === 429) {
              return true;
            }
            return false;
          }

          if (error instanceof Error && error.name === 'AbortError') {
            return true;
          }

          return true;
        },
        onRetry: (error, attempt, delay) => {
          this.logger.warn(
            { err: error, attempt, delay },
            'Delivery shipment request failed, retrying'
          );
        }
      }
    );
  }

  /**
   * Helper to translate the raw Delivery response into the persistence shape used by orders.
   */
  buildShipmentMetadata(response: DeliveryShipmentResponse): ShipmentMetadata {
    return {
      shipmentId: response.shipmentId,
      state: response.state,
      requestedAt: new Date().toISOString()
    };
  }
}
