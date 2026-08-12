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
import {
  billableScreenIds,
  countBillableScreens,
  type BillableScreenSource,
} from '../app/api/hosts/resources/count-billable-screens'

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
  /**
   * The host's screen rows, if the caller already walked them (AGL-1440).
   *
   * When present NO read is issued: the rule is applied to these rows instead.
   * The monthly rollup pages every screen document for site size anyway, so
   * passing them here removes one of this detector's two full scans outright
   * rather than making it cheaper.
   *
   * Pass them only when the walk was COMPLETE. A truncated page would make the
   * count a lower bound, and a cap detector that can only under-report is a cap
   * detector that cannot do its job.
   */
  screens?: ReadonlyArray<BillableScreenSource>
}

/**
 * How stale a recorded measurement may be before the alert re-measures.
 *
 * `report-usage` runs daily at 02:00 UTC and `usage-alerts` at 08:00, so the
 * figure the alert reads is normally six hours old. The window is 36h so that a
 * rollup which slips a single run — or whose chunked sweep has not reached this
 * org yet — does not send every host's screens back through a full scan.
 */
export const SCREEN_CAP_ROLLUP_MAX_AGE_MS = 36 * 60 * 60 * 1000

/** The two fields this reads off `orgs/{orgId}/usage/{month}`. */
export interface ScreenCapRollupSource {
  maxBillableScreens?: unknown
  computedAt?: unknown
}

/**
 * Milliseconds out of whatever shape a Firestore timestamp arrived in.
 *
 * Three are live: a `Timestamp` (a live admin read), a `Date`, and the
 * `{seconds}` / `{_seconds}` husk a `Timestamp` decays to across a JSON round
 * trip. Reading only the first would silently answer "stale" for the other two
 * and re-measure every host every day.
 */
function timestampMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime()
  const candidate = value as {
    toMillis?: () => number
    seconds?: unknown
    _seconds?: unknown
  }
  if (typeof candidate?.toMillis === 'function') {
    const millis = candidate.toMillis()
    return Number.isFinite(millis) ? millis : null
  }
  const seconds = candidate?.seconds ?? candidate?._seconds
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? seconds * 1000
    : null
}

/**
 * The screen-cap figure the monthly rollup already measured, if it is fresh
 * enough to alert on — otherwise `null`, meaning "go and measure" (AGL-1440).
 *
 * `usage-alerts` reads the rollup document ALREADY, for `dataStorageMb`. So
 * taking `maxBillableScreens` off the same snapshot costs nothing at all and
 * removes a full scan of every host's `screens` collection from a daily cron.
 * This is the AGL-1371 "one measurement, three readers" shape.
 *
 * `null` rather than `0` for every failure mode, and that distinction is the
 * whole reason this is a function. A missing measurement defaulted to 0 would
 * read as "this org is nowhere near its cap" — the loading-default class of bug
 * (AGL-1064), on the one detector whose entire job is to notice.
 */
export function recordedMaxBillableScreens(
  rollup: ScreenCapRollupSource | null | undefined,
  nowMs: number,
): number | null {
  const recorded = rollup?.maxBillableScreens
  if (typeof recorded !== 'number' || !Number.isFinite(recorded) || recorded < 0) {
    return null
  }
  const measuredAt = timestampMs(rollup?.computedAt)
  if (measuredAt === null) return null
  if (nowMs - measuredAt > SCREEN_CAP_ROLLUP_MAX_AGE_MS) return null
  return recorded
}

/**
 * The org's worst host's billable screen count, measuring only when there is no
 * usable recorded figure (AGL-1440).
 *
 * `measure` is a thunk rather than a value precisely so that the common path
 * never calls it: on a healthy platform the daily rollup keeps the figure fresh
 * and the alert cron scans nothing.
 */
export async function screenCapMaxBillable(
  rollup: ScreenCapRollupSource | null | undefined,
  nowMs: number,
  measure: () => Promise<number>,
): Promise<number> {
  const recorded = recordedMaxBillableScreens(rollup, nowMs)
  return recorded ?? measure()
}

/**
 * `screensPerHost` measured after the fact, across an org's hosts (AGL-1390).
 *
 * The cap is enforced where the count can CHANGE — at create, at import, and
 * (since AGL-1400) where a template is promoted back to a page. This is the
 * companion that assumes those are not the last word. Three issues in one night found three different ways past the same
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
 * ## What it costs, corrected (AGL-1440)
 *
 * This comment used to say "two projected reads per host". That was wrong by
 * orders of magnitude, and being wrong in the OPTIMISTIC direction is why the
 * cost went unnoticed for an arc: `countBillableScreens` is an UNBOUNDED scan
 * of the host's entire `screens` collection, and a `select()` projection still
 * bills ONE READ PER DOCUMENT. The projection saves bandwidth, never reads.
 *
 * So the true figure is **one read per screen, per host, per run** — and it ran
 * twice a day, once from `usage-alerts` and once from the monthly rollup, on
 * top of the rollup's own third full `screens` scan for site size. For an org
 * of H hosts at S screens each that is 3·H·S reads a day to answer a question
 * whose answer changes when somebody creates a page.
 *
 * Both extra scans are now gone and neither the rule nor the detector changed:
 *
 *  - the rollup already walks every screen document for site size, so it passes
 *    those rows in via {@link ScreenCapHostInput.screens} and reads nothing;
 *  - `usage-alerts` reads the figure the rollup recorded, off a document it was
 *    already fetching — see {@link screenCapMaxBillable}. It re-measures only
 *    when that figure is missing or stale, so an org the rollup never reached
 *    is still measured rather than quietly reported as 0.
 *
 * Steady state is therefore ONE scan per host per day, down from three.
 */
export async function measureScreenCaps(
  hosts: ReadonlyArray<ScreenCapHostInput>,
  org: unknown,
): Promise<ScreenCapReport> {
  const limit = resolveOrgEntitlements(org as any).screensPerHost
  const rows = await Promise.all(
    hosts.map(async (host) => {
      // Rows in hand cost nothing; only the fallback pays for a scan. Both arms
      // go through `billableScreenIds`, so there is one rule and not two.
      const billable = host.screens
        ? billableScreenIds(host.screens, host.routingMap as any).size
        : await countBillableScreens(host.ref, host.routingMap as any)
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
