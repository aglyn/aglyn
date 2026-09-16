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
// gives at its head: the statics need no app, and the reservation that reads
// allotments runs in every unit test that touches a counter.
import { FieldValue } from 'firebase-admin/firestore'
import {
  AI_ALLOTMENTS_COLLECTION,
  AI_ALLOTMENT_ORG_SUBJECT,
  aiAllotmentFrom,
  aiAllotmentModelsAllowed,
  aiAllotmentSubjectId,
  aiAllotmentVerdict,
  type AiAllotment,
  type AiAllotmentMode,
  type AiAllotmentStanding,
  type AiAllotmentSubject,
  type AiAllotmentVerdict,
} from '../model/ai-allotments'
import { aiUsageByUserMonthFrom } from '../model/ai-usage-by-user'
import { userAiUsageMonthRef } from './ai-usage-by-user'

/**
 * AI ALLOTMENTS (AGL-2942): the reads the gate takes and the writes the
 * route makes. The shape and the arithmetic are `model/ai-allotments.ts`.
 *
 * ## What the gate reads, and where the figures come from
 *
 * One request by `uid`, naming `hostId` or not, is measured against every
 * allotment that applies to it:
 *
 *   member:{uid}           the person's credits this month, every site —
 *                          `aiUsageByUser/{uid}/months/{month}.credits`
 *   collab:{hostId}:{uid}  the person's credits on that site —
 *                          the same document's `byHost.{hostId}`
 *   host:{hostId}          the SITE's credits, everyone on it — the org
 *                          rollup's `assistUsage/{month}.byHost.{hostId}`
 *   org                    no credits: the model restriction
 *
 * The per-person figures are the AGL-2928 rollup. The site figure is a map
 * the meter writes on the org's month in the same batch, because summing the
 * roster's months on every request would be one read per collaborator.
 *
 * Read inside the reservation's transaction, after the workspace's own
 * ceilings admitted the request, so a refusal at the band costs no allotment
 * read at all and an allotment is only ever consulted inside the band.
 *
 * ## Written only here, never by a client
 *
 * The rules deny every client write: an allotment is a spend control, and a
 * collaborator who could write their own could lift it.
 */

/** The org month map a site's credits accumulate in. */
export const AI_HOST_CREDITS_FIELD = 'byHost'

export function aiAllotmentsCollection(
  orgRef: FirebaseFirestore.DocumentReference,
): FirebaseFirestore.CollectionReference {
  return orgRef.collection(AI_ALLOTMENTS_COLLECTION)
}

export function aiAllotmentRef(
  orgRef: FirebaseFirestore.DocumentReference,
  subject: string,
): FirebaseFirestore.DocumentReference {
  return aiAllotmentsCollection(orgRef).doc(subject)
}

/** Who a request is, for the allotments that apply to it. */
export interface AiAllotmentRequestSubject {
  /** The person asking; a request with none is measured against no allotment. */
  uid?: string | null
  /** The site the request named, when it named one. */
  hostId?: string | null
}

/** Everything the reservation learned about allotments, carried to the door. */
export interface AiAllotmentGate extends AiAllotmentVerdict {
  /** The caller's own credits this month, before this request. */
  personalCredits: number
  /** Every allotment of credits that applied, measured. */
  standings: AiAllotmentStanding[]
  /** The allotment allowlists that applied, intersected; `null` for none. */
  models: string[] | null
  /** The org-wide model restriction; `null` for none. */
  orgModels: string[] | null
}

/** A document read, from a transaction or a plain Firestore. */
export type AiAllotmentDocReader = (
  ref: FirebaseFirestore.DocumentReference,
) => Promise<FirebaseFirestore.DocumentSnapshot>

const trimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/** An allotment read by the subject the reader ADDRESSED, not the one it echoes. */
const allotmentOf = (
  snapshot: FirebaseFirestore.DocumentSnapshot | null | undefined,
  subject: string | null,
): AiAllotment | null =>
  snapshot?.exists && subject
    ? aiAllotmentFrom(snapshot.data() as Record<string, unknown>, subject)
    : null

/**
 * A subject id, or `null` when a segment is not an id. A request's site comes
 * from its body, and a value that could never name a site names no
 * allotment rather than failing the reservation it rides in.
 */
function subjectIdOrNull(input: Parameters<typeof aiAllotmentSubjectId>[0]): string | null {
  try {
    return aiAllotmentSubjectId(input)
  } catch {
    return null
  }
}

/** A site's credits this month off the org rollup's month document. */
export function aiHostMonthCredits(
  orgMonth: FirebaseFirestore.DocumentSnapshot | null | undefined,
  hostId: string,
): number {
  const map = (orgMonth?.exists ? orgMonth.get(AI_HOST_CREDITS_FIELD) : null) as
    | Record<string, unknown>
    | null
    | undefined
  const value = Number(map?.[hostId] ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * Read and measure the allotments that apply to one request. `null` when
 * the request names nobody — a meter that cannot say who asked meets no
 * allotment, as it attributes to nobody.
 *
 * `orgMonth` is the org's month document when the caller already read it —
 * the reservation reads it for an entitled workspace anyway — so a site
 * allotment costs no second read of it.
 */
export async function readAiAllotmentGate(
  read: AiAllotmentDocReader,
  orgRef: FirebaseFirestore.DocumentReference,
  subject: AiAllotmentRequestSubject,
  month: string,
  orgMonth: FirebaseFirestore.DocumentSnapshot | null = null,
): Promise<AiAllotmentGate | null> {
  const uid = trimmed(subject.uid)
  const memberId = uid ? subjectIdOrNull({ scope: 'member', uid }) : null
  if (!uid || !memberId) return null
  const requestedHost = trimmed(subject.hostId)
  const hostSubjectId = requestedHost
    ? subjectIdOrNull({ scope: 'host', hostId: requestedHost })
    : null
  const hostId = hostSubjectId ? requestedHost : ''
  const collabId = hostId ? subjectIdOrNull({ scope: 'collab', hostId, uid }) : null
  const subjectRef = (id: string) => aiAllotmentRef(orgRef, id)
  const [orgDoc, memberDoc, collabDoc, hostDoc, monthDoc] = await Promise.all([
    read(subjectRef(AI_ALLOTMENT_ORG_SUBJECT)),
    read(subjectRef(memberId)),
    collabId ? read(subjectRef(collabId)) : null,
    hostSubjectId ? read(subjectRef(hostSubjectId)) : null,
    read(userAiUsageMonthRef(orgRef, uid, month)),
  ])
  const member = allotmentOf(memberDoc, memberId)
  const collab = allotmentOf(collabDoc, collabId)
  const host = allotmentOf(hostDoc, hostSubjectId)
  const personal = aiUsageByUserMonthFrom(
    monthDoc?.exists ? (monthDoc.data() as Record<string, unknown>) : null,
    uid,
    month,
  )

  let siteMonth = orgMonth
  if (host?.credits && !siteMonth) {
    siteMonth = await read(orgRef.collection('assistUsage').doc(month))
  }

  const standings: AiAllotmentStanding[] = []
  const measure = (allotment: AiAllotment | null, used: number) => {
    if (!allotment || allotment.credits === null || allotment.scope === 'org') return
    standings.push({
      subject: allotment.subject,
      scope: allotment.scope,
      uid: allotment.uid,
      hostId: allotment.hostId,
      credits: allotment.credits,
      used,
      mode: allotment.mode,
    })
  }
  measure(member, personal.credits)
  measure(collab, hostId ? (personal.byHost[hostId] ?? 0) : 0)
  measure(host, hostId ? aiHostMonthCredits(siteMonth, hostId) : 0)

  return {
    ...aiAllotmentVerdict(standings),
    personalCredits: personal.credits,
    standings,
    models: aiAllotmentModelsAllowed([member, collab, host]),
    orgModels: allotmentOf(orgDoc, AI_ALLOTMENT_ORG_SUBJECT)?.models ?? null,
  }
}

/** Every allotment in an org, optionally narrowed to one person or one site. */
export async function listAiAllotments(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  filter: { uid?: string; hostId?: string } = {},
): Promise<AiAllotment[]> {
  let query: FirebaseFirestore.Query = aiAllotmentsCollection(
    firestore.collection('orgs').doc(orgId),
  )
  // Single-field equality on fields every write stores, so neither needs a
  // composite index.
  if (filter.uid) query = query.where('uid', '==', filter.uid)
  else if (filter.hostId) query = query.where('hostId', '==', filter.hostId)
  const snapshot = await query.get()
  return snapshot.docs
    .map((doc) => aiAllotmentFrom(doc.data() as Record<string, unknown>, doc.id))
    .filter((allotment): allotment is AiAllotment => allotment !== null)
}

/** One allotment a write sets. */
export interface AiAllotmentWrite {
  subject: AiAllotmentSubject
  credits: number | null
  mode: AiAllotmentMode
  models: string[] | null
}

/**
 * Set and remove allotments in one batch. A set REPLACES the document —
 * credits, mode and allowlist together — and clears the alert marker, so a
 * raised allotment announces its next crossing rather than inheriting the
 * last one's.
 */
export async function applyAiAllotmentWrites(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  change: { set: readonly AiAllotmentWrite[]; remove: readonly string[] },
  actorUid: string,
): Promise<void> {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const batch = firestore.batch()
  for (const write of change.set) {
    batch.set(aiAllotmentRef(orgRef, write.subject.id), {
      subject: write.subject.id,
      scope: write.subject.scope,
      uid: write.subject.uid,
      hostId: write.subject.hostId,
      credits: write.subject.scope === 'org' ? null : write.credits,
      mode: write.mode,
      models: write.models,
      setBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      alerted: null,
    })
  }
  for (const subject of change.remove) {
    batch.delete(aiAllotmentRef(orgRef, subject))
  }
  await batch.commit()
}

/**
 * Give a site's month its credits so far, once, when an allotment on the site
 * is set before the site's map has a key for it.
 *
 * The map is written by the meter from the day the field shipped; a month
 * already in progress has spend the map never saw. The roster's own months
 * carry the same figure per person (`byHost`), so the first allotment set on
 * a site sums them and writes the total — inside a transaction that writes
 * nothing when the key is already there, so a request metered in between is
 * counted once, by the meter.
 */
export async function seedAiHostMonthCredits(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  hostIds: readonly string[],
  month: string,
  personCredits: (hostId: string) => number,
): Promise<void> {
  if (!hostIds.length) return
  const monthRef = firestore
    .collection('orgs')
    .doc(orgId)
    .collection('assistUsage')
    .doc(month)
  await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(monthRef)
    const map = (snapshot.exists ? snapshot.get(AI_HOST_CREDITS_FIELD) : null) as
      | Record<string, unknown>
      | null
    const missing = hostIds.filter((hostId) => map?.[hostId] === undefined)
    if (!missing.length) return
    tx.set(
      monthRef,
      {
        month,
        [AI_HOST_CREDITS_FIELD]: Object.fromEntries(
          missing.map((hostId) => [hostId, personCredits(hostId)]),
        ),
      },
      { merge: true },
    )
  })
}

/**
 * Remove a person's allotments on account erasure: `member:{uid}` and every
 * `collab:{hostId}:{uid}`, in each org the erasure names. By path and by a
 * collection-scope equality, so neither needs an index; an org the person
 * had already left keeps a configuration document that names a uid and
 * nothing else, which the next write to that subject replaces.
 */
export async function eraseAiAllotmentsForUser(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  orgIds: readonly string[],
): Promise<number> {
  let removed = 0
  for (const orgId of orgIds) {
    const allotments = await listAiAllotments(firestore, orgId, { uid })
    if (!allotments.length) continue
    const orgRef = firestore.collection('orgs').doc(orgId)
    const batch = firestore.batch()
    for (const allotment of allotments) {
      batch.delete(aiAllotmentRef(orgRef, allotment.subject))
      removed += 1
    }
    await batch.commit()
  }
  return removed
}
