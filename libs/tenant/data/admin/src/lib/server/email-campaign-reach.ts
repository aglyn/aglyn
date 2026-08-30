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
 * Matches `AUDIENCE_SCAN_CEILING` in the sender. See the header for why the
 * two are the same number.
 */
export const CAMPAIGN_REACH_CEILING = 5000

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
