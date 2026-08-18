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
 * Is this host locked down? (AGL-1501)
 *
 * The middleware's Firestore proxy: the edge runtime cannot read the host
 * or org docs, so it asks this Node route and memoizes the answer for 30s.
 * Unauthenticated by design — the answer is a boolean about a PUBLIC
 * website's availability, already observable by loading it, and the caller
 * whose sessions a lockdown revoked must still be able to reach the notice.
 * The body carries no actor, no rationale, no target ids.
 *
 * Reads ride the same tagged caches the render path uses (`getHost`,
 * `getOrgBilling`), so the lockdown route's revalidation fan-out — which
 * busts `tenant-data:{hostId}` — makes THIS answer fresh at the same
 * moment it drops the cached pages.
 *
 * Scope note: no `user` scope and no staff bypass here on purpose. A
 * locked HOST is locked for every visitor including staff (this is the
 * public site, not the console), and a visitor's identity plays no part in
 * whether a website serves.
 *
 * ## It also answers `attribution` (AGL-2088)
 *
 * A SECOND boolean rides along on the same response: may this host's
 * responses carry `x-powered-by: Aglyn`? It lives here rather than in a
 * route of its own for one reason — this route already loads the host and
 * the org doc the answer needs, so the middleware pays nothing for it,
 * while a second verdict route would double the edge round trip on every
 * request of every published site to decide a header.
 *
 * Same disclosure posture as `locked`: it is a boolean about a public
 * website, derived from a plan, and the site's own HTML already carries the
 * matching `<meta name="generator">`. Nothing about the org's plan, its
 * identity or its entitlements is in the body.
 *
 * ⚠️ Every early return below answers `attribution: false`. Unknown host,
 * thrown error, missing org — all suppress. `showsPlatformAttribution`
 * enforces the same rule on the org it is handed; these are the branches
 * that never reach it. A verdict route that fails open on THIS field would
 * put the header on a white-labelled site during a Firestore blip.
 */

import {
  lockdownMode,
  lockdownNotice,
  lockdownRetryAfterSeconds,
  normalizeHostLockdown,
  normalizeOrgLockdown,
  resolveLockdown,
  showsPlatformAttribution,
} from '@aglyn/aglyn/server'
import { getPlatformLockdown } from '@aglyn/tenant-data-admin'
import { getHost } from '../../../utils/get-host'
import { getOrgBilling } from '../../../utils/get-org-billing'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const host = url.searchParams.get('host') ?? ''
  if (!host || host.includes('/')) {
    return Response.json({ error: 'Missing host' }, { status: 400 })
  }
  try {
    const hostRes = await getHost({ host })
    if (!hostRes.host) {
      // Unknown host: not locked — the normal 404 flow owns this case. No org,
      // so no attribution either; there is nothing here to fingerprint.
      return Response.json(
        { locked: false, attribution: false },
        { status: 200 },
      )
    }
    const orgRes = await getOrgBilling({ hostId: hostRes.host.$id })
    const attribution = showsPlatformAttribution(orgRes.org)
    const state = resolveLockdown(
      {
        platform: await getPlatformLockdown(),
        org: normalizeOrgLockdown(orgRes.org as never),
        host: normalizeHostLockdown(hostRes.host as never),
      },
      Date.now(),
    )
    if (!state) {
      return Response.json({ locked: false, attribution }, { status: 200 })
    }
    // READ-ONLY (AGL-1511): the site keeps serving. The verdict still says
    // `locked: true` — it is describing the LOCK, not the middleware's
    // action — and reports the mode so the caller decides. Answering
    // `locked: false` instead would have been the shorter change and the
    // wrong one: this route is also how a staff probe and any future reader
    // learns a site is in read-only, and a lock that reports itself as
    // absent is a lock nobody can verify is engaged.
    const notice = lockdownNotice(state)
    const retryAfter = lockdownRetryAfterSeconds(state, Date.now())
    return Response.json(
      {
        locked: true,
        attribution,
        mode: lockdownMode(state),
        reason: state.reason,
        title: notice.title,
        message: notice.body,
        ...(notice.contact ? { contact: notice.contact } : {}),
        ...(typeof state.untilMs === 'number' ? { untilMs: state.untilMs } : {}),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
        },
      },
    )
  } catch (error) {
    console.error('[lockdown-verdict] failed', error)
    // Fail open on the LOCK: the middleware treats any non-locked answer as
    // "serve", because an unreachable verdict is an outage, not a takedown.
    // Fail CLOSED on the attribution, in the same breath and for the opposite
    // reason: serving a site we could not price is recoverable, stamping the
    // platform's name on a site that paid to hide it is not.
    return Response.json(
      { locked: false, attribution: false },
      { status: 200 },
    )
  }
}
