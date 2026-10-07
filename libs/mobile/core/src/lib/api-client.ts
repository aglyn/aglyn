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

import { mobileBrandName } from './config'

/*==========================================
 * THE CONSOLE API CLIENT (AGL-3618).
 *
 * A mobile app calls the same console API routes the console itself calls,
 * with the same credential: a Firebase ID token as a bearer. There is no
 * mobile-only route and no privileged path; a route refuses the app exactly
 * when it would refuse the console.
 *
 * Retries: a GET (and any call the caller marks `idempotent`, which a POST is
 * only when it carries an `Idempotency-Key`) is retried on a network error or
 * a 502/503/504, with backoff. A 4xx is an answer, never retried.
 *=========================================*/

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class ConsoleApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ConsoleApiError'
    this.status = status
    this.body = body
  }
}

export interface ConsoleApiClientOptions {
  origin: string
  /** The signed-in user's current ID token; null when signed out. */
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>
  fetch?: FetchLike
  /** Injected for specs. */
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
}

export interface ConsoleRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** A JSON body. */
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  idempotencyKey?: string
  /** Send without a bearer (sign-in-adjacent routes). */
  anonymous?: boolean
  signal?: AbortSignal
}

const RETRYABLE_STATUS = new Set([502, 503, 504])

/** The message a route sent, or a plain one for its status. */
export function consoleErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    for (const key of ['error', 'message']) {
      if (typeof record[key] === 'string' && record[key]) return String(record[key])
    }
  }
  if (status === 401) return 'Your session ended. Sign in again.'
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 404) return 'That was not found.'
  if (status >= 500) return `${mobileBrandName()} could not be reached. Try again in a moment.`
  return 'That did not work. Try again.'
}

export function createConsoleApiClient(options: ConsoleApiClientOptions) {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const origin = options.origin.replace(/\/+$/, '')

  function urlFor(path: string, query?: ConsoleRequest['query']): string {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new Error(`A console API path starts with one "/": ${path}`)
    }
    const params = Object.entries(query ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    return `${origin}${path}${params.length ? `?${params.join('&')}` : ''}`
  }

  async function request<T = unknown>(path: string, init: ConsoleRequest = {}): Promise<T> {
    const method = init.method ?? 'GET'
    const retryable = method === 'GET' || Boolean(init.idempotencyKey)
    let forceRefresh = false
    let lastError: unknown = null
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (!init.anonymous) {
        const token = await options.getIdToken(forceRefresh)
        if (!token) throw new ConsoleApiError('Sign in to continue.', 401, null)
        headers['Authorization'] = `Bearer ${token}`
      }
      if (init.body !== undefined) headers['Content-Type'] = 'application/json'
      if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey
      let response: Response
      try {
        response = await doFetch(urlFor(path, init.query), {
          method,
          headers,
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
          ...(init.signal ? { signal: init.signal } : {}),
        })
      } catch (error) {
        if (init.signal?.aborted) throw error
        lastError = error
        if (!retryable || attempt === maxAttempts) break
        await sleep(400 * 2 ** (attempt - 1))
        continue
      }
      const body = await response.json().catch(() => null)
      if (response.ok) return body as T
      // One forced token refresh on a 401: an ID token can expire between
      // the read and the request, and a fresh one is the whole fix.
      if (response.status === 401 && !init.anonymous && !forceRefresh) {
        forceRefresh = true
        attempt -= 1
        continue
      }
      if (retryable && RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
        await sleep(400 * 2 ** (attempt - 1))
        continue
      }
      throw new ConsoleApiError(consoleErrorMessage(response.status, body), response.status, body)
    }
    throw new ConsoleApiError(
      `${mobileBrandName()} could not be reached. Check the connection and try again.`,
      0,
      lastError instanceof Error ? lastError.message : null,
    )
  }

  return { origin, request, urlFor }
}

export type ConsoleApiClient = ReturnType<typeof createConsoleApiClient>
