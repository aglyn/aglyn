/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * One HTTP call to a ledger, with the failures sorted into what the sync
 * engine does about them (AGL-3614).
 *
 * - `auth` — the access token was refused (401). The engine refreshes once;
 *   a refresh that is refused too marks the connection for reconnecting.
 * - `rate-limited` — 429. Retried here after the provider's `Retry-After`
 *   when it is short, and otherwise handed back with the wait.
 * - `transient` — a timeout, a network failure or a 5xx. Retried with
 *   backoff by the engine.
 * - `validation` — any other 4xx: the ledger refused the document itself.
 *   Never retried on its own; the item asks a person.
 */

export type AccountingProviderErrorCode = 'auth' | 'rate-limited' | 'transient' | 'validation' | 'not-found'

export class AccountingProviderError extends Error {
  readonly code: AccountingProviderErrorCode
  readonly status: number
  /** How long the provider asked us to wait, when it said. */
  readonly retryAfterMs: number | null

  constructor(code: AccountingProviderErrorCode, message: string, status = 0, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'AccountingProviderError'
    this.code = code
    this.status = status
    this.retryAfterMs = retryAfterMs
  }

  /** Whether waiting and trying again can change the answer. */
  get retryable(): boolean {
    return this.code === 'rate-limited' || this.code === 'transient'
  }
}

export interface AccountingHttpOptions {
  fetch?: typeof fetch
  /** Test seam for the waits between attempts. */
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  /** Extracts the provider's own sentence from an error body. */
  describeError?: (body: unknown, status: number) => string | null
  /**
   * Waited before every call, so one run stays under the provider's
   * per-minute limit: QuickBooks allows 500 a minute per company, Xero 60.
   */
  pacer?: AccountingPacer
}

/** The longest `Retry-After` honored inside one call; longer waits go back to the queue. */
const MAX_INLINE_RETRY_MS = 10_000
const MAX_INLINE_ATTEMPTS = 3
const DEFAULT_TIMEOUT_MS = 30_000

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Spaces calls at least `minIntervalMs` apart, per key. */
export class AccountingPacer {
  private readonly next = new Map<string, number>()

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  async wait(key: string): Promise<void> {
    const now = this.now()
    const at = Math.max(now, this.next.get(key) ?? 0)
    this.next.set(key, at + this.minIntervalMs)
    if (at > now) await this.sleep(at - now)
  }
}

/** `Retry-After` as milliseconds: seconds or an HTTP date. */
export function retryAfterMs(header: string | null, nowMs = Date.now()): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text.slice(0, 500)
  }
}

/**
 * Calls `url` and answers its parsed JSON, or throws
 * {@link AccountingProviderError}. `pacerKey` names the tenant whose budget
 * the call spends.
 */
export async function accountingRequest<T>(
  url: string,
  init: RequestInit,
  options: AccountingHttpOptions & { pacerKey?: string } = {},
): Promise<T> {
  const fetchImpl = options.fetch ?? fetch
  const sleep = options.sleep ?? defaultSleep
  let lastError: AccountingProviderError | null = null
  for (let attempt = 1; attempt <= MAX_INLINE_ATTEMPTS; attempt += 1) {
    if (options.pacer && options.pacerKey) await options.pacer.wait(options.pacerKey)
    let response: Response
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      lastError = new AccountingProviderError(
        'transient',
        controller.signal.aborted ? 'The ledger did not answer in time.' : 'The ledger could not be reached.',
      )
      void error
      clearTimeout(timer)
      if (attempt < MAX_INLINE_ATTEMPTS) {
        await sleep(500 * attempt)
        continue
      }
      throw lastError
    }
    clearTimeout(timer)
    if (response.ok) {
      if (response.status === 204) return null as T
      return (await readJson(response)) as T
    }
    const body = await readJson(response)
    const described = options.describeError?.(body, response.status) ?? null
    const wait = retryAfterMs(response.headers.get('retry-after'))
    if (response.status === 401) {
      throw new AccountingProviderError('auth', described ?? 'The ledger refused the access token.', 401)
    }
    if (response.status === 429) {
      lastError = new AccountingProviderError(
        'rate-limited',
        described ?? 'The ledger asked us to slow down.',
        429,
        wait ?? 60_000,
      )
      if (attempt < MAX_INLINE_ATTEMPTS && (wait ?? 60_000) <= MAX_INLINE_RETRY_MS) {
        await sleep(wait ?? 1000)
        continue
      }
      throw lastError
    }
    if (response.status >= 500) {
      lastError = new AccountingProviderError(
        'transient',
        described ?? `The ledger failed (${response.status}).`,
        response.status,
        wait,
      )
      if (attempt < MAX_INLINE_ATTEMPTS) {
        await sleep(Math.min(wait ?? 1000 * attempt, MAX_INLINE_RETRY_MS))
        continue
      }
      throw lastError
    }
    if (response.status === 404) {
      throw new AccountingProviderError('not-found', described ?? 'The ledger has no such record.', 404)
    }
    throw new AccountingProviderError(
      'validation',
      described ?? `The ledger refused the request (${response.status}).`,
      response.status,
    )
  }
  throw lastError ?? new AccountingProviderError('transient', 'The ledger could not be reached.')
}

/** `application/x-www-form-urlencoded` from a record, skipping empty values. */
export function formBody(values: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, value)
  }
  return params.toString()
}

/** HTTP Basic credentials for an OAuth client. */
export function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`
}

/** An OAuth token endpoint's answer, read defensively. */
export function readTokenResponse(
  body: unknown,
  nowMs: number,
): { accessToken: string; refreshToken: string; expiresInS: number; refreshExpiresInS: number | null; scope: string } {
  const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const accessToken = typeof data['access_token'] === 'string' ? data['access_token'] : ''
  const refreshToken = typeof data['refresh_token'] === 'string' ? data['refresh_token'] : ''
  if (!accessToken || !refreshToken) {
    throw new AccountingProviderError('validation', 'The ledger answered the token request without tokens.')
  }
  const expiresInS = Number(data['expires_in'])
  const refreshExpiresInS = Number(data['x_refresh_token_expires_in'])
  void nowMs
  return {
    accessToken,
    refreshToken,
    expiresInS: Number.isFinite(expiresInS) && expiresInS > 0 ? expiresInS : 1800,
    refreshExpiresInS: Number.isFinite(refreshExpiresInS) && refreshExpiresInS > 0 ? refreshExpiresInS : null,
    scope: typeof data['scope'] === 'string' ? data['scope'] : '',
  }
}

/** An OAuth error body's code: `invalid_grant`, `invalid_client`, … */
export function oauthErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && typeof (body as Record<string, unknown>)['error'] === 'string') {
    return String((body as Record<string, unknown>)['error'])
  }
  return null
}
