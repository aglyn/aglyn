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
 * Google's and Meta's endpoints as the connection specs need them, answered
 * in process (AGL-3637, phase 2): every call recorded, nothing leaves the
 * machine. The plaintext tokens carry `PLAINTEXT` so a spec can assert no
 * stored document holds one.
 */

export interface RecordedCall {
  url: URL
  method: string
  /** The parsed body: JSON, or the form's fields. */
  body: Record<string, unknown> | null
  headers: Record<string, string>
}

export interface ProviderFakeOptions {
  /** Offer ids Google refuses on insert. */
  googleRefuses: Set<string>
  /** How many times each insert answers 503 before it succeeds. */
  googleThrottles: number
  /** Retailer ids Meta answers a validation error for. */
  metaRefuses: Set<string>
  /** Meta's `items_batch` answers 500 for every call. */
  metaDown: boolean
}

export const GOOGLE_REFRESH_TOKEN = 'g-refresh-PLAINTEXT'
export const META_LONG_TOKEN = 'meta-long-PLAINTEXT'

export function createProviderFake(overrides: Partial<ProviderFakeOptions> = {}) {
  const options: ProviderFakeOptions = {
    googleRefuses: new Set(),
    googleThrottles: 0,
    metaRefuses: new Set(),
    metaDown: false,
    ...overrides,
  }
  const calls: RecordedCall[] = []
  const throttled = new Map<string, number>()

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const parse = (init: RequestInit | undefined): Record<string, unknown> | null => {
    if (!init?.body) return null
    const text = String(init.body)
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return Object.fromEntries(new URLSearchParams(text).entries())
    }
  }

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = String(init?.method ?? 'GET')
    const body = parse(init)
    calls.push({ url, method, body, headers: { ...((init?.headers as Record<string, string>) ?? {}) } })
    const path = url.pathname

    if (url.host === 'oauth2.googleapis.com' && path === '/token') {
      if (body?.['grant_type'] === 'authorization_code') {
        return json(200, { access_token: 'g-access', refresh_token: GOOGLE_REFRESH_TOKEN, expires_in: 3599 })
      }
      return json(200, { access_token: 'g-access-2', expires_in: 3599 })
    }
    if (url.host === 'oauth2.googleapis.com' && path === '/revoke') return json(200, {})
    if (url.host === 'merchantapi.googleapis.com') {
      if (path === '/accounts/v1/accounts') {
        return json(200, {
          accounts: [
            { name: 'accounts/111', accountId: '111', accountName: 'Candle Co US' },
            { name: 'accounts/222', accountId: '222', accountName: 'Candle Co CA' },
          ],
        })
      }
      if (/^\/datasources\/v1\/accounts\/\d+\/dataSources$/.test(path) && method === 'POST') {
        const account = path.split('/')[4]
        return json(200, { name: `accounts/${account}/dataSources/999` })
      }
      if (path.endsWith('/productInputs:insert')) {
        const offerId = String(body?.['offerId'] ?? '')
        const seen = throttled.get(offerId) ?? 0
        if (seen < options.googleThrottles) {
          throttled.set(offerId, seen + 1)
          return json(503, { error: { message: 'Backend unavailable' } })
        }
        if (options.googleRefuses.has(offerId)) return json(400, { error: { message: 'Invalid GTIN value' } })
        return json(200, { name: `accounts/111/productInputs/x`, offerId })
      }
      if (path.includes('/productInputs/') && method === 'DELETE') return json(200, {})
    }
    if (url.host === 'graph.facebook.com') {
      if (path.endsWith('/oauth/access_token')) {
        if (url.searchParams.get('grant_type') === 'fb_exchange_token') {
          return json(200, { access_token: META_LONG_TOKEN, token_type: 'bearer', expires_in: 60 * 24 * 60 * 60 })
        }
        return json(200, { access_token: 'meta-short', token_type: 'bearer', expires_in: 3600 })
      }
      if (path.endsWith('/me/businesses')) return json(200, { data: [{ id: '77', name: 'Candle Biz' }] })
      if (path.endsWith('/77/owned_product_catalogs')) return json(200, { data: [{ id: '88', name: 'Main catalog' }] })
      if (path.endsWith('/items_batch')) {
        if (options.metaDown) return json(500, { error: { message: 'Service temporarily unavailable' } })
        const requests = JSON.parse(String(body?.['requests'] ?? '[]')) as Array<{ data: { id: string } }>
        return json(200, {
          handles: ['handle-1'],
          validation_status: requests
            .filter((request) => options.metaRefuses.has(request.data.id))
            .map((request) => ({
              retailer_id: request.data.id,
              errors: [{ message: 'Missing or invalid field: price' }],
              warnings: [],
            })),
        })
      }
      if (path.endsWith('/me/permissions') && method === 'DELETE') return json(200, { success: true })
    }
    return json(404, { error: { message: `No fake for ${method} ${url.href}` } })
  }) as typeof globalThis.fetch

  return { fetch: fakeFetch, calls, options }
}
