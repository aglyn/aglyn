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
 * The one door every network call goes through (AGL-3634, after AGL-3639's):
 * `fetch`, a timeout, a short in-call retry for a blip, and every failure
 * turned into a {@link ProviderError} whose `kind` decides what happens next.
 *
 * - `auth` — the provider refused the credential (401/403). Retrying cannot
 *   help; the connection waits for the merchant to connect again.
 * - `rate-limit` — 429. Retried in the call when the provider asks for a
 *   short wait; otherwise the run stops and the connection's next attempt is
 *   set to when the provider said to come back.
 * - `transient` — 5xx, a timeout, a dropped connection. Retried in the call,
 *   then the run fails and backs off.
 * - `not-found` — 404: the network has no such thing. A lookup reads it as
 *   "absent"; anything else as a refusal.
 * - `invalid` — any other 4xx: the network read the request and refused
 *   what it said (an address it cannot ship to, a SKU it does not stock).
 *   Sending it again unchanged cannot help.
 *
 * A request that CREATES something is never retried in the call
 * (`retry: false`): a timeout after the network accepted it would send the
 * order twice. Its caller looks the order up by its own reference first.
 *
 * Nothing here logs a request body or a header: both carry a credential or a
 * person's address.
 */

export type ProviderErrorKind = 'auth' | 'rate-limit' | 'transient' | 'invalid' | 'not-found'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly status: number | null
  /** How long the provider asked us to wait, when it said. */
  readonly retryAfterMs: number | null

  constructor(kind: ProviderErrorKind, message: string, options: { status?: number | null; retryAfterMs?: number | null } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.status = options.status ?? null
    this.retryAfterMs = options.retryAfterMs ?? null
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError
}

export interface ProviderHttp {
  fetch: typeof fetch
  /** Waits between in-call retries. Injectable so specs do not sleep. */
  sleep: (ms: number) => Promise<void>
}

export const defaultProviderHttp = (): ProviderHttp => ({
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
})

export interface ProviderRequest {
  /** The provider's name, for messages. */
  provider: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  headers?: Record<string, string>
  /** JSON-encoded unless it is already a string (a form body). */
  body?: unknown
  timeoutMs?: number
  /** `false` for a request that creates something: one attempt, no in-call retry. */
  retry?: boolean
}

/** Attempts for a transient failure or a short rate limit, the first included. */
export const PROVIDER_ATTEMPTS = 3

/** A rate limit asking for longer than this ends the run instead of waiting in it. */
export const IN_CALL_RETRY_AFTER_MAX_MS = 5_000

const DEFAULT_TIMEOUT_MS = 20_000

/** `Retry-After` in seconds or as a date, in ms; `null` when absent or unreadable. */
export function readRetryAfterMs(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000))
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null
}

/** ShipBob's validation shape: `{ errors: { field: ['message'] } }`. */
function firstFieldError(errors: unknown): string | undefined {
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return undefined
  const first = Object.values(errors as Record<string, unknown>)[0]
  return Array.isArray(first) && typeof first[0] === 'string' ? first[0] : undefined
}

/** The network's own words for a refusal, trimmed, from the shapes ShipBob and Amazon use. */
function providerMessage(payload: any, fallback: string): string {
  const candidates = [
    payload?.errors?.[0]?.message,
    firstFieldError(payload?.errors),
    payload?.detail,
    payload?.title,
    payload?.errors?.[0]?.detail,
    payload?.errors?.[0]?.title,
    payload?.error_description,
    payload?.error,
    payload?.message,
  ]
  const found = candidates.find((value) => typeof value === 'string' && value.trim())
  return String(found ?? fallback).trim().slice(0, 300)
}

async function readBody(response: Response): Promise<any> {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 300) }
  }
}

/**
 * Sends one request and answers the parsed JSON body (or `null` for an empty
 * one). Throws a {@link ProviderError} for every failure.
 */
export async function providerRequest(http: ProviderHttp, request: ProviderRequest): Promise<any> {
  let lastError: ProviderError | null = null
  const attempts = request.retry === false ? 1 : PROVIDER_ATTEMPTS
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      const wait = lastError?.retryAfterMs ?? 500 * 2 ** (attempt - 2)
      await http.sleep(wait)
    }
    let response: Response
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    try {
      response = await http.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body:
          request.body === undefined
            ? undefined
            : typeof request.body === 'string'
              ? request.body
              : JSON.stringify(request.body),
        signal: controller.signal,
      })
    } catch {
      lastError = new ProviderError('transient', `${request.provider} could not be reached`)
      continue
    } finally {
      clearTimeout(timer)
    }
    if (response.ok) return readBody(response)
    const payload = await readBody(response)
    const message = providerMessage(payload, `${request.provider} answered ${response.status}`)
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError('auth', `${request.provider} refused the connection: ${message}`, { status: response.status })
    }
    if (response.status === 404) {
      throw new ProviderError('not-found', message, { status: 404 })
    }
    if (response.status === 429) {
      const retryAfterMs = readRetryAfterMs(response.headers.get('retry-after'))
      lastError = new ProviderError('rate-limit', `${request.provider} asked us to slow down`, {
        status: 429,
        retryAfterMs: retryAfterMs ?? 60_000,
      })
      if (attempt < attempts && retryAfterMs !== null && retryAfterMs <= IN_CALL_RETRY_AFTER_MAX_MS) continue
      throw lastError
    }
    if (response.status >= 500) {
      lastError = new ProviderError('transient', `${request.provider} had a problem (${response.status})`, {
        status: response.status,
      })
      continue
    }
    throw new ProviderError('invalid', message, { status: response.status })
  }
  throw lastError ?? new ProviderError('transient', `${request.provider} could not be reached`)
}
