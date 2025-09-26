import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import rateLimitPlugin from '../src/plugins/rate-limit';
import type { RateLimitConfig } from '../src/config/env';

vi.mock('ioredis', () => {
  class MockRedis {
    private handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    private ready = false;
    private store = new Map<string, { count: number; expiresAt: number }>();
    private rateLimitImpl?: (
      key: string,
      timeWindow: number,
      max: number,
      ban: number,
      continueExceeding: boolean,
      cb: (err: unknown, result?: [number, number, boolean]) => void
    ) => void;
    public rateLimit?: (
      key: string,
      timeWindow: number,
      max: number,
      ban: number,
      continueExceeding: boolean,
      cb: (err: unknown, result?: [number, number, boolean]) => void
    ) => void;

    constructor() {
      setTimeout(() => {
        this.ready = true;
        this.handlers.ready?.forEach((handler) => handler());
      }, 0);
    }

    on(event: string, handler: (arg?: unknown) => void) {
      this.handlers[event] = this.handlers[event] ?? [];
      this.handlers[event].push(handler);
      if (event === 'ready' && this.ready) {
        setTimeout(() => handler(), 0);
      }
    }

    defineCommand(name: string, _options: { numberOfKeys: number; lua: string }) {
      if (name !== 'rateLimit') {
        return;
      }
      this.rateLimitImpl = (key, timeWindow, max, ban, continueExceeding, cb) => {
        const now = Date.now();
        const entry = this.store.get(key);
        if (!entry || entry.expiresAt <= now) {
          this.store.set(key, { count: 0, expiresAt: now + Number(timeWindow) });
        }
        const next = this.store.get(key)!;
        next.count += 1;
        if (continueExceeding && next.count > max) {
          next.expiresAt = now + Number(timeWindow);
        }
        const ttl = Math.max(0, next.expiresAt - now);
        const banExceeded = ban !== -1 && next.count - max > ban;
        cb(null, [next.count, ttl, banExceeded]);
      };
      this.rateLimit = (
        key: string,
        timeWindow: number,
        max: number,
        ban: number,
        continueExceeding: boolean,
        cb: (err: unknown, result?: [number, number, boolean]) => void
      ) => {
        if (!this.rateLimitImpl) {
          cb(new Error('rateLimit command not defined'));
          return;
        }
        this.rateLimitImpl(key, timeWindow, max, ban, continueExceeding, cb);
      };
    }

    async quit(): Promise<void> {
      // noop
    }
  }

  return MockRedis;
});

const rateLimitConfig: RateLimitConfig = {
  enabled: true,
  global: {
    max: 100,
    timeWindow: 60_000
  },
  orders: {
    create: {
      max: 2,
      timeWindow: 1_000
    },
    read: {
      max: 100,
      timeWindow: 60_000
    },
    status: {
      max: 100,
      timeWindow: 60_000
    }
  },
  store: { provider: 'memory' }
};

describe('Rate limit plugin behaviour', () => {
  const app = Fastify({ logger: false });

  beforeAll(async () => {
    await app.register(rateLimitPlugin, rateLimitConfig);
    app.get(
      '/limited',
      {
        config: { rateLimit: app.rateLimiters.orderCreate.config }
      },
      async () => ({ ok: true })
    );

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests under the limit and blocks when exceeded', async () => {
    const first = await app.inject({ method: 'GET', url: '/limited' });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'GET', url: '/limited' });
    expect(second.statusCode).toBe(200);

    const third = await app.inject({ method: 'GET', url: '/limited' });
    expect(third.statusCode).toBe(429);
    expect(third.headers).toMatchObject({
      'x-ratelimit-limit': '2'
    });

    const body = third.json<{ message: string; statusCode: number }>();
    expect(body.statusCode).toBe(429);
    expect(body.message).toContain('Too many attempts');
  });
});

describe('Rate limit plugin behaviour (redis store)', () => {
  const app = Fastify({ logger: false });

  const redisConfig: RateLimitConfig = {
    ...rateLimitConfig,
    store: {
      provider: 'redis',
      redis: {
        host: 'redis',
        port: 6379,
        db: 0,
        useTls: false
      }
    }
  };

  beforeAll(async () => {
    await app.register(rateLimitPlugin, redisConfig);
    app.get(
      '/limited',
      {
        config: { rateLimit: app.rateLimiters.orderCreate.config }
      },
      async () => ({ ok: true })
    );

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('decorates redis client access when using redis store', () => {
    expect(app.redisRateLimit).toBeDefined();
    expect(app.redisRateLimit?.getClient()).toBeUndefined();
  });
});
