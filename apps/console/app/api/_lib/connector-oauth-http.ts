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
 * The HTTP edges shared by the unauthenticated connector endpoints
 * (AGL-4225): a per-address budget, the CORS preflight, and the form body.
 *
 * Each budget is per instance and in memory, like `/api/v1`'s pre-auth
 * lookup budget and for the same reason: a durable counter costs a Firestore
 * write, which would make an unauthenticated flood MORE expensive to refuse
 * than to serve. It bounds what one address can make one instance do.
 */
import {
  NO_CLIENT_ADDRESS_BUCKET,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'
import {
  checkRateLimit,
  CONNECTOR_CORS_HEADERS,
  oauthErrorResponse,
  peekRateLimit,
  type RateLimitState,
  readCappedBody,
} from '@aglyn/tenant-data-admin'

export interface ConnectorBudget {
  /** `null` to proceed, or the 429 to return. Spends nothing. */
  refusal(request: Request): Response | null
  /** Count one request (or one failure) against the caller's address. */
  charge(request: Request): void
}

/** A fixed-window budget of `limit` per `windowMs`, per client address. */
export function connectorBudget(name: string, limit: number, windowMs: number): ConnectorBudget {
  const store = new Map<string, RateLimitState>()
  const keyFor = (request: Request) =>
    `${name}:${readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET}`
  return {
    refusal(request) {
      const state = peekRateLimit(keyFor(request), { limit, windowMs, store })
      if (state.allowed) return null
      const retryAfter = Math.max(1, Math.ceil((state.resetMs - Date.now()) / 1000))
      return oauthErrorResponse(429, 'temporarily_unavailable', 'Too many requests from this address', {
        'Retry-After': String(retryAfter),
      })
    },
    charge(request) {
      checkRateLimit(keyFor(request), { limit, windowMs, store })
    },
  }
}

/** The answer to a CORS preflight on a connector endpoint. */
export function connectorPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...CONNECTOR_CORS_HEADERS } })
}

/** A form body read under a cap, with the names that appeared more than once. */
export interface ConnectorForm {
  ok: boolean
  params?: Record<string, string>
  duplicated?: string[]
  /** The refusal to return when `ok` is false. */
  response?: Response
}

/**
 * Read an `application/x-www-form-urlencoded` body (RFC 6749 §3.2), at most
 * `maxBytes`. A parameter sent twice is refused by the caller, never
 * resolved by picking one.
 */
export async function readConnectorForm(request: Request, maxBytes: number): Promise<ConnectorForm> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/x-www-form-urlencoded') {
    return {
      ok: false,
      response: oauthErrorResponse(400, 'invalid_request', 'The body must be application/x-www-form-urlencoded'),
    }
  }
  const body = await readCappedBody(request, maxBytes)
  if (body === null) {
    return { ok: false, response: oauthErrorResponse(413, 'invalid_request', 'The body is too large') }
  }
  const search = new URLSearchParams(body)
  const params: Record<string, string> = {}
  const duplicated: string[] = []
  for (const name of new Set(search.keys())) {
    const values = search.getAll(name)
    if (values.length > 1) duplicated.push(name)
    params[name] = values[0]
  }
  return { ok: true, params, duplicated }
}
