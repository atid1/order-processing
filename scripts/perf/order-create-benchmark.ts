import autocannon, { type Options } from 'autocannon';
import { randomUUID } from 'crypto';

// Quick-and-dirty perf harness to stress the order-create endpoint with unique idempotency keys.

// Prefer sane defaults when env vars are missing or invalid.
function parseNumberEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

async function main() {
  const target = process.env.PERF_TARGET ?? 'http://localhost:3000';
  const path = process.env.PERF_PATH ?? '/v1/orders';
  const connections = parseNumberEnv('PERF_CONNECTIONS', 25);
  const duration = parseNumberEnv('PERF_DURATION', 30);
  const pipelining = parseNumberEnv('PERF_PIPELINING', 1);

  // Static payload keeps the benchmark deterministic apart from quantity/amount overrides.
  const payload = JSON.stringify({
    customerId: process.env.PERF_CUSTOMER_ID ?? 'perf-customer',
    totalAmount: Number.parseFloat(process.env.PERF_TOTAL_AMOUNT ?? '199.99'),
    items: [
      {
        sku: process.env.PERF_SKU ?? 'widget',
        qty: parseNumberEnv('PERF_QTY', 1)
      }
    ]
  });

  const baseHeaders = {
    'content-type': 'application/json'
  } satisfies Record<string, string>;

  // Configure a single POST request template that autocannon will replay at load.
  const options: Options = {
    url: target,
    duration,
    connections,
    pipelining,
    requests: [
      {
        method: 'POST',
        path,
        headers: baseHeaders,
        body: payload,
        // Inject a unique Idempotency-Key per request so the service treats each run as new.
        setupRequest: (request) => ({
          ...request,
          headers: {
            ...request.headers,
            'idempotency-key': `perf-${randomUUID()}`
          }
        })
      }
    ]
  };

  console.log('Running order create benchmark with options:', {
    target: options.url,
    connections,
    duration,
    pipelining
  });

  await new Promise<void>((resolve, reject) => {
    const instance = autocannon(options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      autocannon.printResult(result, {
        renderLatencyTable: true
      });
      resolve();
    });

    process.once('SIGINT', () => {
      console.log('\nAborting benchmark...');
      instance.stop();
    });

    autocannon.track(instance, {
      renderProgressBar: true,
      renderResultsTable: false
    });
  });
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exitCode = 1;
});
