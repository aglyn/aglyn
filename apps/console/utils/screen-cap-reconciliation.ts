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

import { resolveOrgEntitlements } from '@aglyn/aglyn/server'
import { countBillableScreens } from '../app/api/hosts/resources/count-billable-screens'

/** One host measured against its owning org's screen allowance. */
export interface HostScreenCapRow {
  hostId: string
  billable: number
  /** The plan's `screensPerHost`; `Infinity` on the unlimited plans. */
  limit: number
  /** How far past the cap, 0 when within it. */
  overBy: number
}

export interface ScreenCapReport {
  rows: HostScreenCapRow[]
  /** The org's worst host — what the 80%/100% alert is keyed on. */
  maxBillable: number
  limit: number
  /** Hosts past the cap, for the rollup to record. */
  overCapHostIds: string[]
}

/** The two fields a caller must hold per host — both free at every call site. */
export interface ScreenCapHostInput {
  id: string
  ref: Parameters<typeof countBillableScreens>[0]
  /** The host's `screens` routing map, straight off the snapshot. */
  routingMap: unknown
}

/**
 * `screensPerHost` measured after the fact, across an org's hosts (AGL-1390).
 *
 * The cap is enforced where the count can CHANGE — at create, and since
 * AGL-1390 on the collection template pointers that were the last reversible
 * way to lower it. This is the companion that assumes those are not the last
 * word. Three issues in one night found three different ways past the same
 * gate (AGL-1383's two client-flippable fields, AGL-1387's list template,
 * AGL-1390's pointer loop), and each was invisible until somebody read the
 * code: nothing anywhere ever re-asked whether a live site was inside the plan
 * it is on. Prevention that is only ever checked at the moment of the write
 * has no way to notice the write it failed to think of.
 *
 * So this is deliberately a DETECTOR and nothing more. It reports; it does not
 * unpublish, delete, downgrade or refuse. A site that is over its cap keeps
 * serving every page it serves today — the honest response to "we sold you
 * fewer than you have" is to say so to the people who can act on it, not to
 * take a customer's pages off the internet on a cron's say-so.
 *
 * Costs two projected reads per host on sweeps that already walk them, which
 * is why it can live in both the daily alert cron and the monthly rollup
 * rather than having to earn a sweep of its own.
 */
export async function measureScreenCaps(
  hosts: ReadonlyArray<ScreenCapHostInput>,
  org: unknown,
): Promise<ScreenCapReport> {
  const limit = resolveOrgEntitlements(org as any).screensPerHost
  const rows = await Promise.all(
    hosts.map(async (host) => {
      const billable = await countBillableScreens(host.ref, host.routingMap as any)
      return {
        hostId: host.id,
        billable,
        limit,
        overBy: Number.isFinite(limit) ? Math.max(0, billable - limit) : 0,
      }
    }),
  )
  return {
    rows,
    // `0` for an org with no hosts, so the caller's ratio is 0 rather than NaN.
    maxBillable: rows.reduce((most, row) => Math.max(most, row.billable), 0),
    limit,
    overCapHostIds: rows.filter((row) => row.overBy > 0).map((row) => row.hostId),
  }
}
