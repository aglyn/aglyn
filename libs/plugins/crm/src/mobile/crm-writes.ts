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

import {
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
  CRM_COLLECTIONS,
  crmActivityCeilingLink,
  crmActivityLogHasRoom,
  type CrmLeadStatus,
} from '@aglyn/aglyn/app-utils/crm'
import type { MobileApiClient } from '@aglyn/mobile-plugin-host'
import {
  addDoc,
  collection,
  deleteField,
  doc,
  type Firestore,
  getCountFromServer,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { CRM_SHARING_IDS_MAX, type CrmSharingObject, crmSharingRouteUrl } from '../lib/model/crm-sharing'
import { UNQUALIFY_REASON_MAX } from '../lib/model/lead-status-choices'
import { crmTaskCallScope } from '../lib/model/task-routes'

/*==========================================
 * THE CRM'S WRITES, AS THE CONSOLE MAKES THEM (AGL-3622).
 *
 * A lead's status is a client-direct update of `orgs/{orgId}/leads/{id}`
 * (the Leads section's working state, which the rules admit to a member
 * who may write the record's scope), followed by the sharing rules'
 * re-evaluation through `crm/sharing` — exactly the console's
 * `LeadPropertiesCard` and `LeadUnqualifyDialog`. A deal's stage moves only
 * through `POST /api/crm/deal-stage`, the one writer that emits the deal
 * events automations listen for (`useDealStageApi`). A note is an activity
 * logged client-direct with the whole `CrmScoped` stamp, after the
 * per-record ceiling (`LogActivityDialog`).
 *=========================================*/

/** The thrown error's message, or the console's own fallback words. */
export function crmErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** `crm/sharing`'s re-evaluation after a client-direct write; never throws (`followUpCrmSharing`). */
export async function followUpCrmSharing(
  api: MobileApiClient,
  site: { hostId: string | null; orgId: string | null },
  object: CrmSharingObject,
  ids: readonly string[],
): Promise<void> {
  const scope = crmTaskCallScope(site.hostId, site.orgId)
  const unique = [...new Set(ids.filter(Boolean))].slice(0, CRM_SHARING_IDS_MAX)
  if (!scope || !unique.length) return
  try {
    await api.request(crmSharingRouteUrl(), {
      method: 'POST',
      body: { ...scope, object, ids: unique, action: 'evaluate' },
    })
  } catch {
    // The console logs and moves on: the write landed; a rule catches up on the next one.
  }
}

/**
 * A lead's status set by hand: the meaning and the org's label together
 * (AGL-3512). Reopening an unqualified lead drops its reason with the
 * closed state.
 */
export async function setLeadStatus(input: {
  firestore: unknown
  api: MobileApiClient
  orgId: string
  hostId: string | null
  leadId: string
  status: Exclude<CrmLeadStatus, 'unqualified' | 'qualified'>
  statusLabel: string
  /** The status the lead holds now. */
  current: CrmLeadStatus
}): Promise<void> {
  const { firestore, api, orgId, hostId, leadId, status, statusLabel, current } = input
  await updateDoc(doc(firestore as Firestore, 'orgs', orgId, 'leads', leadId), {
    status,
    statusLabel,
    ...(current === 'unqualified' ? { unqualifiedReason: deleteField() } : {}),
    updatedAt: serverTimestamp(),
  })
  await followUpCrmSharing(api, { hostId, orgId }, 'leads', [leadId])
}

/** A lead closed without converting, with the reason the console requires. */
export async function unqualifyLead(input: {
  firestore: unknown
  api: MobileApiClient
  orgId: string
  hostId: string | null
  leadId: string
  statusLabel: string
  reason: string
}): Promise<void> {
  const { firestore, api, orgId, hostId, leadId, statusLabel } = input
  const reason = input.reason.trim()
  if (!reason) throw new Error('Say why the lead is unqualified.')
  await updateDoc(doc(firestore as Firestore, 'orgs', orgId, 'leads', leadId), {
    status: 'unqualified',
    statusLabel,
    unqualifiedReason: reason.slice(0, UNQUALIFY_REASON_MAX),
    updatedAt: serverTimestamp(),
  })
  await followUpCrmSharing(api, { hostId, orgId }, 'leads', [leadId])
}

/** What `POST /api/crm/deal-stage` accepts beside the scope. */
export type DealStageRequest =
  | { dealId: string; stageId: string }
  | { dealId: string; status: 'won' }
  | { dealId: string; status: 'lost'; lostReason?: string }

/** What the route answers on success. */
export interface DealStageResponse {
  ok: true
  dealId: string
  stageId: string
  status: 'open' | 'won' | 'lost'
}

/** The route's path, as the console's `useDealStageApi` calls it. */
export const DEAL_STAGE_ROUTE = '/api/crm/deal-stage'

/**
 * A deal moved, won or lost through the stage route. Under a site the call
 * names it; at the organization level it names the deal's own site and the
 * org (the console's hub mount), as `useDealStageApi` does.
 */
export async function moveDeal(input: {
  api: MobileApiClient
  /** The picked site, or null at the organization level. */
  hostId: string | null
  orgId: string | null
  deal: { $id: string; hostId?: unknown }
  request: DealStageRequest
}): Promise<DealStageResponse> {
  const { api, hostId, orgId, deal, request } = input
  const site = hostId ?? (typeof deal.hostId === 'string' && deal.hostId ? deal.hostId : null)
  const orgLevel = !hostId
  if (!site && !(orgLevel && orgId)) {
    throw new Error('This deal names no site, so its stage cannot be moved.')
  }
  return api.request<DealStageResponse>(DEAL_STAGE_ROUTE, {
    method: 'POST',
    body: { hostId: site, ...(orgLevel && orgId ? { orgId } : {}), ...request },
  })
}

/** The most a note may say — the activity dialog's body limit. */
export const CRM_NOTE_MAX = 4000

/** The record a note is filed against, fixed by the page it is written on. */
export type CrmNoteLink = { contactId: string } | { companyId: string } | { dealId: string } | { leadId: string }

/**
 * A note logged against a record: an activity of kind `note` with the
 * `CrmScoped` stamp (`visibleTo`, `hostId`), the author and the time,
 * after counting the record's log against its ceiling under the reader's
 * own scope clause, exactly as the console's Log activity dialog does.
 */
export async function addCrmNote(input: {
  firestore: unknown
  orgId: string
  link: CrmNoteLink
  body: string
  /** The reader's list clause, or null at the organization level. */
  readTokens: readonly string[] | null
  stamp: { hostId: string; visibleTo: readonly string[] }
  uid: string
  byName?: string | null
  nowMs?: number
}): Promise<void> {
  const { link, uid, byName, stamp, readTokens } = input
  const body = input.body.trim().slice(0, CRM_NOTE_MAX)
  if (!body) throw new Error('Write the note first.')
  const firestore = input.firestore as Firestore
  const activities = collection(firestore, 'orgs', input.orgId, CRM_COLLECTIONS.activities)
  const ceiling = crmActivityCeilingLink(link)
  if (ceiling) {
    const counted = await getCountFromServer(
      query(
        activities,
        ...(readTokens ? [where('visibleTo', 'array-contains-any', [...readTokens])] : []),
        where(ceiling.field, '==', ceiling.id),
      ),
    )
    if (!crmActivityLogHasRoom(counted.data().count)) throw new Error(CRM_ACTIVITY_LOG_FULL_MESSAGE)
  }
  const now = new Date(input.nowMs ?? Date.now())
  await addDoc(activities, {
    kind: 'note',
    body,
    atMs: now.getTime(),
    ...link,
    visibleTo: [...stamp.visibleTo],
    hostId: stamp.hostId,
    byUid: uid,
    ...(byName ? { byName } : {}),
    createdAt: now,
    updatedAt: now,
  })
}
