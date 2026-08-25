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
 * The lockdown gate for VISITOR writes on a customer's live site
 * (AGL-1511) — form submissions, cart changes, checkout.
 *
 * Why this is its own chokepoint rather than the console's. The tenant
 * middleware, which is where AGL-1501 enforces, **does not match `/api`**
 * (see the matcher in apps/tenant/middleware.ts): it exists to stop CACHED
 * PAGES serving. So the site's own write endpoints have had no lockdown
 * enforcement at all — under a full org takedown the pages 503 while a form
 * POST still writes. This closes that for both modes.
 *
 * The product decision this file encodes, from the issue: a visitor-facing
 * write on a read-serving site gets a **polite inline pause, never a
 * page-level 503**. A customer's site staying up and earning is the entire
 * reason read-only mode exists instead of full lockdown, and answering their
 * visitors with an outage page would spend exactly what the mode was
 * protecting. So the refusal is a 423 with visitor copy the block renders
 * inline, and the page around it never stops rendering.
 *
 * Under a FULL lock the same 423 is returned rather than a 503, and that is
 * deliberate too: the middleware has already replaced the whole page for
 * anyone loading it, so a write arriving here is a stale tab or a script,
 * and a machine-readable refusal is more useful to both than an HTML page.
 *
 * NO staff bypass and NO user scope, matching /api/lockdown-verdict: this is
 * a public website, the caller is anonymous, and a visitor's identity plays
 * no part in whether a site accepts an order.
 */

import {
  isLockdownActive,
  lockdownBlocks,
  type LockdownIntent,
  lockdownIntentForMethod,
  type LockdownPausedSurface,
  lockdownPausedNotice,
  type LockdownState,
  normalizeHostLockdown,
  normalizeOrgLockdown,
  resolveLockdown,
} from '@aglyn/aglyn/server'
import {
  getPlatformLockdown,
  heldSiteTakedown,
  lockdownJsonResponse,
  rememberSiteTakedown,
} from './lockdown'
import { getHostDocAdmin, getOrgForHost } from './organizations'

/**
 * The active platform/org/host lockdown for one site, or null.
 *
 * Both reads are already paid by the callers on this path — the dispatcher
 * reads the host doc for its plugin deny-list and the org doc for
 * enablement, and both getters are `React.cache`-deduped per request — so
 * the gate costs one TTL-cached platform read and nothing else.
 *
 * FAIL OPEN on any error, matching every other lockdown reader: an
 * unreachable Firestore is an outage, not a lockdown, and a shop that stops
 * taking orders because a read timed out is a worse failure than the one
 * being guarded against.
 *
 * …EXCEPT for a takedown (AGL-1881, extending AGL-1621). One class of lock
 * inverts that cost function — "the database was down" is not an answer to a
 * court order — and until now the ledger that carries it covered only the
 * four scopes whose lock lives in `lockdowns/*`. Org and host locks live on
 * the org/host document, so the two scopes MOST likely to be carrying a
 * legal order were the two that fell through. Every successful read now
 * records its org and host verdict, and a failed read serves back whichever
 * of them was a takedown and is still active.
 *
 * Note what is NOT done here: the catch does not fail closed on the state it
 * could not read. On a read failure `suspendedEnforcement` is exactly as
 * unreadable as everything else, which is the whole reason a separate
 * durable ledger exists — and a catch that locked unconditionally would take
 * every shop on the platform offline on any transient blip, which is the
 * deliberate posture this keeps for the default case.
 */
export async function getSiteLockdown(
  hostId: string,
  nowMs = Date.now(),
): Promise<LockdownState | null> {
  if (!hostId) return null
  try {
    const [platform, resolved, host] = await Promise.all([
      getPlatformLockdown(),
      getOrgForHost(hostId),
      getHostDocAdmin(hostId),
    ])
    const org = normalizeOrgLockdown(resolved?.org as never)
    const hostState = normalizeHostLockdown(host as never)
    rememberSiteTakedown(hostId, { org, host: hostState })
    const state = resolveLockdown({ platform, org, host: hostState }, nowMs)
    return isLockdownActive(state, nowMs) ? state : null
  } catch (error) {
    console.error('[tenant-write-lockdown] verdict failed', hostId, error)
    const held = heldSiteTakedown(hostId, nowMs)
    // The shipped fail-open answer, returned by the same statement it always
    // was, for every case where nothing takedown-class was ever observed.
    if (!held.org && !held.host) return null
    // The platform read is TTL-cached and swallows its own errors (it carries
    // its own ledger entry), so asking again here costs nothing and keeps a
    // wider lock from being masked by a narrower held one.
    const platform = await getPlatformLockdown().catch(() => null)
    const state = resolveLockdown(
      { platform, org: held.org, host: held.host },
      nowMs,
    )
    return isLockdownActive(state, nowMs) ? state : null
  }
}

/**
 * The refusal a visitor-facing write route returns, or null to proceed:
 *
 *   const paused = await visitorWriteRefusal({ hostId, request, surface })
 *   if (paused) return paused
 *
 * `surface` picks the WORDS only (`lockdownPausedNotice`) — the checkout
 * sentence has to promise no card was charged, and no generic copy can.
 */
export async function visitorWriteRefusal(options: {
  hostId: string
  /** The request whose method decides read vs write. */
  request?: { method?: string } | null
  /** Overrides `request`; `write` when neither is given. */
  intent?: LockdownIntent
  surface: LockdownPausedSurface
  nowMs?: number
}): Promise<Response | null> {
  const nowMs = options.nowMs ?? Date.now()
  const intent =
    options.intent ??
    (options.request ? lockdownIntentForMethod(options.request.method) : 'write')
  // This is a WRITE gate: reads leave before any Firestore read, so the hot
  // unauthenticated GET path pays nothing. A full lock's refusal of tenant
  // API *reads* is not attempted here and is unchanged from today — the
  // middleware owns the page surface, and a read-refusing API gate is its
  // own decision with its own blast radius (filed separately).
  if (intent === 'read') return null
  const state = await getSiteLockdown(options.hostId, nowMs)
  if (!lockdownBlocks(state, intent)) return null
  return lockdownJsonResponse(state as LockdownState, {
    notice: lockdownPausedNotice(options.surface),
  })
}

/**
 * The refusal a visitor-facing route that SERVES SITE CONTENT over `/api`
 * returns under a FULL lock, or null to proceed (AGL-2495):
 *
 *   const down = await visitorContentRefusal({ hostId })
 *   if (down) return down
 *
 * The gap this closes, found by the AGL-1621 drill. The tenant middleware
 * is what takes a locked site off the air, and its matcher deliberately
 * excludes `/api` — so a full org or host takedown 503s every page while an
 * API route that composes and returns screen nodes keeps handing the site's
 * content out to anyone who can name a screen. `visitorWriteRefusal` above
 * cannot answer that: it leaves before any read, by design, because it is a
 * WRITE gate on the hot unauthenticated GET path.
 *
 * FULL locks only, and that is the whole point of it being a separate
 * helper rather than a flag on the write gate. Read-only mode exists so a
 * customer's site keeps serving and earning; refusing reads there would
 * spend exactly what the mode protects. `lockdownBlocks(state, 'read')` is
 * true only when the mode is full, which is precisely the case where the
 * pages are already gone.
 *
 * Deliberately NOT applied to the whole tenant API surface. A read-refusing
 * gate on every route would take the lock notice, the verdict probe and the
 * abuse intake down with the site. This is for the routes that serve the
 * SITE ITSELF — a composed node tree — where continuing to serve is
 * continuing to publish. `serve-media-cdn.ts` made the same call for bytes
 * (AGL-1520); this is the node-tree half of it.
 *
 * Fails OPEN through `getSiteLockdown`, like every other reader here.
 */
export async function visitorContentRefusal(options: {
  hostId: string
  surface?: LockdownPausedSurface
  nowMs?: number
}): Promise<Response | null> {
  const nowMs = options.nowMs ?? Date.now()
  const state = await getSiteLockdown(options.hostId, nowMs)
  if (!lockdownBlocks(state, 'read')) return null
  return lockdownJsonResponse(
    state as LockdownState,
    options.surface ? { notice: lockdownPausedNotice(options.surface) } : undefined,
  )
}
