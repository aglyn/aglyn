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

import { getPluginConfig } from '@aglyn/tenant-data-admin'
import { WAIVERS_PLUGIN_ID } from '../constants/bundle-common'
import { waiverRetentionYears } from '../model/waiver-retention'
import { waiversRefs } from './db'

/*==========================================
 * EVERY SIGNED WAIVER FOLLOWS THE STORE'S RETENTION PERIOD (AGL-4042).
 *
 * A signature is stamped with the date it is deleted when it is signed,
 * counted with the site's period as it resolves then. Each site that has a
 * signature also has a retention state at `orgs/{orgId}/waiverRetention/
 * {hostId}`: the period its signatures are stamped with, and when the
 * retention job last compared that with the store's setting. The setting is
 * written by the console's settings card straight to Firestore, so nothing
 * runs when it changes; the job compares each site's state with it once an
 * hour, and stamps the site's signatures again when the two differ
 * (`retention-job.ts`).
 *=========================================*/

let yearsOverride: ((orgId: string, hostId: string) => Promise<number>) | null = null

/** Test seam: a site's period. */
export function setWaiversRetentionYearsForTests(
  years: ((orgId: string, hostId: string) => Promise<number>) | null,
): void {
  yearsOverride = years
}

/** A site's waiver retention period, in years, as its settings resolve. */
export async function siteRetentionYears(orgId: string, hostId: string): Promise<number> {
  if (yearsOverride) return yearsOverride(orgId, hostId)
  return waiverRetentionYears(await getPluginConfig(orgId, WAIVERS_PLUGIN_ID, { hostId }))
}

/** A site's retention state, as stored. */
export interface WaiverRetentionState {
  orgId: string
  hostId: string
  /** The period the site's signatures are stamped with, in whole years. */
  years: number
  /** When the job last compared `years` with the store's setting, epoch ms. */
  checkedAtMs: number
  /** A re-stamp the job had to leave half done: the period it stamps with, and the last signature it reached. */
  restamp?: { years: number; afterId: string } | null
}

/**
 * Records that a site has signatures stamped with `years`, the first time
 * one is signed there. Never in the way of a signature: a state already
 * there is left for the job, and a failed write is logged and passed over,
 * because the backfill script creates any state that is missing.
 */
export async function ensureSiteRetentionState(
  orgId: string,
  hostId: string,
  years: number,
  nowMs: number,
): Promise<void> {
  const state: WaiverRetentionState = { orgId, hostId, years, checkedAtMs: nowMs, restamp: null }
  try {
    await waiversRefs.retention(orgId, hostId).create(state)
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (code === 6 || code === 'already-exists') return
    console.error('[waivers] could not record the site’s retention state', { orgId, hostId, error })
  }
}
