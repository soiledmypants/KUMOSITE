/** Sleep for `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
}

/**
 * Run `fn`, retrying with exponential backoff + jitter on failure.
 * Every network call in this app should be wrapped in this.
 *
 * @param fn     the async operation to run
 * @param label  short human label for logs
 * @param opts   { retries = 5, baseDelayMs = 500 }
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      // Exponential backoff with full jitter: base * 2^attempt * [0.5, 1.5).
      const delay = Math.round(baseDelayMs * 2 ** attempt * (0.5 + Math.random()));
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[rpc] ${label} failed (attempt ${attempt + 1}/${retries + 1}) — retrying in ${delay}ms: ${message}`,
      );
      await sleep(delay);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[rpc] ${label} failed after ${retries + 1} attempts: ${message}`);
}
