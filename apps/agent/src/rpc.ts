// exponential backoff + full jitter around every network call (memedex pattern)
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const cap = baseDelayMs * 2 ** attempt;
      const delay = Math.floor(Math.random() * cap);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`${label} failed after ${retries + 1} attempts: ${String(lastErr)}`);
}
