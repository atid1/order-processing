declare module 'ioredis' {
  interface RedisOptions {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    db?: number;
    tls?: Record<string, unknown>;
  }

  class Redis {
    constructor(options?: RedisOptions);
    quit(): Promise<void>;
  }

  export = Redis;
}
