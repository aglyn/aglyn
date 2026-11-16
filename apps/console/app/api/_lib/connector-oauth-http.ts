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
 * The HTTP edges shared by the connector endpoints (AGL-4225): the origin
 * they speak for, the auth-origin refusal, a per-address budget, the CORS
 * preflight, the form body, and logging that cannot fail a response.
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
  ApiErrors,
  checkRateLimit,
  CONNECTOR_CORS_HEADERS,
  oauthErrorResponse,
  peekRateLimit,
  type RateLimitState,
  readCappedBody,
} from '@aglyn/tenant-data-admin'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { hostnameOf, WORKSPACE_DOMAIN } from '../../../constants/workspace-domain'

/**
 * The host a request was addressed to, by the same trusted-proxy rule as
 * `plugin-api-cross-origin.ts`: `x-forwarded-host` first (behind Vercel it is
 * the public hostname, set by the edge), then `host`.
 */
function addressedHost(request: Request): string {
  const forwarded = (request.headers.get('x-forwarded-host') ?? '').split(',')[0]?.trim()
  return (forwarded || request.headers.get('host') || new URL(request.url).host).toLowerCase()
}

/** The configured console origin, from `NEXT_PUBLIC_CONSOLE_URL`, or `null`. */
function configuredConsoleOrigin(): string | null {
  const raw = String(process.env.NEXT_PUBLIC_CONSOLE_URL ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * May the origin be read off the request when no console URL is configured?
 * Only where every request is ours to trust: local development and tests,
 * and a Vercel PREVIEW deployment, whose address is a generated host nobody
 * else attaches. A production build never does — any domain attached to the
 * console project (a workspace subdomain, a custom console domain, a link
 * domain) would otherwise become an issuer — and takes the canonical origin
 * every other "where is the console" answer in the product uses.
 */
function mayDeriveOriginFromRequest(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV === 'preview') return true
  return env.NODE_ENV !== 'production'
}

/** The origin connector sign-in speaks for, and whether it is fixed by configuration. */
export interface ConnectorOrigin {
  /** Issuer, resource base, `iss`, and the base every endpoint URL is built on. */
  origin: string
  /**
   * True when the origin is fixed for the deployment — configured, or the
   * canonical console origin — and so is the same for every request: the
   * only case a discovery document may be cached.
   */
  configured: boolean
}

/**
 * THE origin of connector sign-in: one answer for the issuer, the resource,
 * `iss`, the token endpoint's `resource` check and the MCP challenge, so they
 * can never name two different servers.
 *
 * In order:
 *  1. the configured console URL (`NEXT_PUBLIC_CONSOLE_URL`);
 *  2. on a production build, the canonical console origin
 *     (`platformConsoleOrigin`, which is `https://app.aglyn.com` when nothing
 *     is configured) — never a request header;
 *  3. only in local development, tests and a Vercel preview, the host the
 *     request was addressed to, by the trusted-proxy rule above, with the
 *     protocol the proxy reports.
 */
export function connectorOrigin(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): ConnectorOrigin {
  const configured = configuredConsoleOrigin()
  if (configured) return { origin: configured, configured: true }
  if (!mayDeriveOriginFromRequest(env)) return { origin: platformConsoleOrigin(), configured: true }
  const url = new URL(request.url)
  const proto = (request.headers.get('x-forwarded-proto') ?? '').split(',')[0]?.trim().toLowerCase()
  const protocol = proto === 'https' || proto === 'http' ? `${proto}:` : url.protocol
  return { origin: `${protocol}//${addressedHost(request)}`, configured: false }
}

/** Cache header for a discovery document: cacheable only when the origin cannot vary. */
export function discoveryCacheControl(origin: ConnectorOrigin): string {
  return origin.configured ? 'public, max-age=300' : 'no-store'
}

/**
 * 404 on the auth origin (`auth.<workspace domain>`), or `null` to proceed.
 *
 * That host renders the credential prompt and proxies Firebase's helper; it
 * is not the issuer and serves no part of connector sign-in (AGL-3090). The
 * middleware cannot say so for these, because `/api/*` sits outside its
 * matcher, so every connector route — discovery, register, token, revoke,
 * consent and the MCP endpoint — asks here first.
 */
export function refuseOnAuthOrigin(request: Request): Response | null {
  return hostnameOf(addressedHost(request)) === `auth.${WORKSPACE_DOMAIN}` ? ApiErrors.notFound() : null
}

/**
 * Run a write that records something AFTER the response's outcome is
 * decided — an activity entry once tokens are issued, a connection ended —
 * so that it cannot turn that outcome into a 500. A lost log line costs a
 * row in a feed; a 500 after a committed code exchange costs the client its
 * tokens, and its retry then reads as a replay.
 */
export async function recordWithoutFailing(write: () => Promise<unknown>): Promise<void> {
  try {
    await write()
  } catch (error) {
    console.error('connector: a record after the outcome failed', error instanceof Error ? error.name : 'unknown')
  }
}

export interface ConnectorBudget {
  /**
   * `null` to proceed, or the 429 to return. Spends nothing. `within`
   * narrows the bucket below the address — see the token route.
   */
  refusal(request: Request, within?: string): Response | null
  /** Count one request (or one failure) against the caller's address. */
  charge(request: Request, within?: string): void
  /**
   * Take one unit NOW, before the work it pays for, so concurrent requests
   * cannot all pass a check that each would pass alone. `false`, with the
   * unit given back, when the budget was already spent.
   */
  reserve(request: Request, within?: string): boolean
  /** Give back a unit {@link reserve} took, when the work turned out not to need it. */
  refund(request: Request, within?: string): void
}

/**
 * A fixed-window budget of `limit` per `windowMs`, per client address — or
 * per address AND `within`, when the caller names a narrower bucket.
 *
 * The refusal is a 429 with `Retry-After` and `error: "invalid_request"`:
 * RFC 6749 has no rate-limit code, and `invalid_request` is the one every
 * client already handles as "this request was refused, do not retry it
 * as-is"; the status and `Retry-After` carry the rest.
 */
export function connectorBudget(name: string, limit: number, windowMs: number): ConnectorBudget {
  const store = new Map<string, RateLimitState>()
  const keyFor = (request: Request, within?: string) =>
    `${name}:${readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET}${within ? `:${within}` : ''}`
  return {
    refusal(request, within) {
      const state = peekRateLimit(keyFor(request, within), { limit, windowMs, store })
      if (state.allowed) return null
      const retryAfter = Math.max(1, Math.ceil((state.resetMs - Date.now()) / 1000))
      return oauthErrorResponse(429, 'invalid_request', 'Too many requests — retry after the time given', {
        'Retry-After': String(retryAfter),
      })
    },
    charge(request, within) {
      checkRateLimit(keyFor(request, within), { limit, windowMs, store })
    },
    reserve(request, within) {
      const result = checkRateLimit(keyFor(request, within), { limit, windowMs, store })
      if (result.allowed) return true
      this.refund(request, within)
      return false
    },
    refund(request, within) {
      const state = store.get(keyFor(request, within))
      if (state && state.count > 0) state.count -= 1
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
