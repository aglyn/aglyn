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

import type { OutreachCampaignCredit, OutreachRecordEmailStamp } from '../runtime/runtime-deps'
import type { OutreachResolveMx } from '../storage/domain-intel-store'
import type { OutreachRouteGateDeps } from './route-gate'

/**
 * What the settings, sequence and enrollment routes reach outside this
 * plugin (AGL-2980). The platform's own are `register-routes.ts`; specs
 * build their own.
 */

/**
 * The org activity target a sequence's rows are filed under: Outreach's own
 * namespaced resource (`pluginId:noun`), which the feed reads as "Sequence".
 * Core's target list names only core's resources, so a plugin's never joins
 * it.
 */
export const OUTREACH_SEQUENCE_ACTIVITY_TARGET = 'outreach:sequence'

/** What an org activity line written by these routes points at. */
export type OutreachActivityTarget =
  | { type: 'org'; id: string }
  | { type: typeof OUTREACH_SEQUENCE_ACTIVITY_TARGET; id: string; name: string }

export interface OutreachRouteDeps {
  firestore(): FirebaseFirestore.Firestore
  gate: OutreachRouteGateDeps
  now(): number
  /** A source of numbers in `[0, 1)` — the scheduler's jitter. */
  random(): number
  logOrgActivity(
    orgId: string,
    actor: { uid: string; email?: string | null },
    action: string,
    target: OutreachActivityTarget,
  ): Promise<void>
  /**
   * Stamps a member's do-not-contact mark on the lead and the contact that
   * carry the address (AGL-3245); the runtime's twin is on its own deps.
   */
  stampRecordEmailState(stamp: OutreachRecordEmailStamp): Promise<void>
  /**
   * Credits an enrollment to the sequence's campaigns (AGL-3254) — the
   * enroll route's `enrolled`; the runtime's twin credits the rest.
   */
  creditCampaign: OutreachCampaignCredit['credit']
  /**
   * The MX resolver the enroll routes classify a domain's mail gateway with
   * (AGL-3326) — Node's `dns.promises.resolveMx` on the platform.
   */
  resolveMx: OutreachResolveMx
}
