/**
 * Core retry tuning controls exposed to callers. We intentionally keep the API lightweight so it
 * can be reused for other outbound integrations if the service grows.
 */
export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
}

/**
 * Optional callbacks that allow callers to influence retry decisions and gather telemetry.
 */
export interface RetryHandlers {
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Executes the provided async task, retrying on failure according to the supplied options.
 *
 * @param task - Function returning a promise that may need to be retried.
 * @param options - Retry tuning (counts and delays).
 * @param handlers - Hooks for influencing retry eligibility and logging attempts.
 */
export async function executeWithRetry<T>(
  task: () => Promise<T>,
  options: RetryOptions,
  handlers: RetryHandlers = {}
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = options;
  const { shouldRetry = () => true, onRetry } = handlers;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      const delay = computeDelay(baseDelayMs, attempt, maxDelayMs);
      onRetry?.(error, attempt + 1, delay);
      await wait(delay);
    }
  }

  throw new Error('Retry logic reached an unexpected state');
}

function computeDelay(baseDelay: number, attempt: number, maxDelay?: number): number {
  const exponential = baseDelay * 2 ** attempt;
  const jitter = Math.random() * baseDelay;
  const delay = exponential + jitter;
  return Math.min(maxDelay ?? Number.MAX_SAFE_INTEGER, delay);
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
