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

import { TENANT_APEX } from '@aglyn/aglyn/server'
import {
  EDIT_HINT_COOKIE,
  EDIT_HINT_COOKIE_TTL_MS,
} from '@aglyn/tenant-data-admin'

/**
 * The ONE place the tenant app writes the `.aglyn.app` editor-presence hint
 * cookies (AGL-1842): planted by `/api/edit-hint/set`, cleared by
 * `/api/edit-hint/clear` at console sign-out, and cleared by the exchange and
 * `/api/edit-context` when they refuse a hint or token that a sign-out ended.
 * One writer means one set of attributes: a clear only deletes a cookie whose
 * Domain and Path it matches exactly, so the clearing half cannot be allowed
 * to drift from the planting half.
 *
 * Two cookies, two jobs:
 *
 * - `aglyn_editor=1`: the AGL-1829 marker, JS-visible, the exact signal the
 *   admin-bar stub arms on (`hasEditorHint`).
 * - `aglyn_edit_hint=<signed>`: HttpOnly, so no tenant page's scripts (ours
 *   or a site author's) can read it; it travels only to the tenant's own
 *   `/api/edit-access/exchange`.
 */

/** Where this request may write the hint pair, or null for nowhere. */
function hintCookieScope(request: Request): 'apex' | 'dev' | null {
  const hostname = (request.headers.get('host') ?? '')
    .split(':')[0]
    .toLowerCase()
  // AGL-2121: the configured apex. Pinned to ours, a self-host install both
  // failed this test AND planted `Domain=.aglyn.app`, a domain the operator's
  // browser would reject anyway. A customer's custom domain gets nothing: the
  // hint was never planted there, and a write would only add a cookie.
  if (hostname === TENANT_APEX || hostname.endsWith(`.${TENANT_APEX}`)) {
    return 'apex'
  }
  if (
    process.env.NODE_ENV !== 'production' &&
    (hostname === 'localhost' || hostname.endsWith('.localhost'))
  ) {
    return 'dev'
  }
  return null
}

function attributes(scope: 'apex' | 'dev', maxAgeSeconds: number): string {
  // Dev localhost gets host-only cookies (browsers refuse Domain=localhost);
  // production pins the registrable domain so every tenant subdomain sees
  // the hint.
  return scope === 'apex'
    ? `Domain=.${TENANT_APEX}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
    : `Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

/**
 * Plants the hint pair on `headers`. Returns false, writing nothing, when the
 * request did not arrive on the tenant apex (or a dev host).
 */
export function plantEditHintCookies(
  headers: Headers,
  request: Request,
  hintToken: string,
): boolean {
  const scope = hintCookieScope(request)
  if (!scope) return false
  const maxAge = Math.floor(EDIT_HINT_COOKIE_TTL_MS / 1000)
  headers.append(
    'Set-Cookie',
    `${EDIT_HINT_COOKIE}=${hintToken}; ${attributes(scope, maxAge)}; HttpOnly`,
  )
  // The stub's arming marker: the same name and value the console sets on
  // `.aglyn.com`/`.aglyn.io` (editor-hint-cookie.component.tsx). NOT
  // HttpOnly: `document.cookie` is its whole consumer surface.
  headers.append('Set-Cookie', `aglyn_editor=1; ${attributes(scope, maxAge)}`)
  return true
}

/**
 * Deletes the hint pair through `headers`: the same names, Domain and Path,
 * with `Max-Age=0`. Returns false, writing nothing, off the tenant apex.
 */
export function clearEditHintCookies(
  headers: Headers,
  request: Request,
): boolean {
  const scope = hintCookieScope(request)
  if (!scope) return false
  headers.append(
    'Set-Cookie',
    `${EDIT_HINT_COOKIE}=; ${attributes(scope, 0)}; HttpOnly`,
  )
  headers.append('Set-Cookie', `aglyn_editor=; ${attributes(scope, 0)}`)
  return true
}

/**
 * Where a hint bounce (`set` at sign-in, `clear` at sign-out) may send the
 * browser back to: console origins, exactly.
 *
 * Aglyn's two origins are seeded ONLY when this deployment has not named its
 * own (AGL-2176). They used to be unconditional, with the configured origin
 * merely added, so a self-hoster could not remove them, and their tenant
 * runtime kept an open redirect target at a console they do not run.
 */
function consoleReturnAllowlist(): Set<string> {
  const origins = new Set<string>()
  const configured = process.env.NEXT_PUBLIC_CONSOLE_URL
  if (configured) {
    try {
      origins.add(new URL(configured).origin)
    } catch {
      // A malformed env var must not widen or break the list.
    }
  }
  // Nothing configured: fall back to Aglyn's own console origins, so our
  // deployment is unchanged by this. A deployment that HAS named its console
  // gets exactly that one and nothing else.
  if (!origins.size) {
    origins.add('https://app.aglyn.com')
    origins.add('https://app.aglyn.io')
  }
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:4200')
  }
  return origins
}

/**
 * Is this a console origin, INCLUDING a workspace subdomain?
 *
 * A workspace is reachable at its own subdomain of the console apex
 * (AGL-627): `acme.aglyn.com` serves the console with the org already named.
 * A person working there had their once-a-day bounce refused and landed on a
 * bare `Invalid return target` while only `app.` origins were on the list.
 *
 * ⚠️ This must stay a SUBDOMAIN test against a known console apex, never a
 * suffix test. `endsWith('aglyn.com')` also matches `evil-aglyn.com`, and the
 * thing being guarded is an open redirect on an `aglyn.app` URL, a phishing
 * primitive. Same scheme, same port, one extra label: that is the whole
 * widening.
 *
 * A console on a CUSTOM domain is deliberately still refused. Proving one
 * would mean asking the console's `console-domain-verdict` endpoint on every
 * bounce, and an allowlist that makes a network call is one that fails open
 * the day that call times out.
 */
export function isConsoleReturnOrigin(destination: URL): boolean {
  const allowed = consoleReturnAllowlist()
  if (allowed.has(destination.origin)) return true
  return [...allowed].some((entry) => {
    let apex: URL
    try {
      apex = new URL(entry)
    } catch {
      return false
    }
    if (apex.protocol !== destination.protocol) return false
    if (apex.port !== destination.port) return false
    // `app.aglyn.com` → `aglyn.com`; a workspace subdomain is one label on
    // the front of that, and nothing deeper.
    const parts = apex.hostname.split('.')
    if (parts.length < 3) return false
    const base = parts.slice(1).join('.')
    const host = destination.hostname
    if (!host.endsWith(`.${base}`)) return false
    return host.slice(0, -(base.length + 1)).split('.').length === 1
  })
}

/**
 * The validated `return` of a bounce request, or null when it is missing,
 * unparsable or off the console allowlist. The caller answers null with a
 * flat 400: no redirect and no cookies, nothing to launder.
 */
export function consoleReturnTarget(request: Request): URL | null {
  const returnUrl = new URL(request.url).searchParams.get('return')
  let destination: URL | null
  try {
    destination = returnUrl ? new URL(returnUrl) : null
  } catch {
    destination = null
  }
  return destination && isConsoleReturnOrigin(destination) ? destination : null
}
