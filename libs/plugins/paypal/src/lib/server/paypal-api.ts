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

import type { PayPalConfig } from './config'

/**
 * PayPal's REST API over `fetch` alone (AGL-3630) — no SDK, so nothing new
 * egresses from the dependency closure.
 *
 * - The platform's access token (client credentials) is cached until a
 *   minute before PayPal says it expires, and fetched again once on a 401.
 * - Every call carries the partner's BN code in
 *   `PayPal-Partner-Attribution-Id`, which is how PayPal attributes the
 *   partner's volume and recognizes the multiparty integration.
 * - A money-moving POST carries `PayPal-Request-Id`: PayPal answers a
 *   repeated id with the FIRST call's result rather than acting twice.
 * - A call made for a seller — a refund — carries `PayPal-Auth-Assertion`,
 *   the unsigned JWT PayPal's third-party model asks for, naming the
 *   seller's merchant id.
 */

export type PayPalFetch = (url: string, init: RequestInit) => Promise<Response>

let fetchOverride: PayPalFetch | null = null

/** Test seam: every PayPal call goes through this instead of `fetch`. */
export function setPayPalFetchForTests(fetchImpl: PayPalFetch | null): void {
  fetchOverride = fetchImpl
  tokens.clear()
}

const tokens = new Map<string, { token: string; expiresAtMs: number }>()

export interface PayPalResponse<T = any> {
  ok: boolean
  status: number
  body: T
  /** PayPal's correlation id, for a support ticket. */
  debugId: string | null
}

export interface PayPalRequest {
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  body?: unknown
  /** `PayPal-Request-Id`: the idempotency key of a money-moving call. */
  requestId?: string
  /** The seller this call acts for (`PayPal-Auth-Assertion`). */
  sellerMerchantId?: string
  /** `Prefer: return=representation`, so a create answers the whole object. */
  representation?: boolean
  signal?: AbortSignal
}

const send = (url: string, init: RequestInit): Promise<Response> => (fetchOverride ?? fetch)(url, init)

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** PayPal's auth assertion: `alg: none`, the partner's client id and the seller's merchant id. */
export function payPalAuthAssertion(clientId: string, sellerMerchantId: string): string {
  return `${base64Url(JSON.stringify({ alg: 'none' }))}.${base64Url(
    JSON.stringify({ iss: clientId, payer_id: sellerMerchantId }),
  )}.`
}

async function accessToken(config: PayPalConfig, signal?: AbortSignal, fresh = false): Promise<string> {
  const key = `${config.apiBase}|${config.clientId}`
  const cached = tokens.get(key)
  if (!fresh && cached && cached.expiresAtMs > Date.now()) return cached.token
  const response = await send(`${config.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
    ...(signal ? { signal } : {}),
  })
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number }
  if (!response.ok || !body.access_token) {
    tokens.delete(key)
    throw new PayPalApiError(response.status, 'AUTHENTICATION_FAILURE', 'PayPal refused the platform credentials', null)
  }
  const lifeMs = Math.max(0, Number(body.expires_in ?? 0) * 1000 - 60_000)
  tokens.set(key, { token: body.access_token, expiresAtMs: Date.now() + lifeMs })
  return body.access_token
}

/** One call to PayPal's REST API. Never throws for a PayPal refusal; a network failure throws. */
export async function payPalRequest<T = any>(config: PayPalConfig, request: PayPalRequest): Promise<PayPalResponse<T>> {
  const attempt = async (fresh: boolean): Promise<Response> => {
    const token = await accessToken(config, request.signal, fresh)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'PayPal-Partner-Attribution-Id': config.attributionId,
    }
    if (request.body !== undefined) headers['Content-Type'] = 'application/json'
    if (request.requestId) headers['PayPal-Request-Id'] = request.requestId
    if (request.sellerMerchantId) {
      headers['PayPal-Auth-Assertion'] = payPalAuthAssertion(config.clientId, request.sellerMerchantId)
    }
    if (request.representation) headers['Prefer'] = 'return=representation'
    return send(`${config.apiBase}${request.path}`, {
      method: request.method,
      headers,
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    })
  }
  let response = await attempt(false)
  // A token PayPal revoked early: fetch a new one, once.
  if (response.status === 401) response = await attempt(true)
  const text = await response.text().catch(() => '')
  let body: any = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { message: text.slice(0, 200) }
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    body: body as T,
    debugId: response.headers.get('paypal-debug-id') ?? (typeof body?.debug_id === 'string' ? body.debug_id : null),
  }
}

/** The first issue PayPal named — `INSTRUMENT_DECLINED`, `ORDER_ALREADY_CAPTURED` — or its error name. */
export function payPalIssue(body: unknown): string {
  const object = body as { details?: Array<{ issue?: unknown }>; name?: unknown } | null
  return String(object?.details?.[0]?.issue ?? object?.name ?? '')
}

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly issue: string,
    message: string,
    readonly debugId: string | null,
  ) {
    super(message)
    this.name = 'PayPalApiError'
  }
}

/** Throws a {@link PayPalApiError} for a refusal; answers the body otherwise. */
export function payPalOk<T>(response: PayPalResponse<T>, what: string): T {
  if (response.ok) return response.body
  const issue = payPalIssue(response.body)
  throw new PayPalApiError(
    response.status,
    issue,
    `PayPal refused to ${what} (${response.status}${issue ? ` ${issue}` : ''}${
      response.debugId ? `, debug id ${response.debugId}` : ''
    })`,
    response.debugId,
  )
}
