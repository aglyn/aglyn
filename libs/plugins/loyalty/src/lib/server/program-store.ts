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

import { normalizeLoyaltyProgram, type LoyaltyProgram } from '../model/loyalty-program'
import { loyaltyRefs } from './db'
import { resolveLoyaltySite, type LoyaltySiteContext } from './site-context'

/**
 * A store's program as the server runs it (AGL-3640). Every reader goes
 * through {@link normalizeLoyaltyProgram}, so a missing document is the
 * default program: off.
 */

export async function readLoyaltyProgram(orgId: string, hostId: string): Promise<LoyaltyProgram> {
  const snapshot = await loyaltyRefs.program(orgId, hostId).get()
  return normalizeLoyaltyProgram(snapshot.exists ? snapshot.data() : null)
}

/** A site loyalty runs on, with its program, or `null`. */
export interface LoyaltyStore {
  site: LoyaltySiteContext
  program: LoyaltyProgram
}

export async function resolveLoyaltyStore(hostId: string): Promise<LoyaltyStore | null> {
  const site = await resolveLoyaltySite(hostId)
  if (!site) return null
  return { site, program: await readLoyaltyProgram(site.orgId, hostId) }
}

/**
 * Whether a site's program is on, remembered for a short while. Asked on
 * every cart a shopper opens — whether to draw the rewards field — where a
 * read per page view would cost more than the answer is worth; a merchant
 * who just switched the program on sees it in the cart within the window.
 */
const OFFERED_TTL_MS = 60_000
const offeredCache = new Map<string, { atMs: number; on: boolean }>()

export async function loyaltyProgramIsOn(hostId: string, nowMs = Date.now()): Promise<boolean> {
  const cached = offeredCache.get(hostId)
  if (cached && nowMs - cached.atMs < OFFERED_TTL_MS) return cached.on
  const store = await resolveLoyaltyStore(hostId)
  const on = Boolean(store?.program.enabled)
  if (offeredCache.size > 5000) offeredCache.clear()
  offeredCache.set(hostId, { atMs: nowMs, on })
  return on
}

/** Forgets a site's cached answer: the program just changed. */
export function forgetLoyaltyProgramCache(hostId?: string): void {
  if (hostId) offeredCache.delete(hostId)
  else offeredCache.clear()
}
