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
 * WHAT A DELIVERED MARKETING EMAIL DOES TO A LEAD (AGL-3446).
 *
 * A lead nobody has touched, once a campaign email has been delivered to
 * it, moves from New to Nurturing: automated email is reaching it, so the
 * CRM digest must not count it as unworked, but no person has engaged yet.
 * Sequences make the same move from their own send job. A sender reaches
 * this through the record email-state seam's `reached`
 * (`stampRecordEmailReach`), never by importing the CRM.
 *
 * Found by address rather than by audience: a lead's document id IS the
 * `personKey` of its address (`orgs/{orgId}/leads/{personKey}`, AGL-3275),
 * so every audience — the leads, a list, a segment, typed-in addresses —
 * resolves the people it reached to their lead rows by one batched read,
 * with no query and no index.
 *
 * Only a lead the sending site holds is moved — `visibleTo` names it — so
 * one brand's campaign never writes the stage of a lead another brand in
 * the same organization keeps. Only `new` moves; Nurturing, Working, the
 * closed states and a converted lead are left as they stand.
 *
 * Never throws: the mail has already gone, and a stage that could not be
 * written is one a rep sets by hand.
 */

import { crmLeadStatus } from '@aglyn/aglyn/app-utils/crm'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'

/** `getAll` takes this many references per call, and a batch this many writes. */
const CHUNK = 300

/** Move the delivered-to leads still New to Nurturing; how many moved. */
export async function nurtureReachedLeads(
  firestore: Firestore,
  input: { orgId: string; hostId: string; emails: readonly string[] },
): Promise<number> {
  if (!input.orgId || !input.emails.length) return 0
  const keys = [
    ...new Set(input.emails.map((email) => personKey(email)).filter((key): key is string => Boolean(key))),
  ]
  const leads = firestore.collection('orgs').doc(input.orgId).collection('leads')
  let moved = 0
  for (let start = 0; start < keys.length; start += CHUNK) {
    try {
      const snapshots = await firestore.getAll(...keys.slice(start, start + CHUNK).map((key) => leads.doc(key)))
      const batch = firestore.batch()
      let writes = 0
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue
        const lead = snapshot.data() ?? {}
        if (lead['convertedContactId']) continue
        if (!visibleToHost(lead['visibleTo'] as string[] | undefined, input.hostId)) continue
        if (crmLeadStatus(lead as never) !== 'new') continue
        batch.set(snapshot.ref, { status: 'nurturing', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        writes += 1
      }
      if (writes) {
        await batch.commit()
        moved += writes
      }
    } catch (error) {
      console.error('[crm] the reached leads could not be marked nurturing', input.orgId, error)
    }
  }
  return moved
}
