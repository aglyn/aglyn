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

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation'
import { checkCrmRecordsQuota } from '@aglyn/aglyn/server'
import { countCrmRecords } from './crm-records'

/**
 * Whether a CAPTURE may add one more person to the org's CRM (AGL-4227) —
 * the question the contact door and the lead door both ask before a create,
 * so the two cannot disagree. Never asked for a returning person: an update
 * grows nothing.
 *
 * The verdict is `checkCrmRecordsQuota`'s, the by-hand path's rule. On a plan
 * that SELLS records past its band (Starter to its ceiling, Pro up) it is
 * exactly that verdict, so paid plans meter as before. On a plan that sells
 * none (Free, a comp, a lapsed plan) the band is a hard wall, and it counts
 * the leads a capture filed beside the contacts, companies and deals: those
 * are the people waiting for the owner, so they share the one band rather
 * than piling up uncounted (to 200,000 a site) next to it.
 */
export async function crmCaptureAdmitted(
  org: Partial<AglynOrgBilling> | null | undefined,
  orgRef: FirebaseFirestore.DocumentReference,
  contacts?: FirebaseFirestore.CollectionReference,
): Promise<boolean> {
  const { crmRecordsCount } = await countCrmRecords(orgRef, contacts)
  const verdict = checkCrmRecordsQuota(org, crmRecordsCount)
  if (verdict.overageRateUsd !== null || !verdict.allowed) return verdict.allowed
  const leads = Math.max(0, Math.floor(Number((await orgRef.collection('leads').count().get()).data()?.count ?? 0) || 0))
  return checkCrmRecordsQuota(org, crmRecordsCount + leads).allowed
}

