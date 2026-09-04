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
 * WHO ONE EMAIL HAS ALREADY REACHED.
 *
 * An email may be sent more than once — a merchant adds the people who joined
 * the list since it went out, or the ones a bounce kept it from. The single
 * property that makes that safe is that a later send must address nobody an
 * earlier one already reached, and nothing in the send path could answer that
 * question: the delivered addresses were collected for the frequency window
 * and then dropped.
 *
 * ## Why a record of its own, rather than the delivery log
 *
 * `emailDeliveries` looks like the answer and is not. It is populated by the
 * provider WEBHOOK, so it lags the send by seconds to minutes and is missing
 * entirely for a message the provider accepted but has not reported on. A
 * follow-up computed against it would re-mail exactly the people whose events
 * had not landed yet — the one outcome this whole feature must not produce.
 *
 * This record is written by the SENDER, from the addresses it saw
 * `sendEmail` succeed for. It is the send's own account of itself.
 *
 * ## Why keys and not addresses
 *
 * The stored value is {@link emailSuppressionKey} — `sha256` of the
 * normalized address, the same derivation both suppression lists and the
 * frequency window key on. Reusing it rather than adding a second one is the
 * point: a second hash of the same address is how this area came to have two
 * derivations that agreed only by accident.
 *
 * It also means the document is a membership test and not an address list.
 * The send's subcollection is readable by a site member, and a mailing list
 * in the clear under a document the console lists is a thing to not create.
 *
 * ## Why one document, and what bounds it
 *
 * One `arrayUnion` read and one write per send, against a document nothing on
 * the read path opens — as against a document per recipient, which would be
 * 500 writes per send and up to {@link CAMPAIGN_REACH_CEILING} reads per
 * follow-up.
 *
 * The ceiling is the audience scan ceiling the send path already has, and
 * that is not a coincidence: a send cannot resolve more people than that in
 * the first place, so an email whose reach exceeds it has been re-sent enough
 * times to have addressed more people than any one of its audiences can hold.
 * Refusing there keeps the document inside Firestore's 1 MB limit — 5,000
 * 64-character keys is about 330 KB — with the refusal stated rather than a
 * write that starts failing.
 */

import { EMAIL_MAX_AUDIENCE_PER_SEND } from '@aglyn/shared-util-email'
import firebaseAdmin from './firebase-admin'
import { emailSuppressionKey } from './email-suppression'

const defaultFirestore = () => firebaseAdmin.app().firestore()

/**
 * Where the record lives: beside the link rollup, under the send it belongs
 * to.
 *
 * A subcollection document rather than a field on the send, for the reason
 * the link rollup is one — the send document is read by the emails list, the
 * glance widget and the send path, and a set that grows with the audience on
 * it would make every one of those reads larger.
 */
export const CAMPAIGN_REACH_DOC = 'reached'

/** The subcollection the link rollup already uses. */
export const CAMPAIGN_REACH_SUBCOLLECTION = 'reports'

/**
 * The most people one email may reach across all of its sends.
 *
 * The sender's audience read budget, taken from the one place it is stated
 * rather than restated here. See the header for why the two are necessarily
 * the same number: an email cannot reach more people than one resolution of
 * its audience can hold.
 */
export const CAMPAIGN_REACH_CEILING = EMAIL_MAX_AUDIENCE_PER_SEND

function reachDoc(
  hostId: string,
  sendId: string,
  firestore?: any,
): FirebaseFirestore.DocumentReference {
  return (firestore ?? defaultFirestore())
    .collection('hosts')
    .doc(hostId)
    .collection('campaigns')
    .doc(sendId)
    .collection(CAMPAIGN_REACH_SUBCOLLECTION)
    .doc(CAMPAIGN_REACH_DOC)
}

/** The stored document. */
export interface CampaignReachRecord {
  /** `sha256` of each normalized address this email has reached. */
  keys: string[]
  /** `keys.length`, so a reader can size the record without loading it. */
  count: number
  /**
   * `sha256` of each address a send CONSIDERED and did not mail — suppressed,
   * or gone from the topic the email opens on.
   *
   * See {@link readCampaignSettled} for why a batched send needs this and a
   * merchant's follow-up must not read it.
   */
  skipped?: string[]
  /** `skipped.length`, alongside `count` for the same reason. */
  skippedCount?: number
}

/**
 * Everything one send of this email has DECIDED about, either way.
 *
 * `reached` is who got it. `skipped` is who was addressed by a batch, refused
 * by a suppression list or a topic opt-out, and must not consume a slot in
 * every later batch of the same email.
 */
export interface CampaignSettledRecord {
  reached: Set<string>
  skipped: Set<string>
}

/**
 * The keys of everyone this email has reached.
 *
 * FAILS CLOSED — it throws rather than answering "nobody". The asymmetry with
 * {@link readMarketingFrequency}, which fails open, is the same one
 * `filterSendableForHost` draws: a frequency window that cannot be read
 * refuses a message nobody objected to, where a reach record that cannot be
 * read would mail somebody a second copy of a message they already have. A
 * follow-up is a discretionary act a merchant can repeat in a minute; a
 * duplicate in a stranger's inbox is not retractable.
 *
 * @throws when the record cannot be read.
 */
export async function readCampaignReach(
  hostId: string,
  sendId: string,
  firestore?: any,
): Promise<Set<string>> {
  const snapshot = await reachDoc(hostId, sendId, firestore).get()
  const stored = snapshot.exists ? snapshot.get('keys') : null
  if (!Array.isArray(stored)) return new Set<string>()
  return new Set<string>(stored.map((key: unknown) => String(key)))
}

/**
 * Everything one email has decided about, in ONE read.
 *
 * ## Why a batch subtracts more than a follow-up does
 *
 * A merchant's follow-up subtracts {@link readCampaignReach} alone, and that
 * is right: somebody who was suppressed when the email first went out, and
 * has since been released, has never had it and should get it.
 *
 * A BATCH of the same email cannot use that rule, and the reason is the same
 * one that puts the reach subtraction above the per-send cap rather than
 * below it. The cap takes the first N of a stable order. An address the last
 * batch addressed and could not mail is still at the head of that order, so
 * it is selected again, and again, and it consumes a slot every time. A
 * hundred suppressed addresses at the head of a list cost a hundred of every
 * batch's five hundred; five hundred of them stop the campaign dead, having
 * addressed nobody, forever.
 *
 * So a batch subtracts everything the email has SETTLED — mailed or refused —
 * and the frontier advances by the whole cap every time. The distinction is
 * kept in two fields rather than one because the two questions are different
 * and only one of them is "who has this email".
 *
 * FAILS CLOSED, exactly as {@link readCampaignReach} does and for the same
 * reason: a batch that cannot say who it has already mailed must not run.
 *
 * @throws when the record cannot be read.
 */
export async function readCampaignSettled(
  hostId: string,
  sendId: string,
  firestore?: any,
): Promise<CampaignSettledRecord> {
  const snapshot = await reachDoc(hostId, sendId, firestore).get()
  const keys = snapshot.exists ? snapshot.get('keys') : null
  const skipped = snapshot.exists ? snapshot.get('skipped') : null
  const toSet = (stored: unknown) =>
    Array.isArray(stored)
      ? new Set<string>(stored.map((key: unknown) => String(key)))
      : new Set<string>()
  return { reached: toSet(keys), skipped: toSet(skipped) }
}

/**
 * How many addresses this email's record accounts for, either way.
 *
 * The figure {@link CAMPAIGN_REACH_CEILING} bounds. Both halves count,
 * because both halves are stored on the one document Firestore's size limit
 * applies to.
 */
export function campaignSettledSize(settled: CampaignSettledRecord): number {
  return settled.reached.size + settled.skipped.size
}

/**
 * Splits an audience into the people this email has not reached and the count
 * of those it has.
 *
 * An address this cannot key counts as ALREADY REACHED and is dropped. The
 * same posture the read takes: an address whose identity we cannot establish
 * is one we cannot prove we have not already mailed, and both suppression
 * lists refuse it for the same reason.
 */
export function partitionByCampaignReach(
  emails: readonly string[],
  reached: ReadonlySet<string>,
): { unreached: string[]; alreadyReached: number } {
  const unreached: string[] = []
  let alreadyReached = 0
  for (const email of emails) {
    const key = emailSuppressionKey(email)
    if (key && !reached.has(key)) unreached.push(email)
    else alreadyReached += 1
  }
  return { unreached, alreadyReached }
}

/**
 * Adds the addresses a send delivered to, to the email's reach record.
 *
 * `arrayUnion` rather than a read-modify-write: it is atomic, it is
 * idempotent, and two sends of the same email contending would otherwise lose
 * one of their sets — which is a set of people a later follow-up would then
 * mail twice.
 *
 * Returns how many keys were offered, NOT how many were new; the union
 * decides that and does not report it. The caller records the count so a
 * follow-up can check the record covers the send.
 *
 * @throws nothing on a Firestore failure — a send that has already delivered
 * must not be turned into an error by its own bookkeeping. The COVERAGE check
 * in {@link campaignReachCovers} is what catches a lost write, by refusing
 * the follow-up rather than by pretending the record is whole.
 */
export async function recordCampaignReach(
  hostId: string,
  sendId: string,
  emails: readonly string[],
  firestore?: any,
): Promise<number> {
  const keys = [
    ...new Set(
      emails
        .map((email) => emailSuppressionKey(email))
        .filter((key): key is string => Boolean(key)),
    ),
  ]
  if (!keys.length || !hostId || !sendId) return 0
  try {
    await reachDoc(hostId, sendId, firestore).set(
      {
        keys: firebaseAdmin.firestore.FieldValue.arrayUnion(...keys),
        count: firebaseAdmin.firestore.FieldValue.increment(keys.length),
      },
      { merge: true },
    )
    return keys.length
  } catch (error) {
    console.error('[email-campaign-reach] reach record failed', error)
    return 0
  }
}

/**
 * Adds the addresses a send CONSIDERED and did not mail.
 *
 * The same document, the same `arrayUnion` and the same never-throws posture
 * as {@link recordCampaignReach}, under a field of its own so that a
 * merchant's follow-up and an automatic batch can read different questions
 * off one record. A failed write costs a later batch a repeated suppression
 * lookup and nothing else — nobody is mailed twice by it, because the
 * addresses in here are the ones nothing may mail at all.
 */
export async function recordCampaignSkipped(
  hostId: string,
  sendId: string,
  emails: readonly string[],
  firestore?: any,
): Promise<number> {
  const keys = [
    ...new Set(
      emails
        .map((email) => emailSuppressionKey(email))
        .filter((key): key is string => Boolean(key)),
    ),
  ]
  if (!keys.length || !hostId || !sendId) return 0
  try {
    await reachDoc(hostId, sendId, firestore).set(
      {
        skipped: firebaseAdmin.firestore.FieldValue.arrayUnion(...keys),
        skippedCount: firebaseAdmin.firestore.FieldValue.increment(keys.length),
      },
      { merge: true },
    )
    return keys.length
  } catch (error) {
    console.error('[email-campaign-reach] skipped record failed', error)
    return 0
  }
}

/**
 * Whether the reach record accounts for every message this email has sent.
 *
 * The one guard standing between a lost bookkeeping write and a duplicate in
 * somebody's inbox. `sent` is the send document's own delivered total, and
 * the reach record holds one key per delivered message — a recipient cannot
 * be addressed twice by one send, because the audience is deduplicated, and
 * cannot be addressed twice ACROSS sends, because that is the property this
 * record exists to hold. So the two numbers agree exactly, and a record that
 * is short is a record that is missing somebody.
 *
 * It also answers correctly for every email sent before this record existed:
 * no document, `0` keys, a non-zero `sent`, and the follow-up is refused —
 * which is right, because nobody can say who that send reached.
 */
export function campaignReachCovers(
  reached: ReadonlySet<string>,
  sent: number,
): boolean {
  const delivered = Number(sent)
  if (!Number.isFinite(delivered) || delivered <= 0) return true
  return reached.size >= delivered
}
