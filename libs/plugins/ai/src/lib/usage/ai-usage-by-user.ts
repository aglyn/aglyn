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

// Straight from the SDK, not the admin lib, for the reason `assist-usage.ts`
// gives at its head: the statics need no app, and the admin lib would drag the
// default-app initialization into every unit test that touches a counter.
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import {
  AI_USAGE_BY_USER_COLLECTION,
  AI_USAGE_BY_USER_MONTHS_COLLECTION,
  AI_USAGE_BY_USER_RETENTION_MONTHS,
  aiUsageByUserExpiry,
  aiUsageByUserMonthFrom,
  aiUsageShare,
  type AiUsageByUserMonth,
  type AiUsageKind,
} from '../model/ai-usage-by-user'
import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'

/**
 * PER-USER AI USAGE (AGL-2928): the writer and the readers.
 *
 * One document per person per month, under the org they spent in:
 *
 *   orgs/{orgId}/aiUsageByUser/{uid}/months/{YYYY-MM}
 *     { uid, month, credits, estCostUsd, requests, refusals,
 *       byKind: { kind: credits }, byHost: { hostId: credits },
 *       updatedAt, expiresAt }
 *
 * ## Written in the org rollup's own batch
 *
 * `recordUserAiUsage` takes the BATCH the org rollup is being written into
 * and adds this document to it, so the two cannot disagree: a batch commits
 * whole or not at all, and there is no path on which the workspace's month
 * moves and the person's does not. Both assist entrypoints hand it the batch
 * from inside `recordAssistCost` / `recordAssistExchange`, and the job
 * runner meters through the first of those, so a generation step lands here
 * with the job's kind and creator.
 *
 * ## No prose, no PII past the uid
 *
 * The exchange's verbatim half already expires at 180 days for the reason
 * `assist-usage.ts` gives; this rollup is integers keyed by an id, and it
 * is kept longer (`AI_USAGE_BY_USER_RETENTION_MONTHS`) because a workspace
 * admin's question is month-over-month. It is still a document ABOUT a
 * person, so it is readable only by the person and by members holding
 * `billing.view` or `org.auditLog` (the rules, and every route that serves
 * it), and an account erasure sweeps it (`eraseUserAiUsage`).
 */

/** What one metered request attributes to a person. */
export interface RecordUserAiUsageInput {
  /** The person who asked. No uid, no attribution — the write is skipped. */
  uid: string | null | undefined
  /** The billing month the org rollup is being written into. */
  month: string
  /** The request's measured provider spend, as the org rollup counts it. */
  estCostUsd: number
  hostId: string | null | undefined
  kind: AiUsageKind
}

export function userAiUsageMonthRef(
  orgRef: FirebaseFirestore.DocumentReference,
  uid: string,
  month: string,
): FirebaseFirestore.DocumentReference {
  return orgRef
    .collection(AI_USAGE_BY_USER_COLLECTION)
    .doc(uid)
    .collection(AI_USAGE_BY_USER_MONTHS_COLLECTION)
    .doc(month)
}

/**
 * Fold one request into a person's month, on the caller's batch.
 *
 * Returns whether anything was queued: a request with no uid (a meter that
 * could not say who asked) attributes to nobody rather than to a placeholder
 * id that would rank on every table. `set(…, { merge: true })`, never
 * `update()`: the document does not exist before a person's first request
 * of the month, and a merge into a map field adds the key rather than
 * replacing the map.
 */
export function recordUserAiUsage(
  batch: FirebaseFirestore.WriteBatch,
  orgRef: FirebaseFirestore.DocumentReference,
  input: RecordUserAiUsageInput,
): boolean {
  const uid = String(input.uid ?? '').trim()
  if (!uid) return false
  const estCostUsd =
    Number.isFinite(input.estCostUsd) && input.estCostUsd > 0
      ? input.estCostUsd
      : 0
  const credits = assistCreditsFromUsd(estCostUsd)
  const increment = FieldValue.increment
  const hostId = String(input.hostId ?? '').trim()
  batch.set(
    userAiUsageMonthRef(orgRef, uid, input.month),
    {
      uid,
      month: input.month,
      credits: increment(credits),
      estCostUsd: increment(estCostUsd),
      requests: increment(1),
      byKind: { [input.kind]: increment(credits) },
      ...(hostId ? { byHost: { [hostId]: increment(credits) } } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      // The retention window, as a Timestamp the TTL policy can act on.
      expiresAt: aiUsageByUserExpiry(input.month),
    },
    { merge: true },
  )
  return true
}

/**
 * The slice of a reservation a refusal is counted from: whether the gate
 * admitted the request, and the billing month it decided in. Structural, so
 * every door can hand over the reservation it already holds.
 */
export interface UserAiRefusalSource {
  allowed: boolean
  monthKey: string
}

/**
 * Count a refused reservation against the person who asked — the per-person
 * twin of `recordAssistRefusal`, and shaped the same way: fire-and-forget,
 * off the refusal's await path, swallowing every error, because a refusal
 * is the gate's cheap exit and a counter must not make it dearer than the
 * thing it counts.
 *
 * Takes the whole reservation rather than a month so every door calls it
 * the same way, once, right after reserving: an admitted reservation records
 * nothing, so the call needs no branch of its own and cannot drift from the
 * door's refusal branch. The month is the reservation's, not the clock's,
 * because that is the month the org's own refusal was counted in.
 */
export function recordUserAiRefusal(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  uid: string | null | undefined,
  reservation: UserAiRefusalSource,
): void {
  if (reservation.allowed) return
  const subject = String(uid ?? '').trim()
  if (!subject) return
  try {
    const ref = userAiUsageMonthRef(
      firestore.collection('orgs').doc(orgId),
      subject,
      reservation.monthKey,
    )
    void Promise.resolve(
      ref.set(
        {
          uid: subject,
          month: reservation.monthKey,
          refusals: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          expiresAt: aiUsageByUserExpiry(reservation.monthKey),
        },
        { merge: true },
      ),
    ).catch(() => undefined)
  } catch {
    // A double without `set`, a ref that could not be built — the refusal
    // has already been decided and this must not change that.
  }
}

/** One roster row's month, with the person the roster names. */
export interface OrgAiUsageByUserRow extends AiUsageByUserMonth {
  /** The display name, else the email, else the uid — never blank. */
  name: string
  email: string | null
  role: string | null
  /** This person's share of the org's measured spend, in `[0, 1]`. */
  share: number
}

export interface OrgAiUsageByUserMonth {
  month: string
  /** The org rollup's spend for the month — the denominator of every share. */
  orgEstCostUsd: number
  orgCredits: number
  /** Every current member with a document for the month, dearest first. */
  rows: OrgAiUsageByUserRow[]
}

/** How many references one `getAll` carries. */
const GET_ALL_CHUNK = 100

/**
 * The month for every current member of the org, dearest first.
 *
 * Reads the ROSTER and then each member's month document by path, rather
 * than a collection-group query over `months`: the roster is the join the
 * table needs anyway (a uid is not a name), it is bounded by the seats the
 * plan sells, and a path read rides no index that has to be deployed before
 * a workspace can open its Usage page. A person who has left the org is not
 * listed — the roster is the set of people the reader may see — and their
 * documents expire on the retention window.
 */
export async function readOrgAiUsageByUser(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  month: string,
): Promise<OrgAiUsageByUserMonth> {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const [roster, rollup] = await Promise.all([
    orgRef.collection('members').get(),
    orgRef.collection('assistUsage').doc(month).get(),
  ])
  const orgEstCostUsd = Number(rollup.get('estCostUsd') ?? 0)
  const denominator =
    Number.isFinite(orgEstCostUsd) && orgEstCostUsd > 0 ? orgEstCostUsd : 0

  const members = roster.docs.map((doc) => ({
    uid: doc.id,
    email: typeof doc.get('email') === 'string' ? String(doc.get('email')) : null,
    displayName:
      typeof doc.get('displayName') === 'string' && String(doc.get('displayName')).trim()
        ? String(doc.get('displayName')).trim()
        : null,
    role: typeof doc.get('role') === 'string' ? String(doc.get('role')) : null,
  }))

  const rows: OrgAiUsageByUserRow[] = []
  for (let start = 0; start < members.length; start += GET_ALL_CHUNK) {
    const chunk = members.slice(start, start + GET_ALL_CHUNK)
    const snapshots = await firestore.getAll(
      ...chunk.map((member) => userAiUsageMonthRef(orgRef, member.uid, month)),
    )
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return
      const member = chunk[index]
      const usage = aiUsageByUserMonthFrom(snapshot.data(), member.uid, month)
      rows.push({
        ...usage,
        name: member.displayName ?? member.email ?? member.uid,
        email: member.email,
        role: member.role,
        share: aiUsageShare(usage.estCostUsd, denominator),
      })
    })
  }
  rows.sort(
    (a, b) =>
      b.credits - a.credits ||
      b.requests - a.requests ||
      a.name.localeCompare(b.name),
  )
  return {
    month,
    orgEstCostUsd: denominator,
    orgCredits: assistCreditsFromUsd(denominator),
    rows,
  }
}

/**
 * One person's months in one org, newest first — the member card and the
 * staff page. Ordered on the document id, which IS the month key and so
 * needs no field every writer must remember.
 */
export async function readUserAiUsageMonths(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  uid: string,
  limit: number = AI_USAGE_BY_USER_RETENTION_MONTHS,
): Promise<AiUsageByUserMonth[]> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(AI_USAGE_BY_USER_COLLECTION)
    .doc(uid)
    .collection(AI_USAGE_BY_USER_MONTHS_COLLECTION)
    .orderBy(FieldPath.documentId(), 'desc')
    .limit(limit)
    .get()
  return snapshot.docs.map((doc) => aiUsageByUserMonthFrom(doc.data(), uid, doc.id))
}

export interface EraseUserAiUsageResult {
  /** Orgs whose `aiUsageByUser/{uid}` subtree was deleted by path. */
  orgs: number
  /**
   * Month documents found by the collection-group sweep and deleted — the
   * ones in orgs the person had already left. `null` when the sweep could
   * not run (its index is not deployed), which is not zero.
   */
  sweptMonths: number | null
}

/**
 * Remove a person's usage documents on account erasure.
 *
 * Two passes, because the documents live under the ORG and are keyed by the
 * uid: `recursiveDelete(users/{uid})` cannot see them, and neither can a
 * walk of current memberships find the months left behind in an org the
 * person was removed from. So every org the erasure knows of is deleted by
 * path first — no index, cannot fail for want of one — and then a
 * collection-group query on `uid` catches the rest. The second pass is
 * reported as `null` rather than thrown when it cannot run: the erasure has
 * a legal clock, and the by-path pass has already removed everything a
 * current membership could reach.
 */
export async function eraseUserAiUsage(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  orgIds: readonly string[],
): Promise<EraseUserAiUsageResult> {
  let orgs = 0
  for (const orgId of orgIds) {
    await firestore.recursiveDelete(
      firestore
        .collection('orgs')
        .doc(orgId)
        .collection(AI_USAGE_BY_USER_COLLECTION)
        .doc(uid),
    )
    orgs += 1
  }
  let sweptMonths: number | null = null
  try {
    const stray = await firestore
      .collectionGroup(AI_USAGE_BY_USER_MONTHS_COLLECTION)
      .where('uid', '==', uid)
      .get()
    sweptMonths = 0
    for (let start = 0; start < stray.docs.length; start += GET_ALL_CHUNK) {
      const batch = firestore.batch()
      for (const doc of stray.docs.slice(start, start + GET_ALL_CHUNK)) {
        batch.delete(doc.ref)
        sweptMonths += 1
      }
      await batch.commit()
    }
  } catch (error) {
    console.error(`eraseUserAiUsage: collection-group sweep failed for ${uid}`, error)
  }
  return { orgs, sweptMonths }
}
