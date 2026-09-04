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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
// From the LEAVES: the barrel reaches the admin SDK and route specs mock it
// wholesale. A mocked-away resolver silently answers "no subject", which is
// indistinguishable from the refusal-to-guess this module now relies on.
import { attributableAccountForAddress } from '@aglyn/tenant-data-admin/server/account-addresses'
import { emailSuppressionKey } from '@aglyn/tenant-data-admin/server/email-suppression'

/**
 * THE STAFF AUDIT TRAIL: WHO A ROW IS ABOUT, AND HOW MANY TIMES IT HAPPENED.
 *
 * `adminAudit` is not a convenience log. Firestore rules close
 * `emailDeliveries` to EVERYONE, staff included, and the console route is
 * allowed to read it only because it establishes a staff claim and records
 * who looked. The row this module writes is that compensating control, so
 * the two properties it exists to provide are:
 *
 *  1. **No access is lost.** Two views minutes apart are two accesses. A
 *     collapse that dropped one would answer "nobody read your mail" about a
 *     read that happened, which is the single failure this collection cannot
 *     have.
 *  2. **The subject is answerable.** `target` names the THING acted on; it
 *     cannot also name the person, because a message id is not a user path.
 *     `subjectUid` is the separate fact, and it is what makes "who at Aglyn
 *     read my email" a query rather than a manual trawl.
 */

export const ADMIN_AUDIT_COLLECTION = 'adminAudit'

/**
 * How close together two identical acts must be to count as ONE act
 * recorded twice.
 *
 * A single click can reach this writer more than once — a re-run effect, a
 * retried request, a double submit — and each arrival is the same access.
 * Ten seconds sits an order of magnitude above that (the observed re-entry
 * was one second apart) and well below a person deliberately re-opening a
 * record (observed at fifty-three seconds). Nothing a human does twice on
 * purpose lands inside it.
 *
 * ⚠️ A collapse still RECORDS the repeat: `repeatCount` and `lastAt` carry
 * it, and the console renders both. Widening this window trades away the
 * separateness of two accesses, so it must stay far shorter than the
 * interval at which a second look is a second decision.
 */
export const ADMIN_AUDIT_DEDUPE_WINDOW_MS = 10_000

/** Access looked at data; change altered something or acted on someone. */
export type AdminAuditKind = 'access' | 'change'

/**
 * The actions that only LOOKED.
 *
 * An exception list, not a classification of everything, and the default
 * matters more than the membership: anything absent is a `change`. A change
 * is the louder half of the console's audit card, so an action nobody has
 * classified yet gets the MORE prominent treatment rather than the quieter
 * one. The failure mode of the opposite default is an unclassified
 * impersonation rendering as routine browsing.
 *
 * An export is deliberately NOT here. Data leaving the platform is a
 * high-consequence act even though it mutates nothing, and it belongs beside
 * the impersonations rather than beside the record views.
 */
const ADMIN_AUDIT_ACCESS_ACTIONS: ReadonlySet<string> = new Set([
  'email.message-viewed',
])

export function adminAuditKind(
  action: string | null | undefined,
): AdminAuditKind {
  return action && ADMIN_AUDIT_ACCESS_ACTIONS.has(action) ? 'access' : 'change'
}

export interface AdminAuditWrite {
  /** The staff account performing the act. */
  actorUid: string
  action: string
  /** The THING acted on, as a path or a stable identifier. */
  target: string
  /**
   * The person the act is ABOUT, when one can be resolved.
   *
   * Absent is a correct answer, not a failure: a recipient may be a site
   * member, a prospect or a bare address with no platform account behind it,
   * and inventing a uid for one of those would put an act on an innocent
   * person's page.
   */
  subjectUid?: string | null
  /**
   * `sha256` of the recipient address the act was about, when it had one.
   *
   * ## Why a hash and not the address
   *
   * The SAME derivation `emailSuppressionKey` uses, so this joins the
   * delivery log without a second key space. It is hashed for the reason
   * {@link maskEmailAddress} exists: `adminAudit` is readable by any staff
   * role, and a dump of it must not yield a mailing list.
   *
   * ## Why it exists at all, next to `subjectUid`
   *
   * `subjectUid` can only be written when the address resolves to exactly one
   * account, and an address is not reliably resolvable to one — a
   * provider-supplied address may be held by a second account with nothing
   * recording it. So the subject is now OMITTED whenever the answer is
   * ambiguous, and omitting it alone would make the access invisible on every
   * page, which is worse than the guess it replaced.
   *
   * This is the fact that needs no guess. The account page queries it with
   * the keys of every address that account holds, so one access appears on
   * the page of each account holding the address — which is the honest answer
   * when the mail went to a mailbox rather than to a uid.
   *
   * ## It opens no tier side-door
   *
   * `adminAudit` is `allow read, create: if isStaff()` with NO tier gate, so
   * anything written here is readable by every staff session whatever its
   * role — which makes an audit row a way around a tier restriction on the
   * surface the value came from. Checked, and it is not one here: the writer
   * is the message route, which gates on `staff` alone and nothing finer, so
   * this field is no more widely readable than its source.
   *
   * The hash adds no reach of its own either. It is the document id
   * `emailDeliveries` is already filed under, so any staff session that can
   * read this row could already derive the same value from an address it
   * guessed. A field whose source DID restrict by tier would not belong here.
   */
  subjectAddressKey?: string | null
  /** Human-readable context. ⚠️ Never a raw address — see `maskEmailAddress`. */
  note?: string | null
}

function toDate(value: unknown): Date | null {
  const converted = (value as { toDate?: () => Date } | null)?.toDate?.()
  if (converted instanceof Date) return converted
  return value instanceof Date ? value : null
}

/**
 * Write one audit row, collapsing an immediate repeat of the same act onto
 * the row already there.
 *
 * The candidate is the MOST RECENT row on the same target, which the live
 * `target ASC, at DESC` index already answers — so this costs one indexed
 * single-document read and needs no index of its own. Anything else landing
 * on that target in between ends the run, which is the conservative
 * direction: an interleaved act means the two views were not one action.
 *
 * The read and the write are one TRANSACTION because the duplicates this
 * exists to catch are CONCURRENT. Two requests from one click race each
 * other; a plain read-then-write would let both see "nothing recent" and
 * both insert, defeating the collapse exactly when it is needed.
 */
export async function recordAdminAudit(entry: AdminAuditWrite): Promise<void> {
  const firestore = firebaseAdmin.app().firestore()
  const collection = firestore.collection(ADMIN_AUDIT_COLLECTION)
  const now = new Date()
  const mostRecentOnTarget = collection
    .where('target', '==', entry.target)
    .orderBy('at', 'desc')
    .limit(1)

  await firestore.runTransaction(async (transaction) => {
    const previous = (await transaction.get(mostRecentOnTarget)).docs[0]
    const previousAt = previous
      ? (toDate(previous.get('lastAt')) ?? toDate(previous.get('at')))
      : null
    const sameAct =
      !!previous &&
      previous.get('actorUid') === entry.actorUid &&
      previous.get('action') === entry.action
    /*
     * Absolute distance, because the rows this compares against are not all
     * written with the same clock: most writers use a server timestamp and
     * this one uses the request's own instant, so a neighboring row can
     * carry a moment slightly ahead of `now`. A signed comparison would read
     * that as "not recent" and stop collapsing.
     */
    const withinWindow =
      !!previousAt &&
      Math.abs(now.getTime() - previousAt.getTime()) <=
        ADMIN_AUDIT_DEDUPE_WINDOW_MS

    if (previous && sameAct && withinWindow) {
      transaction.update(previous.ref, {
        repeatCount: (Number(previous.get('repeatCount')) || 1) + 1,
        lastAt: now,
      })
      return
    }

    transaction.create(collection.doc(), {
      actorUid: entry.actorUid,
      action: entry.action,
      target: entry.target,
      /*
       * OMITTED rather than null when there is nobody to name. The subject
       * query is `where('subjectUid','==',uid).orderBy('at','desc')`, which
       * matches only documents that HAVE the field — so leaving it out keeps
       * the index to the rows that can actually answer a subject question.
       */
      ...(entry.subjectUid ? { subjectUid: entry.subjectUid } : {}),
      // Omitted rather than null on the same reasoning as `subjectUid`: the
      // address query matches only documents that HAVE the field.
      ...(entry.subjectAddressKey
        ? { subjectAddressKey: entry.subjectAddressKey }
        : {}),
      note: entry.note ?? null,
      at: now,
      /*
       * `lastAt` and `repeatCount` are set on the FIRST write, not added on
       * the first repeat. A reader that has to treat a missing field as "one,
       * at `at`" will eventually forget to, and the row it gets wrong is the
       * row that says how often somebody looked.
       */
      lastAt: now,
      repeatCount: 1,
    })
  })
}

/**
 * An address a human can recognize without the log holding the address.
 *
 * `emailDeliveries` is keyed by `sha256(address)` precisely so we do not keep
 * a readable list of who we mail. An audit row echoing the address in the
 * clear made this collection the less careful of the two for the same data,
 * and `adminAudit` is readable by any staff role.
 *
 * The first character and the domain survive because an audit entry a human
 * cannot read is a weaker control: a staffer checking their own access, or an
 * investigator confirming which of a shortlist was opened, needs to recognize
 * the row. What does not survive is the harvestable part — a dump of this
 * collection yields no mailing list.
 */
export function maskEmailAddress(address: string | null | undefined): string {
  const trimmed = String(address ?? '').trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return '***'
  return `${trimmed.slice(0, 1)}***@${trimmed.slice(at + 1)}`
}

/** Every recipient, masked, in one note-sized string. */
export function maskEmailAddresses(
  addresses: readonly string[] | null | undefined,
): string {
  return (addresses ?? []).map(maskEmailAddress).join(', ')
}

/**
 * The uid behind a recipient address, or null when there is not one.
 *
 * Across POOLS, not the project pool alone: an enterprise account signing in
 * through GCIP lives in a tenant, and a project-pool `getUserByEmail` would
 * report the customer most in need of this record as "not a user".
 *
 * Null is a real answer. Most addresses we send to belong to site members,
 * prospects and plain contacts with no platform account, and this must never
 * guess one for them.
 */
export async function resolveSubjectUidByEmail(
  address: string | null | undefined,
): Promise<string | null> {
  const email = String(address ?? '').trim()
  if (!email) return null
  try {
    /*
     * AMBIGUITY RESOLVES TO NOBODY.
     *
     * This was `findUserByEmailAcrossPools(...).uid` — the first account
     * whose PRIMARY matched. That is a guess whenever a second account holds
     * the same address, which is a real shape: a federated provider's address
     * never entered the uniqueness index, so an account can hold one that is
     * also somebody else's primary with nothing recording the clash.
     *
     * `attributableAccountForAddress` returns null for "more than one" as
     * well as for "nobody". Both are the same instruction to this writer:
     * name no subject. A row naming the wrong customer is not a weaker answer
     * to "who read my data" — it is a false one, and it puts one customer's
     * name on another's data access.
     *
     * The access is still reachable: `subjectAddressKey` carries the hashed
     * recipient, and the account page finds it from the addresses it holds.
     */
    return await attributableAccountForAddress(email)
  } catch {
    // A lookup that could not run leaves the row without a subject, which is
    // the same answer as "no account" and is safe: it under-reports rather
    // than attributing an access to the wrong person.
    return null
  }
}

/**
 * The hashed recipient for {@link AdminAuditWrite.subjectAddressKey}.
 *
 * The FIRST recipient, matching `resolveSubjectUidForRecipients` — one scalar
 * cannot represent a multi-recipient message, and the masked note carries the
 * full list either way.
 */
export function subjectAddressKeyForRecipients(
  addresses: readonly string[] | null | undefined,
): string | null {
  for (const address of addresses ?? []) {
    const key = emailSuppressionKey(address)
    if (key) return key
  }
  return null
}

/**
 * The first recipient with a platform account.
 *
 * A single scalar subject cannot represent a message sent to several people,
 * and multi-recipient system mail is rare enough that an array field plus its
 * own `array-contains` index would be carried by every writer to serve almost
 * no rows. The full (masked) recipient list stays on the note, so a row for a
 * multi-recipient message still shows that the others were involved.
 */
export async function resolveSubjectUidForRecipients(
  addresses: readonly string[] | null | undefined,
): Promise<string | null> {
  for (const address of addresses ?? []) {
    const uid = await resolveSubjectUidByEmail(address)
    if (uid) return uid
  }
  return null
}
