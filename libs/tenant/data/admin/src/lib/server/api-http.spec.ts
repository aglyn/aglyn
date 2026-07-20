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

import {
  ApiErrors,
  apiJson,
  checkRateLimit,
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  listResponse,
  MAX_PAGE_LIMIT,
  parseLimit,
  type RateLimitState,
  rateLimitHeaders,
} from './api-http'

describe('api-http', () => {
  describe('error envelope', () => {
    it('shapes errors as { error: { type, message, code? } } with the right status', async () => {
      const res = ApiErrors.unauthorized()
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({
        error: { type: 'unauthorized', message: 'Invalid or missing API key' },
      })
    })

    it('carries a custom message, code, and headers', async () => {
      const res = ApiErrors.insufficientScope('datasets:write')
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({
        error: {
          type: 'insufficient_scope',
          message: 'Missing the "datasets:write" scope',
          code: 'datasets:write',
        },
      })
    })

    it('rateLimited sets Retry-After (min 1s) and merges headers', () => {
      const res = ApiErrors.rateLimited(-5, { 'X-RateLimit-Remaining': '0' })
      expect(res.status).toBe(429)
      expect(res.headers.get('Retry-After')).toBe('1')
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
    })
  })

  describe('apiJson', () => {
    it('returns 200 JSON by default', async () => {
      const res = apiJson({ ok: true })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    })
  })

  describe('pagination', () => {
    it('clamps and defaults the limit', () => {
      expect(parseLimit(null)).toBe(DEFAULT_PAGE_LIMIT)
      expect(parseLimit('0')).toBe(DEFAULT_PAGE_LIMIT)
      expect(parseLimit('abc')).toBe(DEFAULT_PAGE_LIMIT)
      expect(parseLimit('10')).toBe(10)
      expect(parseLimit('9999')).toBe(MAX_PAGE_LIMIT)
    })

    it('round-trips a cursor and rejects garbage', () => {
      const c = encodeCursor('record_123')
      expect(c).not.toContain('record_123')
      expect(decodeCursor(c)).toBe('record_123')
      expect(decodeCursor(null)).toBeUndefined()
      expect(decodeCursor('')).toBeUndefined()
    })

    it('builds a list envelope with has_more from next_cursor', async () => {
      const withMore = await listResponse([{ id: 1 }], 'cur').json()
      expect(withMore).toEqual({
        object: 'list',
        data: [{ id: 1 }],
        next_cursor: 'cur',
        has_more: true,
      })
      const last = await listResponse([{ id: 2 }], null).json()
      expect(last).toMatchObject({ next_cursor: null, has_more: false })
    })
  })

  describe('rate limiting', () => {
    it('allows up to the limit then blocks within a window', () => {
      const store = new Map<string, RateLimitState>()
      const opts = { limit: 3, windowMs: 1000, now: 1000, store }
      expect(checkRateLimit('k', opts).allowed).toBe(true) // 1
      expect(checkRateLimit('k', opts).allowed).toBe(true) // 2
      const third = checkRateLimit('k', opts)
      expect(third.allowed).toBe(true) // 3
      expect(third.remaining).toBe(0)
      expect(checkRateLimit('k', opts).allowed).toBe(false) // 4 → blocked
    })

    it('resets after the window elapses', () => {
      const store = new Map<string, RateLimitState>()
      expect(
        checkRateLimit('k', { limit: 1, windowMs: 1000, now: 1000, store })
          .allowed,
      ).toBe(true)
      expect(
        checkRateLimit('k', { limit: 1, windowMs: 1000, now: 1500, store })
          .allowed,
      ).toBe(false)
      expect(
        checkRateLimit('k', { limit: 1, windowMs: 1000, now: 2000, store })
          .allowed,
      ).toBe(true)
    })

    it('tracks keys independently', () => {
      const store = new Map<string, RateLimitState>()
      const opts = { limit: 1, windowMs: 1000, now: 1000, store }
      expect(checkRateLimit('a', opts).allowed).toBe(true)
      expect(checkRateLimit('b', opts).allowed).toBe(true)
      expect(checkRateLimit('a', opts).allowed).toBe(false)
    })

    it('emits X-RateLimit-* headers with Reset in epoch seconds', () => {
      const headers = rateLimitHeaders({
        allowed: true,
        limit: 120,
        remaining: 119,
        resetMs: 90_000,
      })
      expect(headers).toEqual({
        'X-RateLimit-Limit': '120',
        'X-RateLimit-Remaining': '119',
        'X-RateLimit-Reset': '90',
      })
    })
  })
})
