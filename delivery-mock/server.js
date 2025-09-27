const Fastify = require('fastify');
const { customAlphabet } = require('nanoid');

const app = Fastify({ logger: true });
const generateShipmentId = customAlphabet('1234567890abcdef', 16);

app.get('/healthz', async () => ({ status: 'ok' }));

app.post('/v1/shipments', async () => {
  const shipmentId = generateShipmentId();
  return { shipmentId, state: 'CREATED' };
});

const port = parseInt(process.env.PORT ?? '4000', 10);

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info({ port }, 'Delivery mock running');
  })
  .catch((error) => {
    app.log.error({ err: error }, 'Failed to start delivery mock');
    process.exit(1);
  });
