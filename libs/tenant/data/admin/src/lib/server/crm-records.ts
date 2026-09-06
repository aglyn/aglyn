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
import {
  checkCrmRecordsQuota,
  CRM_COLLECTIONS,
  CRM_EMAIL_USAGE_COLLECTION,
  type CrmActivityLink,
  crmActivityCeilingLink,
  crmEmailUsageDayKey,
  type CrmRecordsQuotaResult,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * The CRM RECORDS band's measurement (AGL-2611): the three collections it
 * counts, and their sum.
 *
 * One shape for every server that asks, because the band is enforced at six
 * doors — contact capture, the console's company and deal drawers (through
 * the client twin of this read), the CSV import, the lead conversion and the
 * two REST creates — and the monthly rollup bills from the same three
 * aggregates. A door that counted contacts alone would admit a company on a
 * band the rollup had already found full.
 */
export interface CrmRecordsCount {
  contactsCount: number
  companiesCount: number
  dealsCount: number
  /** The band's own figure: the three above, summed. */
  crmRecordsCount: number
}

/**
 * Count the records band for one org: three `count()` aggregates, in
 * parallel, no document reads.
 *
 * `contacts` may be handed in by a caller that already holds the collection
 * reference — `upsertHostContact` resolves it through `orgDataCollection`
 * before it decides anything — so the read is the same one whichever door
 * it came through, and the org reference is needed only for the two
 * collections the hub added.
 */
export async function countCrmRecords(
  orgRef: FirebaseFirestore.DocumentReference,
  contacts: FirebaseFirestore.CollectionReference = orgRef.collection('contacts'),
): Promise<CrmRecordsCount> {
  const [contactsSnap, companiesSnap, dealsSnap] = await Promise.all([
    contacts.count().get(),
    orgRef.collection(CRM_COLLECTIONS.companies).count().get(),
    orgRef.collection(CRM_COLLECTIONS.deals).count().get(),
  ])
  const contactsCount = aggregateCount(contactsSnap)
  const companiesCount = aggregateCount(companiesSnap)
  const dealsCount = aggregateCount(dealsSnap)
  return {
    contactsCount,
    companiesCount,
    dealsCount,
    crmRecordsCount: contactsCount + companiesCount + dealsCount,
  }
}

/**
 * The band's verdict for one org, measured now — the read every create
 * door takes before it writes, so the six doors cannot disagree about
 * whether there is room. `checkCrmRecordsQuota` answers from the org doc
 * alone; this pairs it with the measurement.
 */
export async function crmRecordsQuotaForOrg(
  org: Partial<AglynOrgBilling> | null | undefined,
  orgRef: FirebaseFirestore.DocumentReference,
  contacts?: FirebaseFirestore.CollectionReference,
): Promise<CrmRecordsQuotaResult & CrmRecordsCount> {
  const counts = await countCrmRecords(orgRef, contacts)
  return { ...checkCrmRecordsQuota(org, counts.crmRecordsCount), ...counts }
}

/** `count()` answers through `.data().count`; a missing figure is zero, never NaN. */
function aggregateCount(snapshot: { data(): { count?: unknown } }): number {
  const value = Number(snapshot.data()?.count ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * How many activities one record already carries — one aggregate on a
 * single-field equality, which Firestore indexes on its own, so this needs
 * no composite index and cannot go FAILED_PRECONDITION in production.
 */
export async function countCrmActivitiesForRecord(
  orgRef: FirebaseFirestore.DocumentReference,
  link: CrmActivityLink,
): Promise<number> {
  const lead = crmActivityCeilingLink(link)
  if (!lead) return 0
  const snapshot = await orgRef
    .collection(CRM_COLLECTIONS.activities)
    .where(lead.field, '==', lead.id)
    .count()
    .get()
  return aggregateCount(snapshot)
}

/**
 * `orgs/{orgId}/crmEmailUsage/{YYYY-MM-DD}` — today's one-to-one email
 * counter, the document `checkCrmEmailQuota` is enforced against and the
 * billing page reads.
 */
export function crmEmailUsageRef(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  now: Date = new Date(),
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(CRM_EMAIL_USAGE_COLLECTION)
    .doc(crmEmailUsageDayKey(now))
}

/**
 * How many one-to-one emails the org has sent today, for the cap.
 *
 * A malformed or absent counter reads as ZERO SENT, which is the permissive
 * direction — deliberately, and the same clamp `checkApiRequestQuota`'s
 * reader applies: a counter that cannot be read must not refuse a rep who
 * has sent nothing, and the cap is a pace rather than a cost.
 */
export async function crmEmailsSentToday(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  now: Date = new Date(),
): Promise<number> {
  const snapshot = await crmEmailUsageRef(firestore, orgId, now).get()
  const value = Number(snapshot.get('count') ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * One delivered one-to-one email, onto today's counter (AGL-2611).
 *
 * `FieldValue.increment` under `{ merge: true }`, exactly as `recordApiRequest`
 * writes the API counter: no read-then-write, so two reps sending in the
 * same second both count, and a day-doc that does not exist yet is conjured
 * by the first send. `day` is stored beside the count so the document says
 * what it is when read back off a backup.
 *
 * **Never throws.** The message has already left when this runs — the send
 * route reads the counter and refuses BEFORE sending, and records AFTER —
 * so a counter write that fails must not turn a delivered email into an
 * error for the rep, the posture `recordEmailSends` takes for the cost
 * meter this send also lands on. Undercounting by one on a failed write is
 * the permissive direction for a pace cap, and it is logged.
 */
export async function recordCrmEmailSend(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  count = 1,
  now: Date = new Date(),
): Promise<void> {
  const sends = Math.floor(Number(count))
  if (!orgId || !Number.isFinite(sends) || sends <= 0) return
  try {
    await crmEmailUsageRef(firestore, orgId, now).set(
      {
        count: FieldValue.increment(sends),
        day: crmEmailUsageDayKey(now),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  } catch (error) {
    console.error('crm email counter write failed', error)
  }
}
