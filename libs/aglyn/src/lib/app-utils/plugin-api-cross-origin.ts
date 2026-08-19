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
 * Same-origin policy for visitor-facing plugin-API WRITES (AGL-1880).
 *
 * Pure and dependency-free, beside `plugin-api-rate-limit` and for the same
 * reason: the dispatcher gate is one line, and the reasoning it encodes is
 * unit-testable without a route harness.
 *
 * ## The hole this closes
 *
 * The standing claim — recorded on 2026-07-24 when CSRF was considered and
 * deliberately NOT added — was that CSRF is *structurally impossible* here
 * because every API route authorizes with `Authorization: Bearer <idToken>`,
 * which a browser never attaches on its own. That claim was audited against
 * the tree on 2026-08-19 and it holds for all 140 console routes. It does not
 * hold for the tenant plugin-API dispatcher, and the exception was never an
 * exception anyone wrote down:
 *
 * - `libs/plugins/commerce/**` handlers authorize by COOKIE, not Bearer —
 *   `aglyn_member_{hostId}` for `membership/account`, `membership/wishlist`,
 *   `membership/logout`, `commerce/stream`, `commerce/subscription-portal`,
 *   and `aglyn_cart_{hostId}` for `commerce/cart`, `commerce/cart-checkout`.
 * - Several of those MUTATE: `membership/account` writes `displayName` and
 *   the address book, `membership/wishlist` writes the wishlist,
 *   `commerce/cart` writes cart lines.
 * - `api-adapter` parses `application/x-www-form-urlencoded` into `req.body`,
 *   and the handlers read `hostId` from `req.body`. That content type is a
 *   CORS-*simple* request, so a cross-origin HTML form POST reaches the
 *   handler with **no preflight** to refuse it.
 *
 * ## Why `SameSite=Lax` is not already the answer
 *
 * It is the only thing standing there today, and it stops the ordinary case:
 * a POST from an unrelated site is cross-SITE, so the cookie is withheld.
 *
 * It does not stop the case this platform creates. Every published tenant
 * lives under `*.aglyn.app`, and sibling subdomains of one registrable domain
 * are same-SITE. `SameSite` is not `SameOrigin`. So a form POST from
 * `evil.aglyn.app` to `victim.aglyn.app/api/membership/account` carries
 * `aglyn_member_victim` in full, and the tenant who authored `evil` is an
 * ordinary customer who signed up. The cookie flag is doing exactly what it
 * documents; it is simply the wrong boundary for a multi-tenant apex.
 *
 * ## The rule
 *
 * A state-changing plugin-API request must be same-ORIGIN. Reads are
 * untouched — a cross-origin GET carries no authority a cross-origin
 * `<img>`/`<script>` did not already have, and the console's preview surface
 * reads these paths legitimately.
 *
 * An ABSENT `Origin` header is allowed, and that is the one judgement call
 * worth stating plainly. CSRF is an attack a browser is tricked into
 * performing, and a browser always sends `Origin` on a cross-origin request
 * — including the form POST above, and including every no-preflight simple
 * request. Absence therefore means a non-browser caller: `curl`, a webhook,
 * the server-to-server `commerce/supplier-update` hop. Refusing those would
 * break real integrations to defend against a client that, by definition,
 * chooses its own headers and would simply omit the one we demanded. Header
 * presence is not a credential — the same reasoning `plugin-api-rate-limit`
 * uses to refuse to exempt on `authorization` being present.
 *
 * A literal `Origin: null` is NOT allowed through. It is an opaque origin —
 * a sandboxed iframe, or a POST that arrived via a redirect — and it is
 * precisely the shape an attacker reaches for once a plain cross-origin POST
 * is refused. `null` is never same-origin with anything, so it fails the
 * comparison rather than needing a special case; the constant exists so the
 * intent is legible.
 */

import { lockdownIntentForMethod } from './lockdown'
import { isMachinePluginApiPath } from './plugin-api-rate-limit'

/**
 * 403, not 401.
 *
 * The caller's credential is fine — that is the whole problem. What is
 * refused is the ORIGIN it came from, and no re-authentication would change
 * the answer, so `401 Unauthorized` (which invites a retry with credentials)
 * would be a lie. Matches how the lockdown gate reasons about 423.
 */
export const CROSS_ORIGIN_REFUSED_STATUS = 403

/** The opaque origin. Never same-origin with anything, including itself. */
const OPAQUE_ORIGIN = 'null'

/** Host of an `Origin` header value, or `''` when it is absent/unparsable. */
function originHost(origin: string | null | undefined): string {
  const raw = String(origin ?? '').trim()
  if (!raw || raw === OPAQUE_ORIGIN) return ''
  try {
    return new URL(raw).host.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * The host this request was actually addressed to.
 *
 * `x-forwarded-host` first: behind Vercel that is the public hostname the
 * visitor typed, while `host` can be the internal one. Falls back to `host`
 * so the function is still correct off-platform (self-host, local dev), which
 * `deployment-shape` makes a supported case rather than a hypothetical.
 */
function requestHost(headers: {
  get?: (name: string) => unknown
}): string {
  const forwarded = String(headers?.get?.('x-forwarded-host') ?? '')
    .split(',')[0]
    ?.trim()
  const host = forwarded || String(headers?.get?.('host') ?? '').trim()
  return host.toLowerCase()
}

export interface CrossOriginWriteOptions {
  /** Dispatcher path, e.g. `commerce/cart`. Decides visitor vs machine. */
  path: string
  /** Read for its method, `origin`, `x-forwarded-host` and `host`. */
  request: { method?: string; headers?: { get?: (name: string) => unknown } }
}

/**
 * Is this a state-changing plugin-API request from another origin?
 *
 * Exported separately from the refusal so the decision can be asserted
 * directly in tests and reused by the console dispatcher without either
 * inheriting a `Response` shape it may not want.
 */
export function isCrossOriginPluginWrite(
  options: CrossOriginWriteOptions,
): boolean {
  if (lockdownIntentForMethod(options?.request?.method) === 'read') return false
  if (isMachinePluginApiPath(options?.path)) return false

  const headers = options?.request?.headers ?? {}
  const origin = headers?.get?.('origin')
  // Absent Origin: a non-browser caller. See the module note — this is the
  // deliberate allowance, not an oversight.
  if (origin === null || origin === undefined || String(origin).trim() === '') {
    return false
  }

  const from = originHost(String(origin))
  const to = requestHost(headers)
  // An unparsable or opaque Origin yields `''`, which can never equal a real
  // host, so it lands here as cross-origin — the intended outcome.
  if (!to) {
    // No host to compare against. Refusing every write on a malformed request
    // would be a worse failure than the one being prevented, and a request
    // with no Host reached no tenant site to begin with.
    return false
  }
  return from !== to
}

/**
 * The refusal a cross-origin plugin write returns, or null to proceed:
 *
 *   const foreign = crossOriginPluginWriteRefusal({ path, request })
 *   if (foreign) return foreign
 *
 * Same "return it or carry on" contract as `visitorWriteRefusal` and
 * `visitorWriteRateLimitRefusal`, so the dispatcher reads as one list of
 * gates rather than three shapes.
 *
 * The body names the reason. Unlike the rate limiter — which is deliberately
 * mute because it faces abusers and every detail is a hint — this refusal is
 * one a legitimate integrator can hit by calling from the wrong host, and a
 * bare 403 would cost them an afternoon. It discloses nothing an attacker did
 * not already know, having chosen the origin themselves.
 */
export function crossOriginPluginWriteRefusal(
  options: CrossOriginWriteOptions,
): Response | null {
  if (!isCrossOriginPluginWrite(options)) return null
  return Response.json(
    { error: 'Cross-origin writes are not allowed.' },
    { status: CROSS_ORIGIN_REFUSED_STATUS },
  )
}
