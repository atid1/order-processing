import type { FastifyBaseLogger } from 'fastify';
import type { RateLimitStoreConfig } from '../config/env';
import type * as RateLimitNS from '@fastify/rate-limit';

type RateLimitPluginOptions = RateLimitNS.RateLimitPluginOptions;

type AnyGlobalOptions = RateLimitPluginOptions & {
  redis?: unknown;
};

export interface RateLimitStoreAdapter {
  buildGlobalOptions(options: RateLimitPluginOptions): RateLimitPluginOptions;
  getClient(): unknown;
  close(): Promise<void>;
}

class MemoryStoreAdapter implements RateLimitStoreAdapter {
  buildGlobalOptions(options: RateLimitPluginOptions): RateLimitPluginOptions {
    return options;
  }

  getClient(): unknown {
    return undefined;
  }

  async close(): Promise<void> {
    // nothing to do
  }
}

class RedisStoreAdapter implements RateLimitStoreAdapter {
  private client: any;
  private useRedis = true;
  private warned = false;
  private ready = false;

  constructor(private readonly logger: FastifyBaseLogger, config: NonNullable<RateLimitStoreConfig['redis']>) {
    const Redis = loadRedis(logger);
    const tlsOptions = config.useTls ? {} : undefined;
    this.client = new Redis({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      db: config.db,
      ...(tlsOptions ? { tls: tlsOptions } : {})
    });

    this.client.on('ready', () => {
      this.logger.info('Redis rate-limit store connected');
      this.useRedis = true;
      this.warned = false;
      this.ready = true;
    });

    this.client.on('error', (error: any) => {
      const logMethod = this.warned ? 'debug' : 'error';
      this.logger[logMethod]({ err: error }, 'Redis rate-limit store connection error');
      this.warned = true;

      if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
        this.useRedis = false;
      }
    });

    this.client.on('end', () => {
      this.logger.warn('Redis rate-limit store connection closed, falling back to memory store');
      this.useRedis = false;
    });
  }

  buildGlobalOptions(options: RateLimitPluginOptions): RateLimitPluginOptions {
    if (this.useRedis) {
      return {
        ...(options as AnyGlobalOptions),
        redis: this.client
      };
    }

    return options;
  }

  getClient(): unknown {
    return this.useRedis && this.ready ? this.client : undefined;
  }

  async close(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to close Redis rate-limit client gracefully');
    }
  }
}

function loadRedis(logger: FastifyBaseLogger) {
  try {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    return require('ioredis');
  } catch (error) {
    logger.error(
      { err: error },
      'Rate limit store provider "redis" requires the optional dependency "ioredis" to be installed'
    );
    throw new Error('Rate limiting configured for Redis, but the "ioredis" package is not installed.');
  }
}

export function createRateLimitStore(
  storeConfig: RateLimitStoreConfig,
  logger: FastifyBaseLogger
): RateLimitStoreAdapter {
  if (storeConfig.provider === 'redis') {
    if (!storeConfig.redis) {
      throw new Error('Redis rate-limit store selected but no connection settings were provided.');
    }
    return new RedisStoreAdapter(logger, storeConfig.redis);
  }

  return new MemoryStoreAdapter();
}
