import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import type { RateLimitConfig } from '../config/env';
import type * as RateLimitNS from '@fastify/rate-limit';
import { createRateLimitStore } from './rate-limit-store';

type RateLimitOptions = RateLimitNS.RateLimitOptions;
type RateLimitPluginOptions = RateLimitNS.RateLimitPluginOptions;
type ErrorContext = RateLimitNS.errorResponseBuilderContext;

const toWindowSeconds = (milliseconds: number) => Math.ceil(milliseconds / 1000);

const buildOrderMessage = (max: number, windowMs: number) =>
  `Too many attempts. Limit: ${max} per ${toWindowSeconds(windowMs)} seconds. Please try again later.`;

/**
 * Rate limiting plugin that implements tiered rate limiting with different limits
 * for different endpoint types and comprehensive error handling.
 */
const rateLimitPlugin = fp(async (fastify, config: RateLimitConfig) => {
  if (!config.enabled) {
    fastify.log.info('Rate limiting is disabled');
    // Still decorate with empty configs so routes don't break
    fastify.decorate('rateLimiters', {
      orderCreate: { config: {} as RateLimitOptions },
      orderRead: { config: {} as RateLimitOptions },
      orderStatus: { config: {} as RateLimitOptions }
    });
    fastify.decorate('redisRateLimit', {
      getClient: () => undefined
    });
    return;
  }

  const storeAdapter = createRateLimitStore(config.store, fastify.log);
  fastify.decorate('redisRateLimit', {
    getClient: () => storeAdapter.getClient()
  });

  const globalOptions = storeAdapter.buildGlobalOptions({
    max: config.global.max,
    timeWindow: config.global.timeWindow,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: (_request, context: ErrorContext) => ({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      statusCode: 429,
      retryAfter: Math.ceil(context.ttl / 1000),
      limit: context.max,
      reset: new Date(Date.now() + context.ttl)
    }),
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true
    },
    onExceeding: (request, key) => {
      fastify.log.warn(
        {
          ip: request.ip,
          url: request.url,
          method: request.method,
          key,
          userAgent: request.headers['user-agent']
        },
        'Rate limit warning: client approaching limit'
      );
    },
    onExceeded: (request, key) => {
      fastify.log.warn(
        {
          ip: request.ip,
          url: request.url,
          method: request.method,
          key,
          userAgent: request.headers['user-agent']
        },
        'Rate limit exceeded'
      );
    }
  });

  await fastify.register(rateLimit, globalOptions as RateLimitPluginOptions);

  // Add route-specific rate limiters that can be applied to individual routes
  fastify.decorate('rateLimiters', {
    orderCreate: {
      config: {
        max: config.orders.create.max,
        timeWindow: config.orders.create.timeWindow,
        keyGenerator: (request: FastifyRequest) => `create:${request.ip}`,
        errorResponseBuilder: (_request: FastifyRequest, context: ErrorContext) => ({
          error: 'Order Creation Rate Limit Exceeded',
          message: buildOrderMessage(config.orders.create.max, config.orders.create.timeWindow),
          statusCode: 429,
          retryAfter: Math.ceil(context.ttl / 1000),
          limit: context.max,
          reset: new Date(Date.now() + context.ttl)
        })
      }
    },
    orderRead: {
      config: {
        max: config.orders.read.max,
        timeWindow: config.orders.read.timeWindow,
        keyGenerator: (request: FastifyRequest) => `read:${request.ip}`,
        errorResponseBuilder: (_request: FastifyRequest, context: ErrorContext) => ({
          error: 'Order Read Rate Limit Exceeded',
          message: buildOrderMessage(config.orders.read.max, config.orders.read.timeWindow),
          statusCode: 429,
          retryAfter: Math.ceil(context.ttl / 1000),
          limit: context.max,
          reset: new Date(Date.now() + context.ttl)
        })
      }
    },
    orderStatus: {
      config: {
        max: config.orders.status.max,
        timeWindow: config.orders.status.timeWindow,
        keyGenerator: (request: FastifyRequest) => `status:${request.ip}`,
        errorResponseBuilder: (_request: FastifyRequest, context: ErrorContext) => ({
          error: 'Order Status Update Rate Limit Exceeded',
          message: buildOrderMessage(config.orders.status.max, config.orders.status.timeWindow),
          statusCode: 429,
          retryAfter: Math.ceil(context.ttl / 1000),
          limit: context.max,
          reset: new Date(Date.now() + context.ttl)
        })
      }
    }
  });

  fastify.log.info(
    {
      globalLimit: config.global.max,
      globalWindow: config.global.timeWindow,
      orderCreateLimit: config.orders.create.max,
      orderReadLimit: config.orders.read.max,
      orderStatusLimit: config.orders.status.max,
      storeProvider: config.store.provider
    },
    'Rate limiting enabled with tiered limits'
  );

  fastify.addHook('onClose', async () => {
    await storeAdapter.close();
  });
});

export default rateLimitPlugin;
