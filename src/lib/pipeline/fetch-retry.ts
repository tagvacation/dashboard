/**
 * Shared fetch wrapper with retry on transient network errors.
 *
 * Handles the Node/undici "terminated" error that happens when a long-lived
 * fetch gets the connection dropped — common with Vertex AI, Cloud TTS,
 * Gemini when Next.js dev server hot-reloads or network blips.
 */

const TRANSIENT_PATTERNS = [
  'terminated',
  'fetch failed',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'aborted',
  'socket hang up',
]

function isTransientError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return TRANSIENT_PATTERNS.some(p => msg.includes(p))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface FetchRetryOptions {
  retries?: number       // total attempts (default 3)
  timeoutMs?: number     // per-attempt timeout via AbortSignal (default 60_000)
  retryOn?: number[]     // HTTP status codes to also retry (default [429, 500, 502, 503, 504])
  label?: string         // for log messages
  backoffMs?: number     // base backoff (default 3000) — actual wait = base * attempt
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const {
    retries = 3,
    timeoutMs = 60_000,
    retryOn = [429, 500, 502, 503, 504],
    label = 'fetch',
    backoffMs = 3000,
  } = opts

  let lastErr: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: init.signal || AbortSignal.timeout(timeoutMs),
      })
      if (retryOn.includes(res.status) && attempt < retries) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '0')
        const wait = retryAfter > 0 ? retryAfter * 1000 : attempt * backoffMs
        console.warn(`[${label}] ${res.status} (attempt ${attempt}). Retrying in ${wait / 1000}s...`)
        await sleep(wait)
        continue
      }
      return res
    } catch (e) {
      lastErr = e
      if (!isTransientError(e) || attempt === retries) throw e
      const wait = attempt * backoffMs
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[${label}] transient error attempt ${attempt}: ${msg.slice(0, 100)}. Retrying in ${wait / 1000}s...`)
      await sleep(wait)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
