import { createHash } from 'crypto';

type JsonPrimitive = string | number | boolean | null;

type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

type JsonObject = { [key: string]: JsonValue };

/**
 * Deterministically serializes a JSON-like structure so that semantically equivalent objects
 * (irrespective of property ordering) yield the same string. This allows us to hash request
 * payloads and reliably detect mismatched replays across process restarts.
 */
function stableSerialize(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => stableSerialize(item as JsonValue));
    return `[${items.join(',')}]`;
  }

  const entries = Object.entries(value as JsonObject).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const serialized = entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableSerialize(val as JsonValue)}`)
    .join(',');
  return `{${serialized}}`;
}

/**
 * Produces a SHA-256 digest of an incoming payload. The hashing step powers the idempotency
 * check in `OrderService.createOrder`, ensuring clients cannot reuse an Idempotency-Key with
 * a different request body without triggering a conflict.
 */
export function hashPayload(payload: unknown): string {
  const serialized = stableSerialize(payload as JsonValue);
  return createHash('sha256').update(serialized).digest('hex');
}
