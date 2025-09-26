// Thin process entry point that wires configuration into the HTTP stack and gets out of the way.
import { buildApp } from './app';
import { loadConfig } from './config/env';

/**
 * Bootstraps the Fastify application using environment-derived configuration and begins
 * listening for requests. Kept minimal so that alternative entry points (tests, CLI tools)
 * can reuse `buildApp` without dragging along process lifecycle management.
 */
async function start() {
  const config = loadConfig();
  const app = await buildApp(config);

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info('Sales service started');
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start Sales service');
    process.exit(1);
  }
}

void start();
