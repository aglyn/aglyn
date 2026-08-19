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
  mintEditHintToken,
  verifyEditHintToken,
} from '@aglyn/tenant-data-admin'

export const dynamic = 'force-dynamic'

/**
 * The landing half of the login-time hint bounce (AGL-1842).
 *
 * The console (`app.aglyn.com`) cannot set a `.aglyn.app` cookie — different
 * registrable domain — but a TOP-LEVEL navigation through this route can:
 * the console sends the signed bounce blob here in the URL, this route
 * verifies it, plants the hint cookies first-party on `Domain=.aglyn.app`,
 * and 302s the browser straight back. The whole trip is one redirect flash,
 * paid only by signed-in console editors.
 *
 * Two cookies, two jobs:
 *
 * - `aglyn_editor=1` — the AGL-1829 marker, JS-visible, the exact signal the
 *   admin-bar stub already arms on (`hasEditorHint`); nothing in the stub
 *   changes.
 * - `aglyn_edit_hint=<signed>` — HttpOnly, so no tenant page's scripts (ours
 *   or a site author's) can read it; it travels only to the tenant's own
 *   `/api/edit-access/exchange`, which verifies it server-side and
 *   re-authorizes the uid against the specific host being viewed.
 *
 * The `return` URL is where an open redirect would live, and an open
 * redirect on an `aglyn.app` URL is a phishing primitive — so it is checked
 * against the console-origin allowlist FIRST, and an off-list target is a
 * flat 400: no redirect, no cookies, nothing to launder. A bad or expired
 * `sig`, by contrast, redirects back WITHOUT cookies: the blob lives for
 * seconds, so an editor whose bounce raced its expiry must land back on the
 * console, not on an error page — the next throttle window retries.
 *
 * Serving host: the designated bounce target is `console.aglyn.app`
 * (reserved in `RESERVED_SUBDOMAINS`, so no customer can own it; `/api/*`
 * is outside the tenant middleware's matcher, so tenant resolution never
 * interferes) — but the cookie write itself is gated on the REQUEST host
 * being inside `aglyn.app`, because a bounce arriving on a customer's
 * custom domain must plant nothing there.
 */

/**
 * Where the bounce may send the browser back to: console origins, exactly.
 *
 * Aglyn's two origins are seeded ONLY when this deployment has not named its
 * own (AGL-2176). They used to be unconditional, with the configured origin
 * merely added — so a self-hoster could not remove them, and their tenant
 * runtime kept an open redirect target at a console they do not run. The
 * comment above is explicit that a bounce landing anywhere else "must plant
 * nothing there"; an allowlist an operator cannot narrow is the same idea
 * left half-applied.
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

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const sig = url.searchParams.get('sig')
  const returnUrl = url.searchParams.get('return')

  // The redirect target is validated BEFORE anything else: refusing to
  // forward is the one behaviour that must survive every other branch.
  let destination: URL | null = null
  try {
    destination = returnUrl ? new URL(returnUrl) : null
  } catch {
    destination = null
  }
  if (!destination || !consoleReturnAllowlist().has(destination.origin)) {
    return new Response('Invalid return target', {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const headers = new Headers({
    Location: destination.toString(),
    'Cache-Control': 'no-store',
  })

  // Cookie writes only on our own apex: a bounce that somehow arrives on a
  // customer's custom domain (or anywhere else) forwards and plants nothing.
  const hostname = (request.headers.get('host') ?? '')
    .split(':')[0]
    .toLowerCase()
  // AGL-2121: the configured apex. Pinned to ours, a self-host install both
  // failed this test AND planted `Domain=.aglyn.app` — a domain the operator's
  // browser would reject anyway.
  const onTenantApex =
    hostname === TENANT_APEX || hostname.endsWith(`.${TENANT_APEX}`)
  const onDevHost =
    process.env.NODE_ENV !== 'production' &&
    (hostname === 'localhost' || hostname.endsWith('.localhost'))

  const claims = verifyEditHintToken('bounce', sig)
  if (claims && (onTenantApex || onDevHost)) {
    // Re-mint as the long-lived COOKIE kind — the bounce blob itself must
    // never live past this redirect (kind separation is the replay wall).
    const { token } = mintEditHintToken('cookie', claims.uid)
    const maxAge = Math.floor(EDIT_HINT_COOKIE_TTL_MS / 1000)
    // Dev localhost gets host-only cookies (browsers refuse Domain=localhost);
    // production pins the registrable domain so every tenant subdomain sees
    // the hint.
    const attributes = onTenantApex
      ? `Domain=.${TENANT_APEX}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}`
      : `Path=/; SameSite=Lax; Max-Age=${maxAge}`
    headers.append(
      'Set-Cookie',
      `${EDIT_HINT_COOKIE}=${token}; ${attributes}; HttpOnly`,
    )
    // The stub's arming marker — the same name and value the console sets on
    // `.aglyn.com`/`.aglyn.io` (editor-hint-cookie.component.tsx). NOT
    // HttpOnly: `document.cookie` is its whole consumer surface.
    headers.append('Set-Cookie', `aglyn_editor=1; ${attributes}`)
  }

  return new Response(null, { status: 302, headers })
}
