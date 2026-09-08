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
  checkCrmEmailQuota,
  checkCrmRecordsQuota,
  CRM_COLLECTIONS,
  CRM_EMAIL_USAGE_COLLECTION,
  type CrmActivityLink,
  crmActivityCeilingLink,
  type CrmEmailQuotaResult,
  crmEmailUsageDayKey,
  type CrmRecordsQuotaResult,
} from '@aglyn/aglyn/server'
import {
  type EmailRampVerdict,
  rampedDailyAllowance,
} from '@aglyn/shared-util-email'
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
 * `orgs/{orgId}/crmEmailUsage/{day}` — one UTC day's one-to-one email
 * counter, the document `checkCrmEmailQuota` is enforced against and the
 * billing page reads.
 */
function crmEmailUsageRefForDay(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  day: string,
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(CRM_EMAIL_USAGE_COLLECTION)
    .doc(day)
}

/** Today's counter document — {@link crmEmailUsageRefForDay} keyed by `now`. */
export function crmEmailUsageRef(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  now: Date = new Date(),
): FirebaseFirestore.DocumentReference {
  return crmEmailUsageRefForDay(firestore, orgId, crmEmailUsageDayKey(now))
}

/**
 * The counter a day-document holds, clamped.
 *
 * A malformed or absent counter reads as ZERO SENT, which is the permissive
 * direction — deliberately, and the same clamp `checkApiRequestQuota`'s
 * reader applies: a counter that cannot be read must not refuse a rep who
 * has sent nothing, and the cap is a pace rather than a cost.
 */
function crmEmailCount(snapshot: { get(field: string): unknown }): number {
  const value = Number(snapshot.get('count') ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * How many one-to-one emails the org has sent today, for a meter — never
 * for the cap, which {@link reserveCrmEmailSend} judges inside the
 * transaction that also takes the slot.
 */
export async function crmEmailsSentToday(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  now: Date = new Date(),
): Promise<number> {
  return crmEmailCount(await crmEmailUsageRef(firestore, orgId, now).get())
}

/** One slot on one day's counter, held from the reservation to the send. */
export interface CrmEmailSendReservation {
  orgId: string
  /**
   * The UTC day the slot was taken on, so a release after midnight gives
   * the slot back to the day that lent it rather than to the new day.
   */
  day: string
}

export type ReserveCrmEmailSendResult =
  | { ok: true; reservation: CrmEmailSendReservation; quota: CrmEmailQuotaResult }
  | { ok: false; quota: CrmEmailQuotaResult }

/**
 * The plan's day, narrowed to the share of it a young workspace has earned.
 *
 * The new-sender ramp reaches the one-to-one path here and only here, so the
 * ceiling the transaction below judges against is one value with one origin.
 * The alternative — a full-allowance reservation with a ramp consulted beside
 * it — is two ceilings for one decision, and under two concurrent senders it
 * admits against whichever of them was read first.
 *
 * `included` is the only field the ramp moves; `resetsAt` is the day's, which
 * a share does not change, and `used` is what the transaction read.
 */
function rampedCrmEmailQuota(
  plan: CrmEmailQuotaResult,
  ramp: EmailRampVerdict | null | undefined,
): CrmEmailQuotaResult {
  const included = rampedDailyAllowance(plan.included, ramp)
  if (included >= plan.included) return plan
  return {
    ...plan,
    included,
    allowed: plan.used < included,
    remaining: Math.max(0, included - plan.used),
  }
}

/**
 * Claims ONE one-to-one send against today's cap, ATOMICALLY (AGL-2645).
 *
 * The counter used to be read before the send and incremented after
 * delivery, so two reps sending in the same window both passed the same
 * reading and both sent — `CRM_EMAIL_SENDS_PER_MINUTE` past the cap per
 * sender, in exactly the conditions the cap exists for. **A read-then-write
 * cap is not a cap**, the lesson `reserveCampaignEmailSends` learned for
 * campaigns; this is the same shape on the day counter.
 *
 * The transaction reads the counter, judges it with `checkCrmEmailQuota` —
 * the real plan table, `UNLIMITED` on Enterprise, zero on a tier with no
 * suite — and writes an ABSOLUTE value derived from that read, deliberately
 * not `FieldValue.increment`. Firestore aborts and re-runs the callback
 * when a document the transaction read has moved, so a second sender that
 * starts inside the first one's window re-reads the raised figure and is
 * refused. An increment would be atomic on the number and useless for the
 * decision, because the decision is made from a value the write never
 * proves it still held.
 *
 * A refused reservation writes NOTHING. A taken one is the count the cap
 * enforces and the billing page shows, from the moment it is taken: a send
 * the provider then refuses hands the slot back through
 * {@link releaseCrmEmailSend}, and a process that dies between the two
 * leaves the org one send short for the rest of the UTC day — conservative
 * in the direction a cap cares about, and healed at midnight, because each
 * day is its own document.
 *
 * ## The new-sender ramp rides the same read
 *
 * `ramp` narrows the plan's day to the share of it a young workspace has
 * earned, INSIDE the transaction and before the counter is judged — see
 * {@link rampedCrmEmailQuota}. Applying it here rather than in the caller is
 * the whole of what makes it safe: the ceiling and the count it is compared
 * against come out of one read, so the retry Firestore forces on a losing
 * transaction re-derives both. A ramp checked outside would be a second
 * ceiling, decided from a snapshot the write never proves it still held —
 * the defect this reservation was built to remove, one field over.
 *
 * The ramp is optional and an absent one is not a throttle: a caller that
 * did not resolve one gets the plan's day, which is what every surface but
 * the send path wants.
 */
export async function reserveCrmEmailSend(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  org: Partial<AglynOrgBilling> | null | undefined,
  now: Date = new Date(),
  ramp?: EmailRampVerdict | null,
): Promise<ReserveCrmEmailSendResult> {
  const day = crmEmailUsageDayKey(now)
  const ref = crmEmailUsageRefForDay(firestore, orgId, day)
  return firestore.runTransaction(async (tx) => {
    const quota = rampedCrmEmailQuota(
      checkCrmEmailQuota(org, crmEmailCount(await tx.get(ref)), now),
      ramp,
    )
    if (!quota.allowed) return { ok: false, quota }
    tx.set(
      ref,
      { count: quota.used + 1, day, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    return { ok: true, reservation: { orgId, day }, quota }
  })
}

/**
 * Gives back a slot the provider did not use.
 *
 * Also a transaction, and also an absolute write from its own read: a
 * decrement computed from a stale figure would undo a slot another rep took
 * in the meantime, which is the same defect one direction over. Never
 * drives the counter below zero.
 *
 * **Never throws.** This runs on the failure path of a send that was
 * already refused, and the answer the rep gets is the provider's refusal; a
 * bookkeeping failure on top of it is logged, and its cost is one slot the
 * org does not get back until midnight — the safe direction.
 */
export async function releaseCrmEmailSend(
  firestore: FirebaseFirestore.Firestore,
  reservation: CrmEmailSendReservation | null | undefined,
): Promise<void> {
  if (!reservation?.orgId || !reservation.day) return
  const ref = crmEmailUsageRefForDay(firestore, reservation.orgId, reservation.day)
  try {
    await firestore.runTransaction(async (tx) => {
      const used = crmEmailCount(await tx.get(ref))
      tx.set(
        ref,
        {
          count: Math.max(0, used - 1),
          day: reservation.day,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    })
  } catch (error) {
    console.error('crm email reservation release failed', error)
  }
}
