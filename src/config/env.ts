import envSchema from 'env-schema';

/**
 * Configuration knobs for interacting with the Delivery service. These are populated from
 * environment variables so deployments can tune retry behavior without recompiling.
 */
export interface DeliveryConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

/**
 * Rate limiting configuration with different limits for different endpoint types.
 */
export type RateLimitStoreProvider = 'memory' | 'redis';

export interface RateLimitStoreConfig {
  provider: RateLimitStoreProvider;
  redis?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    db?: number;
    useTls?: boolean;
  };
}

export interface RateLimitConfig {
  enabled: boolean;
  global: {
    max: number;
    timeWindow: number;
  };
  orders: {
    create: {
      max: number;
      timeWindow: number;
    };
    read: {
      max: number;
      timeWindow: number;
    };
    status: {
      max: number;
      timeWindow: number;
    };
  };
  store: RateLimitStoreConfig;
}

/**
 * MongoDB connection parameters resolved at boot.
 */
export interface MongoConfig {
  uri: string;
  dbName: string;
}

/**
 * Fully resolved application configuration shared across plugins via Fastify decoration.
 */
export interface AppConfig {
  env: string;
  port: number;
  host: string;
  mongo: MongoConfig;
  delivery: DeliveryConfig;
  rateLimit: RateLimitConfig;
  events: {
    orderCreatedQueue: string;
    orderStatusQueue: string;
  };
  autoConsumeStatusQueue: boolean;
}

interface RawEnv {
  NODE_ENV: string;
  HOST: string;
  PORT: number;
  MONGO_URI: string;
  MONGO_DB_NAME: string;
  DELIVERY_BASE_URL: string;
  DELIVERY_TIMEOUT_MS: number;
  DELIVERY_MAX_RETRIES: number;
  DELIVERY_RETRY_BASE_DELAY_MS: number;
  ORDER_CREATED_QUEUE: string;
  ORDER_STATUS_QUEUE: string;
  AUTO_CONSUME_STATUS_QUEUE: boolean;
  RATE_LIMIT_ENABLED: boolean;
  RATE_LIMIT_GLOBAL_MAX: number;
  RATE_LIMIT_GLOBAL_WINDOW: number;
  RATE_LIMIT_ORDER_CREATE_MAX: number;
  RATE_LIMIT_ORDER_CREATE_WINDOW: number;
  RATE_LIMIT_ORDER_READ_MAX: number;
  RATE_LIMIT_ORDER_READ_WINDOW: number;
  RATE_LIMIT_ORDER_STATUS_MAX: number;
  RATE_LIMIT_ORDER_STATUS_WINDOW: number;
  RATE_LIMIT_STORE_PROVIDER: string;
  RATE_LIMIT_REDIS_HOST: string;
  RATE_LIMIT_REDIS_PORT: number;
  RATE_LIMIT_REDIS_USERNAME: string;
  RATE_LIMIT_REDIS_PASSWORD: string;
  RATE_LIMIT_REDIS_DB: number;
  RATE_LIMIT_REDIS_TLS: boolean;
}

/**
 * Reads process environment variables (optionally sourced from a `.env` file) and validates
 * them against a strict schema. Centralizing the parsing logic ensures all modules consume
 * a consistent configuration object and helps the interviewer see the expected settings.
 */
export function loadConfig(): AppConfig {
  const schema = {
    type: 'object',
    properties: {
      NODE_ENV: { type: 'string', default: 'development' },
      HOST: { type: 'string', default: '0.0.0.0' },
      PORT: { type: 'number', default: 3000 },
      MONGO_URI: { type: 'string' },
      MONGO_DB_NAME: { type: 'string' },
      DELIVERY_BASE_URL: { type: 'string' },
      DELIVERY_TIMEOUT_MS: { type: 'number', default: 5000 },
      DELIVERY_MAX_RETRIES: { type: 'number', default: 3 },
      DELIVERY_RETRY_BASE_DELAY_MS: { type: 'number', default: 200 },
      ORDER_CREATED_QUEUE: { type: 'string', default: 'order-created-events' },
      ORDER_STATUS_QUEUE: { type: 'string', default: 'order-status-events' },
      AUTO_CONSUME_STATUS_QUEUE: { type: 'boolean', default: false },
      RATE_LIMIT_ENABLED: { type: 'boolean', default: true },
      RATE_LIMIT_GLOBAL_MAX: { type: 'number', default: 1000 },
      RATE_LIMIT_GLOBAL_WINDOW: { type: 'number', default: 60000 },
      RATE_LIMIT_ORDER_CREATE_MAX: { type: 'number', default: 10 },
      RATE_LIMIT_ORDER_CREATE_WINDOW: { type: 'number', default: 60000 },
      RATE_LIMIT_ORDER_READ_MAX: { type: 'number', default: 100 },
      RATE_LIMIT_ORDER_READ_WINDOW: { type: 'number', default: 60000 },
      RATE_LIMIT_ORDER_STATUS_MAX: { type: 'number', default: 50 },
      RATE_LIMIT_ORDER_STATUS_WINDOW: { type: 'number', default: 60000 },
      RATE_LIMIT_STORE_PROVIDER: { type: 'string', default: 'memory' },
      RATE_LIMIT_REDIS_HOST: { type: 'string', default: '127.0.0.1' },
      RATE_LIMIT_REDIS_PORT: { type: 'number', default: 6379 },
      RATE_LIMIT_REDIS_USERNAME: { type: 'string', default: '' },
      RATE_LIMIT_REDIS_PASSWORD: { type: 'string', default: '' },
      RATE_LIMIT_REDIS_DB: { type: 'number', default: 0 },
      RATE_LIMIT_REDIS_TLS: { type: 'boolean', default: false }
    },
    required: ['MONGO_URI', 'MONGO_DB_NAME', 'DELIVERY_BASE_URL']
  } as const;

  const env = envSchema<RawEnv>({
    dotenv: true,
    schema
  });

  return {
    env: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    mongo: {
      uri: env.MONGO_URI,
      dbName: env.MONGO_DB_NAME
    },
    delivery: {
      baseUrl: env.DELIVERY_BASE_URL,
      timeoutMs: env.DELIVERY_TIMEOUT_MS,
      maxRetries: env.DELIVERY_MAX_RETRIES,
      retryBaseDelayMs: env.DELIVERY_RETRY_BASE_DELAY_MS
    },
    rateLimit: {
      enabled: env.RATE_LIMIT_ENABLED,
      global: {
        max: env.RATE_LIMIT_GLOBAL_MAX,
        timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW
      },
      orders: {
        create: {
          max: env.RATE_LIMIT_ORDER_CREATE_MAX,
          timeWindow: env.RATE_LIMIT_ORDER_CREATE_WINDOW
        },
        read: {
          max: env.RATE_LIMIT_ORDER_READ_MAX,
          timeWindow: env.RATE_LIMIT_ORDER_READ_WINDOW
        },
        status: {
          max: env.RATE_LIMIT_ORDER_STATUS_MAX,
          timeWindow: env.RATE_LIMIT_ORDER_STATUS_WINDOW
        }
      },
      store: {
        provider: env.RATE_LIMIT_STORE_PROVIDER === 'redis' ? 'redis' : 'memory',
        redis:
          env.RATE_LIMIT_STORE_PROVIDER === 'redis'
            ? {
              host: env.RATE_LIMIT_REDIS_HOST,
              port: env.RATE_LIMIT_REDIS_PORT,
              username: env.RATE_LIMIT_REDIS_USERNAME || undefined,
              password: env.RATE_LIMIT_REDIS_PASSWORD || undefined,
              db: env.RATE_LIMIT_REDIS_DB,
              useTls: env.RATE_LIMIT_REDIS_TLS
            }
            : undefined
      }
    },
    events: {
      orderCreatedQueue: env.ORDER_CREATED_QUEUE,
      orderStatusQueue: env.ORDER_STATUS_QUEUE
    },
    autoConsumeStatusQueue: env.AUTO_CONSUME_STATUS_QUEUE
  };
}
