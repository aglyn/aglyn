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
import { getPlatformLockdown, lockdownJsonResponse } from './lockdown'
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
    const state = resolveLockdown(
      {
        platform,
        org: normalizeOrgLockdown(resolved?.org as never),
        host: normalizeHostLockdown(host as never),
      },
      nowMs,
    )
    return isLockdownActive(state, nowMs) ? state : null
  } catch (error) {
    console.error('[tenant-write-lockdown] verdict failed', hostId, error)
    return null
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
