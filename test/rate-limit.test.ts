import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/env';

describe('Rate Limiting Configuration', () => {
  const preservedEnv = { ...process.env };
  const baseEnv = {
    MONGO_URI: 'mongodb://localhost:27017/test',
    MONGO_DB_NAME: 'test',
    DELIVERY_BASE_URL: 'http://localhost:4000'
  };

  beforeEach(() => {
    Object.assign(process.env, preservedEnv);
    Object.assign(process.env, baseEnv);
  });

  afterEach(() => {
    Object.assign(process.env, preservedEnv);
    vi.unstubAllEnvs();
  });

  it('should load rate limiting configuration from environment', () => {
    // Set environment variables for testing
    process.env.MONGO_URI = 'mongodb://test:27017';
    process.env.MONGO_DB_NAME = 'test';
    process.env.DELIVERY_BASE_URL = 'http://test:4000';
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_GLOBAL_MAX = '500';
    process.env.RATE_LIMIT_GLOBAL_WINDOW = '30000';
    process.env.RATE_LIMIT_ORDER_CREATE_MAX = '5';
    process.env.RATE_LIMIT_ORDER_CREATE_WINDOW = '60000';
    process.env.RATE_LIMIT_ORDER_READ_MAX = '50';
    process.env.RATE_LIMIT_ORDER_READ_WINDOW = '60000';
    process.env.RATE_LIMIT_ORDER_STATUS_MAX = '25';
    process.env.RATE_LIMIT_ORDER_STATUS_WINDOW = '60000';
    process.env.RATE_LIMIT_STORE_PROVIDER = 'memory';

    const config = loadConfig();

    expect(config.rateLimit).toBeDefined();
    expect(config.rateLimit.enabled).toBe(true);
    expect(config.rateLimit.global.max).toBe(500);
    expect(config.rateLimit.global.timeWindow).toBe(30000);
    expect(config.rateLimit.orders.create.max).toBe(5);
    expect(config.rateLimit.orders.create.timeWindow).toBe(60000);
    expect(config.rateLimit.orders.read.max).toBe(50);
    expect(config.rateLimit.orders.read.timeWindow).toBe(60000);
    expect(config.rateLimit.orders.status.max).toBe(25);
    expect(config.rateLimit.orders.status.timeWindow).toBe(60000);
    expect(config.rateLimit.store.provider).toBe('memory');
  });

  it('should use default rate limiting values when not specified', () => {
    // Clear rate limiting env vars to test defaults
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.RATE_LIMIT_GLOBAL_MAX;
    delete process.env.RATE_LIMIT_GLOBAL_WINDOW;
    delete process.env.RATE_LIMIT_ORDER_CREATE_MAX;
    delete process.env.RATE_LIMIT_ORDER_CREATE_WINDOW;
    delete process.env.RATE_LIMIT_ORDER_READ_MAX;
    delete process.env.RATE_LIMIT_ORDER_READ_WINDOW;
    delete process.env.RATE_LIMIT_ORDER_STATUS_MAX;
    delete process.env.RATE_LIMIT_ORDER_STATUS_WINDOW;
    delete process.env.RATE_LIMIT_STORE_PROVIDER;

    const config = loadConfig();

    expect(config.rateLimit.enabled).toBe(true); // default
    expect(config.rateLimit.global.max).toBe(1000); // default
    expect(config.rateLimit.global.timeWindow).toBe(60000); // default
    expect(config.rateLimit.orders.create.max).toBe(10); // default
    expect(config.rateLimit.orders.create.timeWindow).toBe(60000); // default
    expect(config.rateLimit.orders.read.max).toBe(100); // default
    expect(config.rateLimit.orders.read.timeWindow).toBe(60000); // default
    expect(config.rateLimit.orders.status.max).toBe(50); // default
    expect(config.rateLimit.orders.status.timeWindow).toBe(60000); // default
    expect(config.rateLimit.store.provider).toBe('memory');
  });

  it('should allow disabling rate limiting', () => {
    process.env.RATE_LIMIT_ENABLED = 'false';

    const config = loadConfig();

    expect(config.rateLimit.enabled).toBe(false);
  });

  it('should parse redis store configuration when selected', () => {
    process.env.RATE_LIMIT_STORE_PROVIDER = 'redis';
    process.env.RATE_LIMIT_REDIS_HOST = 'redis.example.com';
    process.env.RATE_LIMIT_REDIS_PORT = '6380';
    process.env.RATE_LIMIT_REDIS_USERNAME = 'user';
    process.env.RATE_LIMIT_REDIS_PASSWORD = 'secret';
    process.env.RATE_LIMIT_REDIS_DB = '2';
    process.env.RATE_LIMIT_REDIS_TLS = 'true';

    const config = loadConfig();

    expect(config.rateLimit.store.provider).toBe('redis');
    expect(config.rateLimit.store.redis).toMatchObject({
      host: 'redis.example.com',
      port: 6380,
      username: 'user',
      password: 'secret',
      db: 2,
      useTls: true
    });

    delete process.env.RATE_LIMIT_STORE_PROVIDER;
  });

  it('should validate rate limiting configuration structure', () => {
    const config = loadConfig();

    // Verify the configuration has the expected structure
    expect(config.rateLimit).toHaveProperty('enabled');
    expect(config.rateLimit).toHaveProperty('global');
    expect(config.rateLimit).toHaveProperty('orders');
    expect(config.rateLimit).toHaveProperty('store');

    expect(config.rateLimit.global).toHaveProperty('max');
    expect(config.rateLimit.global).toHaveProperty('timeWindow');

    expect(config.rateLimit.orders).toHaveProperty('create');
    expect(config.rateLimit.orders).toHaveProperty('read');
    expect(config.rateLimit.orders).toHaveProperty('status');

    expect(config.rateLimit.orders.create).toHaveProperty('max');
    expect(config.rateLimit.orders.create).toHaveProperty('timeWindow');
    expect(config.rateLimit.orders.read).toHaveProperty('max');
    expect(config.rateLimit.orders.read).toHaveProperty('timeWindow');
    expect(config.rateLimit.orders.status).toHaveProperty('max');
    expect(config.rateLimit.orders.status).toHaveProperty('timeWindow');

    // Verify all values are positive numbers
    expect(config.rateLimit.global.max).toBeGreaterThan(0);
    expect(config.rateLimit.global.timeWindow).toBeGreaterThan(0);
    expect(config.rateLimit.orders.create.max).toBeGreaterThan(0);
    expect(config.rateLimit.orders.create.timeWindow).toBeGreaterThan(0);
    expect(config.rateLimit.orders.read.max).toBeGreaterThan(0);
    expect(config.rateLimit.orders.read.timeWindow).toBeGreaterThan(0);
    expect(config.rateLimit.orders.status.max).toBeGreaterThan(0);
    expect(config.rateLimit.orders.status.timeWindow).toBeGreaterThan(0);
    expect(['memory', 'redis']).toContain(config.rateLimit.store.provider);
  });
});
