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
 * HTTP building blocks for the customer REST API (`/api/v1`, AGL-617): a
 * consistent JSON error envelope, list/pagination helpers, and a per-key
 * rate limiter. Everything here is pure (Web `Response` + plain data), so it
 * is unit-tested directly.
 */

/** Every error response is `{ error: { type, message, code? } }`. */
export interface ApiErrorBody {
  error: { type: string; message: string; code?: string }
}

export interface ApiResponseInit {
  message?: string
  code?: string
  headers?: Record<string, string>
}

function errorResponse(
  status: number,
  type: string,
  fallbackMessage: string,
  init?: ApiResponseInit,
): Response {
  const error: ApiErrorBody['error'] = {
    type,
    message: init?.message ?? fallbackMessage,
  }
  if (init?.code) error.code = init.code
  return Response.json({ error }, { status, headers: init?.headers })
}

/** Canonical error responses. Pass `{ headers }` to carry rate-limit headers. */
export const ApiErrors = {
  unauthorized: (init?: ApiResponseInit) =>
    errorResponse(401, 'unauthorized', 'Invalid or missing API key', init),
  planRequired: (init?: ApiResponseInit) =>
    errorResponse(
      403,
      'plan_required',
      'API access requires the Business plan',
      init,
    ),
  insufficientScope: (scope: string, headers?: Record<string, string>) =>
    errorResponse(403, 'insufficient_scope', `Missing the "${scope}" scope`, {
      code: scope,
      headers,
    }),
  forbidden: (init?: ApiResponseInit) =>
    errorResponse(403, 'forbidden', 'Not permitted', init),
  notFound: (init?: ApiResponseInit) =>
    errorResponse(404, 'not_found', 'Not found', init),
  badRequest: (init?: ApiResponseInit) =>
    errorResponse(400, 'bad_request', 'Bad request', init),
  methodNotAllowed: (init?: ApiResponseInit) =>
    errorResponse(405, 'method_not_allowed', 'Method not allowed', init),
  rateLimited: (retryAfterSec: number, headers?: Record<string, string>) =>
    errorResponse(429, 'rate_limited', 'Too many requests', {
      headers: { 'Retry-After': String(Math.max(1, retryAfterSec)), ...headers },
    }),
  internal: (init?: ApiResponseInit) =>
    errorResponse(500, 'internal_error', 'Something went wrong', init),
}

/** Success JSON with an optional status + headers (e.g. rate-limit headers). */
export function apiJson(
  data: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return Response.json(data, {
    status: init?.status ?? 200,
    headers: init?.headers,
  })
}

// ── Pagination ──────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_LIMIT = 25
export const MAX_PAGE_LIMIT = 100

/** Clamp a `?limit=` value to [1, MAX], defaulting when absent/invalid. */
export function parseLimit(raw: string | null | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_LIMIT
  return Math.min(Math.floor(n), MAX_PAGE_LIMIT)
}

/** Opaque cursor = base64url of an underlying key (e.g. a Firestore doc id). */
export function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

export function decodeCursor(
  cursor: string | null | undefined,
): string | undefined {
  if (!cursor) return undefined
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    return decoded.length > 0 ? decoded : undefined
  } catch {
    return undefined
  }
}

/** List envelope: `{ data, next_cursor, has_more }`. */
export function listResponse(
  data: unknown[],
  nextCursor: string | null,
  headers?: Record<string, string>,
): Response {
  return apiJson(
    { object: 'list', data, next_cursor: nextCursor, has_more: nextCursor != null },
    { headers },
  )
}

// ── Rate limiting (fixed window, per key) ───────────────────────────────────

export interface RateLimitState {
  count: number
  windowStartMs: number
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetMs: number
}

export interface RateLimitOptions {
  limit?: number
  windowMs?: number
  now?: number
  store?: Map<string, RateLimitState>
}

export const DEFAULT_RATE_LIMIT = 120
export const DEFAULT_RATE_WINDOW_MS = 60_000

// Per-instance store. Serverless instances are ephemeral, so this blunts
// bursts rather than enforcing a global cap (matches the app's other
// limiters); a durable per-key counter can back it later.
const defaultStore = new Map<string, RateLimitState>()

/** Count one request against `key`'s fixed window. `now`/`store` injectable. */
export function checkRateLimit(
  key: string,
  options?: RateLimitOptions,
): RateLimitResult {
  const limit = options?.limit ?? DEFAULT_RATE_LIMIT
  const windowMs = options?.windowMs ?? DEFAULT_RATE_WINDOW_MS
  const now = options?.now ?? Date.now()
  const store = options?.store ?? defaultStore

  const state = store.get(key)
  if (!state || now - state.windowStartMs >= windowMs) {
    store.set(key, { count: 1, windowStartMs: now })
    return { allowed: true, limit, remaining: limit - 1, resetMs: now + windowMs }
  }
  state.count += 1
  return {
    allowed: state.count <= limit,
    limit,
    remaining: Math.max(0, limit - state.count),
    resetMs: state.windowStartMs + windowMs,
  }
}

/** Standard `X-RateLimit-*` headers (Reset is epoch seconds). */
export function rateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetMs / 1000)),
  }
}
