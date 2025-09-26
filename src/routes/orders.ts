import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { CreateOrderInput } from '../types/order';
import {
  IdempotencyConflictError,
  OrderNotFoundError,
  OrderService,
  ProductUnavailableError,
  StatusConflictError
} from '../services/order-service';

const idempotencyHeaderSchema = {
  type: 'object',
  required: ['idempotency-key'],
  properties: {
    'idempotency-key': { type: 'string', minLength: 1 }
  }
};

const createOrderBodySchema = {
  type: 'object',
  required: ['customerId', 'items', 'totalAmount'],
  properties: {
    customerId: { type: 'string', minLength: 1 },
    totalAmount: { type: 'number', exclusiveMinimum: 0 },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['sku', 'qty'],
        properties: {
          sku: { type: 'string', minLength: 1 },
          qty: { type: 'integer', minimum: 1 }
        }
      }
    }
  }
};

const statusUpdateBodySchema = {
  type: 'object',
  required: ['status', 'at'],
  properties: {
    status: { enum: ['SHIPPED', 'DELIVERED'] },
    at: { type: 'string', format: 'date-time' }
  }
};

/**
 * Registers the Sales order HTTP endpoints. The plugin keeps schema definitions adjacent
 * to handlers so interviewers can see the validation rules alongside the business wiring.
 */
const ordersRoutes: FastifyPluginAsync = async (fastify) => {
  const orderService: OrderService = fastify.services.orderService;

  // Client-facing endpoint for creating orders with idempotency and availability enforcement.
  fastify.post<{ Body: CreateOrderInput }>(
    '/orders',
    {
      schema: {
        headers: idempotencyHeaderSchema,
        body: createOrderBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              orderId: { type: 'string' },
              status: { type: 'string' }
            }
          },
          201: {
            type: 'object',
            properties: {
              orderId: { type: 'string' },
              status: { type: 'string' }
            }
          }
        }
      },
      config: {
        rateLimit: fastify.rateLimiters.orderCreate.config
      }
    },
    async (request, reply) => {
      const idempotencyKey = extractIdempotencyKey(request.headers);
      if (!idempotencyKey) {
        throw fastify.httpErrors.badRequest('Idempotency-Key header is required');
      }

      try {
        const result = await orderService.createOrder(request.body, idempotencyKey);
        const statusCode = result.created ? 201 : 200;
        return reply.code(statusCode).send({ orderId: result.order.id, status: result.order.status });
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          throw fastify.httpErrors.conflict(error.message);
        }
        if (error instanceof ProductUnavailableError) {
          const conflictError = fastify.httpErrors.conflict(error.message);
          if (error.details) {
            (conflictError as { details?: unknown }).details = error.details;
          }
          throw conflictError;
        }
        throw error;
      }
    }
  );

  // Fetch the latest representation of a specific order, returning 404 when missing.
  fastify.get<{ Params: { orderId: string } }>(
    '/orders/:orderId',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              customerId: { type: 'string' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    sku: { type: 'string' },
                    qty: { type: 'number' }
                  }
                }
              },
              totalAmount: { type: 'number' },
              status: { type: 'string' },
              requestId: { type: 'string' },
              payloadHash: { type: 'string' },
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' },
              version: { type: 'number' },
              statusHistory: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    eventId: { type: 'string' },
                    status: { type: 'string' },
                    at: { type: 'string' }
                  }
                }
              },
              shipment: {
                type: 'object',
                properties: {
                  shipmentId: { type: 'string' },
                  state: { type: 'string' },
                  requestedAt: { type: 'string' }
                }
              }
            }
          }
        }
      },
      config: {
        rateLimit: fastify.rateLimiters.orderRead.config
      }
    },
    async (request) => {
      try {
        return await orderService.getOrder(request.params.orderId);
      } catch (error) {
        if (error instanceof OrderNotFoundError) {
          throw fastify.httpErrors.notFound(error.message);
        }
        throw error;
      }
    }
  );

  // Delivery callback endpoint: enqueues SHIPPED/DELIVERED events for asynchronous processing.
  fastify.post<{ Params: { orderId: string }; Body: { status: 'SHIPPED' | 'DELIVERED'; at: string } }>(
    '/orders/:orderId/status',
    {
      schema: {
        headers: idempotencyHeaderSchema,
        body: statusUpdateBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              accepted: { type: 'boolean' },
              duplicate: { type: 'boolean' }
            }
          },
          202: {
            type: 'object',
            properties: {
              accepted: { type: 'boolean' }
            }
          }
        }
      },
      config: {
        rateLimit: fastify.rateLimiters.orderStatus.config
      }
    },
    async (request, reply: FastifyReply) => {
      const idempotencyKey = extractIdempotencyKey(request.headers);
      if (!idempotencyKey) {
        throw fastify.httpErrors.badRequest('Idempotency-Key header is required');
      }

      if (Number.isNaN(Date.parse(request.body.at))) {
        throw fastify.httpErrors.badRequest('Field "at" must be a valid ISO-8601 timestamp');
      }

      let prepared;
      try {
        prepared = await orderService.validateStatusUpdate(request.params.orderId, {
          status: request.body.status,
          at: request.body.at,
          eventId: idempotencyKey
        });
      } catch (error) {
        if (error instanceof OrderNotFoundError) {
          throw fastify.httpErrors.notFound(error.message);
        }
        if (error instanceof StatusConflictError) {
          throw fastify.httpErrors.conflict(error.message);
        }
        throw error;
      }

      if (!prepared.event) {
        return reply.code(200).send({ accepted: false, duplicate: true });
      }

      await fastify.services.outboundEventService.enqueueStatusUpdate(
        request.params.orderId,
        prepared.event
      );

      return reply.code(202).send({ accepted: true });
    }
  );
};

/**
 * Normalizes the `Idempotency-Key` header. Fastify exposes headers as string | string[] | undefined,
 * so this helper collapses the possibilities in one place instead of repeating guards in routes.
 */
function extractIdempotencyKey(headers: Record<string, unknown>): string | undefined {
  const value = headers['idempotency-key'];
  // Delivery partners may resend headers as arrays; normalize to the first seen value.
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

export default ordersRoutes;
