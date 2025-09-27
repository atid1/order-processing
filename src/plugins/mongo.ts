import fp from 'fastify-plugin';
import { MongoClient } from 'mongodb';

/**
 * Connection parameters supplied when registering the MongoDB Fastify plugin.
 */
export interface MongoPluginOptions {
  uri: string;
  dbName: string;
}

/**
 * Establishes a shared MongoDB client and exposes it via `fastify.mongo`.
 * Centralizing the connection lifecycle here keeps the rest of the codebase focused on
 * business logic; Fastify will automatically invoke the onClose hook during shutdown.
 */
const mongoPlugin = fp(async (fastify, options: MongoPluginOptions) => {
  const client = new MongoClient(options.uri);
  await client.connect();
  const db = client.db(options.dbName);

  fastify.decorate('mongo', { client, db });

  fastify.addHook('onClose', async () => {
    await client.close();
  });
});

export default mongoPlugin;
