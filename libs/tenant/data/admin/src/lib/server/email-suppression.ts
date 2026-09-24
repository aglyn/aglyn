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
 * The PLATFORM-WIDE email suppression list, `emailSuppressions/{emailKey}`
 * (AGL-2407).
 *
 * ## What was missing
 *
 * AGL-1918 (`7a8f3cd68`) made `email.bounced` (permanent) and
 * `email.complained` write a suppression — into `hosts/{hostId}/suppressions`,
 * found from a Resend tag that only `campaign-send.ts` stamped. That closed
 * the campaign half and could close no other, because there was nowhere to
 * file the rest:
 *
 * Every other sender in the product goes through the shared `sendEmail` —
 * invites,
 * password resets, verification, receipts, booking confirmations, the monthly
 * usage summary, the usage-alert fan-out, restock and abandoned-cart mail, the
 * merchant-authored workflow `sendEmail` step. A bounce on any of those
 * arrived at the webhook with no site to place it against and was answered
 * `200 {ignored:true}`. A dead address was re-mailed on every subsequent send,
 * forever, and a spam complaint had no effect on anything.
 *
 * That matters most exactly when it is hardest to fix: on Sept 1 the signup
 * door opens, and verification and invite mail — addressed by strangers typing
 * addresses — is the highest-bounce-rate mail we send, on the same Resend key
 * and the same From address as everything else.
 *
 * ## Why a sibling of `contactSuppressions` and not a channel on it
 *
 * `contact-suppression.ts` is the same idea for phones and every argument it
 * makes holds here: keyed on the identifier because that is what the sender
 * holds at send time; one `get()` by document id, no query and no composite
 * index that could go missing and fail the lookup open; a revocation is a
 * FIELD and not a delete, because the record is the evidence that the
 * suppression was honoured while it was in force.
 *
 * It is a separate collection for one concrete reason: the document id. That
 * list's key is the E.164 digits, and its docblock argues at length that a
 * phone number must NOT be hashed (NANP is ~10^10 values, so a hash buys the
 * appearance of de-identification and none of the substance). An email address
 * is not enumerable, `hosts/{hostId}/suppressions` already keys on
 * `sha256(email)`, and one collection holding two incompatible key spaces is
 * how a lookup comes to be performed against the wrong derivation. The
 * address is stored in the document in the clear regardless, exactly as the
 * per-host list stores it, so a staff reader still shows a human something
 * they can act on.
 *
 * ## Who reads it, and who deliberately does NOT
 *
 * AGL-1438's rule is that a QUOTA may only ever refuse a campaign, because
 * refusing a receipt or a password reset converts a billing event into an
 * outage on a customer's business. A suppression is not a quota, but the same
 * proportionality applies and lands in the same place:
 *
 *  - **Bulk mail consults this list.** The monthly usage summary, the
 *    usage-alert fan-out and the marketplace review fan-out to a publisher's
 *    owners and admins go to a LIST of people who did not ask for that
 *    particular message, on a schedule or on every submission, forever. They
 *    are the sends that re-hit a dead mailbox every month and teach a mailbox
 *    provider that `aglyn.com` does not listen.
 *  - **Transactional mail does NOT.** A password reset, a verification, an
 *    invite, a receipt or a booking confirmation answers something the human
 *    just did. Refusing one because an address bounced or because somebody
 *    once pressed "report spam" on an unrelated message would lock a real
 *    customer out of their own account. The shared sender is therefore left
 *    unconditional on purpose, and this is the note that says so.
 *
 * (Written throughout without a literal call expression, on purpose:
 * `email-send-metering-coverage.spec.ts` enumerates senders by grepping the
 * tree for one, and a prose mention here would enrol a module that sends
 * nothing into the AGL-1438 cost-meter sweep.)
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
// The leaf entry, not the `@aglyn/aglyn` barrel, for the reason
// `document-id.ts` gives at length: a barrel import resolves to whatever a
// spec's `jest.mock` happens to contain, and this module's neighbours are
// mocked in nearly every spec that touches them.
import {
  consentGroupOptOutHosts,
  consentGroupTopicState,
  type ConsentGroup,
} from '@aglyn/aglyn/app-utils/consent-groups'
import {
  readTopicSubscriptionState,
  TOPIC_OPT_OUTS_SUBCOLLECTION,
} from '@aglyn/aglyn/app-utils/email-topics'
import { nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { stampRecordEmailState } from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import firebaseAdmin from './firebase-admin'

const defaultFirestore = () => firebaseAdmin.app().firestore()

export const EMAIL_SUPPRESSIONS_COLLECTION = 'emailSuppressions'

/**
 * The PER-SITE list, `hosts/{hostId}/suppressions/{emailKey}` — unsubscribes
 * from one site's campaigns, plus the bounces and complaints that arrived
 * carrying that site's tag.
 *
 * Named here rather than at each call site because the two lists are read
 * together by {@link filterSendableForHost}, and a sender that knows one path
 * as a string literal and the other through this module is one rename away
 * from consulting a collection that does not exist and finding nobody
 * suppressed.
 */
export const HOST_SUPPRESSIONS_SUBCOLLECTION = 'suppressions'

/**
 * Why an address is suppressed.
 *
 * `bounce` means PERMANENT only. Resend reports `data.bounce.type` as
 * `Permanent` or `Transient`, and a transient bounce is a full mailbox or a
 * greylisting server — recording one here would suppress a real recipient over
 * a temporary condition at their provider. The webhook makes that distinction;
 * this type only names the outcome.
 */
export type EmailSuppressionReason =
  /** Permanent bounce — the mailbox does not exist. */
  | 'bounce'
  /** The recipient pressed "report spam". */
  | 'complaint'
  /** Recorded by staff (a written request, a court order, a correction). */
  | 'staff'

/**
 * The reasons that may be filed PLATFORM-WIDE, as a runtime set.
 *
 * ## The split this constant enforces
 *
 * A bounce and a complaint are facts about a MAILBOX and about the sending
 * domain every tenant's mail leaves by: the address does not exist for
 * anybody, and somebody who pressed "report spam" on `noreply@aglyn.com` has
 * told every sender behind that domain at once. Those belong everywhere,
 * immediately.
 *
 * An UNSUBSCRIBE is not that. It is a preference a person expressed to ONE
 * brand — the sender line they read, the newsletter they joined — and an
 * agency running twelve unrelated clients out of one account would, on a
 * platform-wide entry, stop mailing that person on behalf of eleven brands
 * they never heard from. So an unsubscribe lives only in
 * `hosts/{hostId}/suppressions`, and {@link suppressEmail} refuses it.
 *
 * ## Why a runtime refusal and not just the type
 *
 * {@link EmailSuppressionReason} already excludes it, and a type is not a
 * guard: every caller here builds its reason from a webhook payload or a
 * ternary, `as` casts exist, and the plugin API surface is untyped at the
 * boundary. The cost of the type being wrong once is an opt-out from one
 * brand silently applied to every brand in the account, which is invisible
 * from the console — the mail simply never arrives, and the merchant's own
 * suppression list does not mention it.
 */
export const PLATFORM_SUPPRESSION_REASONS: readonly EmailSuppressionReason[] = [
  'bounce',
  'complaint',
  'staff',
]

/**
 * The reason a self-service opt-out is filed under, on the PER-SITE list.
 *
 * Named because three call sites compare against it — the unsubscribe writes
 * it, the resubscribe link refuses to reverse anything else, and the
 * preference page reads it to decide whether an address may opt back in. A
 * literal in three places is a literal that can be changed in two.
 */
export const UNSUBSCRIBE_SUPPRESSION_REASON = 'unsubscribe'

export interface EmailSuppressionRecord {
  /** The address, in the clear, lowercased. The id is its hash. */
  email: string
  reason: EmailSuppressionReason
  /**
   * The `context` tag the send carried (`'invite'`, `'usage-summary'`,
   * `'campaign'`, …), so a human reading the list can tell which of our
   * senders produced the address that died. Null when the send carried none.
   */
  context: string | null
  /** The site the failure was attributed to, when the send named one. */
  hostId: string | null
  /** Non-null once released. A released record does not suppress. */
  releasedAt: unknown | null
  /**
   * `releasedAt` as a boolean, which the staff list filters by EQUALITY
   * beneath its `suppressedAt` cursor: "released" read from `releasedAt`
   * would be `!= null`, an inequality Firestore makes the first sort.
   * Absent on records written before it existed until
   * `tools/scripts/backfill-email-suppression-filters.mjs` stamps them.
   */
  released?: boolean
  /** Search tokens for the address; see {@link emailSearchTokens}. */
  emailTokens?: string[]
  /** What lifted it. Absent on records written before releases were typed. */
  releasedVia?: EmailReleaseChannel
  /** The site whose confirmed double opt-in lifted it, when one did. */
  releasedHostId?: string | null
  /** The stream that was confirmed, likewise. */
  releasedTopicId?: string | null
}

/**
 * Document id for an address: `sha256` of the lowercased, trimmed form.
 *
 * The SAME derivation `campaign-send.ts` uses for `hosts/{hostId}/suppressions`
 * — deliberately, so the two lists can never disagree about which document
 * describes which person.
 *
 * @returns the id, or `null` for anything that is not an address. Never a
 *          best-guess id: suppressing the wrong person and believing you
 *          suppressed the right one is worse than refusing.
 */
export function emailSuppressionKey(
  email: string | null | undefined,
): string | null {
  /*
   * Delegated, not reimplemented. A second hash of the same address is how
   * this area got two derivations that agreed only by accident; `personKey`
   * is the one that normalizes and the one the unsubscribe route already
   * hashes through, so a suppression filed by either is found by both.
   */
  return personKey(email)
}

/**
 * The `array-contains` search tokens for an address.
 *
 * Every prefix, up to `NAME_TOKEN_MAX_PREFIX` characters, of each of: the
 * whole address, the domain, the domain behind an `@`, and each piece of the
 * local part and of the domain. So `jane.doe@mail.example.com` is found by
 * `jane`, `doe`, `jane.doe@ma`, `example`, `example.com`, `mail.example` and
 * `@mail`. A query becomes one token through `nameSearchToken`, which caps
 * it at the same length, so a typed address longer than that narrows by its
 * first twelve characters rather than matching nothing.
 *
 * Mirrored by `tools/scripts/backfill-email-suppression-filters.mjs`, which
 * stamps the records written before this field existed; the two share the
 * same fixtures.
 */
export function emailSearchTokens(email: string | null | undefined): string[] {
  const address = String(email ?? '')
    .trim()
    .toLowerCase()
  if (!address) return []
  const at = address.lastIndexOf('@')
  const local = at === -1 ? address : address.slice(0, at)
  const domain = at === -1 ? '' : address.slice(at + 1)
  const words = [
    address,
    ...(domain ? [domain, `@${domain}`] : []),
    ...local.split(/[._+-]+/),
    ...domain.split('.'),
  ]
  return nameSearchTokens(words.filter(Boolean).join(' '))
}

export interface SuppressEmailInput {
  email: string
  reason: EmailSuppressionReason
  /** The `context` tag the failed send carried, when it carried one. */
  context?: string | null
  /** The site the failed send was attributed to, when it named one. */
  hostId?: string | null
  /**
   * Whether to say so on the person's record too (AGL-3245); on by default.
   * A sender that stamps a richer verdict of its own passes `false`.
   */
  stampRecord?: boolean
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
}

/**
 * Record a platform-wide suppression. Idempotent by document id.
 *
 * `createdAt` is stamped only when the document is new, matching the per-host
 * list: a second bounce must not overwrite the moment the address first went
 * bad, because that is the date a human is told when they ask. `suppressedAt`
 * moves every time, so "when did we last see this fail" stays answerable.
 *
 * A previously released record is un-released — a fresh failure is a fresh
 * failure.
 *
 * @returns `created: false` when the address was already on the list.
 */
export async function suppressEmail(input: SuppressEmailInput): Promise<{
  key: string
  created: boolean
}> {
  const key = emailSuppressionKey(input.email)
  if (!key) {
    throw new Error('[email-suppression] cannot key a suppression for that value')
  }
  if (!PLATFORM_SUPPRESSION_REASONS.includes(input.reason)) {
    throw new Error(
      `[email-suppression] ${input.reason} is a per-site preference and ` +
        'cannot be filed platform-wide',
    )
  }
  const db = input.firestore ?? defaultFirestore()
  const ref = db.collection(EMAIL_SUPPRESSIONS_COLLECTION).doc(key)
  const snapshot = await ref.get()
  const email = String(input.email).trim().toLowerCase()
  await ref.set(
    {
      email,
      emailTokens: emailSearchTokens(email),
      reason: input.reason,
      context: input.context ?? null,
      hostId: input.hostId ?? null,
      releasedAt: null,
      released: false,
      suppressedAt: FieldValue.serverTimestamp(),
      ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  )
  /*
   * The same verdict on the record the person reads (AGL-3245), through
   * whichever plugin keeps the workspace's records: a bounce or a complaint
   * on a send that named a site stamps the site's records. A send that
   * named none has no records to find, and a caller that stamps its own,
   * richer verdict — the sequence runtime, with the domain block and the
   * enrollment — says `stampRecord: false` and is left to it.
   */
  if (input.hostId && input.stampRecord !== false && input.reason !== 'staff') {
    await stampRecordEmailState({
      hostId: input.hostId,
      email: input.email,
      state: {
        status: input.reason === 'complaint' ? 'complained' : 'bounced',
        atMs: Date.now(),
        source: 'campaign',
        detail: input.context ? `Reported by the ${input.context} send.` : null,
      },
    })
  }
  return { key, created: !snapshot.exists }
}

/**
 * What lifted a suppression, recorded on the record it lifted.
 *
 * Written explicitly by both paths rather than left to "absent means staff".
 * The two are held to different rules — a staff release may lift any reason,
 * a confirmed opt-in may lift exactly one — so the audit answer to "how did
 * this address get back on the domain" has to be a stored fact and not an
 * inference from which field happens to be missing.
 */
export type EmailReleaseChannel =
  /** A staff correction through the admin suppressions surface. */
  | 'staff'
  /** A recipient completed a double opt-in from this address. */
  | 'double-opt-in'

/**
 * Put an address back in circulation (a staff correction, or the person asking
 * to be re-added). The record is kept and marked released, never deleted —
 * same reasoning as `releasePhoneContact`: a deleted record cannot show that
 * the suppression was honored while it stood.
 *
 * Unconditional on the reason, and that is what separates it from
 * {@link releaseEmailForConfirmedOptIn}: a human with the staff role has read
 * the record and is accountable for the row, so they may lift a complaint —
 * a report filed against the wrong message, an address entered by mistake.
 * Nothing automatic gets that latitude.
 *
 * @returns false when there was no live record to release.
 */
export async function releaseEmail(input: {
  email: string
  releasedByUid?: string | null
  note?: string | null
  firestore?: any
}): Promise<boolean> {
  const key = emailSuppressionKey(input.email)
  if (!key) return false
  const db = input.firestore ?? defaultFirestore()
  const ref = db.collection(EMAIL_SUPPRESSIONS_COLLECTION).doc(key)
  const snapshot = await ref.get()
  if (!snapshot.exists || snapshot.get('releasedAt')) return false
  await ref.set(
    {
      releasedAt: FieldValue.serverTimestamp(),
      released: true,
      releasedByUid: input.releasedByUid ?? null,
      releasedNote: input.note ?? null,
      releasedVia: 'staff' satisfies EmailReleaseChannel,
    },
    { merge: true },
  )
  return true
}

/**
 * The ONLY reason a completed round trip may lift, as a runtime set.
 *
 * ## Why a bounce is releasable
 *
 * A `bounce` record is a claim about a MAILBOX at a moment: mail addressed
 * here was permanently refused. Somebody clicking a confirmation link that
 * was delivered to that mailbox has refuted the claim with the only evidence
 * that could refute it — the message arrived, a human read it, and the round
 * trip closed. Leaving the record standing after that makes one transient
 * failure recorded as permanent — a mailbox that was full, a receiving server
 * that answered 550 while it was misconfigured — a life sentence no route can
 * undo.
 *
 * ## Why a complaint is NOT, and never will be
 *
 * `complaint` is not a deliverability fact. It is a person stating they do not
 * want this mail, and a round trip proves nothing about that statement — it
 * proves the mailbox works, which nobody doubted. Releasing one here would
 * make a public signup form into a laundry for spam complaints: submit the
 * complainant's address, they receive a confirmation (the shared sender is
 * transactional and consults no list), and one click anywhere in the chain
 * puts them back on the sending domain that the complaint was filed against.
 * The same reasoning refuses `staff`, which is a written request, a
 * correction, or a legal instruction, and is nobody's to reverse from a link.
 *
 * A runtime set and not just the type, for the reason
 * {@link PLATFORM_SUPPRESSION_REASONS} gives: reasons arrive from webhook
 * payloads through an untyped boundary, and the cost of the type being wrong
 * once here is a complaint silently laundered.
 */
export const OPT_IN_RELEASABLE_REASONS: readonly EmailSuppressionReason[] = [
  'bounce',
]

/** What a completed double opt-in did to a platform suppression. */
export type ConfirmedOptInRelease =
  /** A live `bounce` record was lifted. The address is mailable again. */
  | 'released'
  /** Nothing was suppressed, or it was already released. */
  | 'nothing-to-release'
  /** A record stands that a round trip may not lift — see the constant. */
  | 'refused'
  /** The read or the write failed. The record, whatever it is, still stands. */
  | 'failed'

/**
 * Lift a platform suppression that a completed double opt-in has disproved.
 *
 * THE ONE PLACE THE AUTOMATIC RULE IS STATED, mirroring
 * `releaseSiteSuppression` for the per-site list: every path that puts an
 * address back in circulation without a human deciding goes through here, so
 * there is one line to read and one line to change.
 *
 * ## Platform-wide, from one site's round trip
 *
 * The record being lifted asserts something host-independent — this mailbox
 * does not exist, learned anywhere in the product, including on transactional
 * mail that carried no site tag. A confirmation delivered to that mailbox
 * disproves it just as host-independently, so scoping the release to the
 * confirming site would leave a record standing that says the mailbox is dead
 * while we hold proof that it is not. The site and the topic are written onto
 * the record instead, which is what makes the release reviewable: an operator
 * reading the row sees which site's round trip lifted it and when.
 *
 * ## The per-site list is NOT touched
 *
 * `hosts/{hostId}/suppressions` mixes a deliverability fact with a stated
 * preference — an unsubscribe from that one site lives there too — and the
 * email plugin's `releaseSiteSuppression` is the single guarded path that
 * lifts one. Reaching around it from here would put a second, differently
 * reasoned releaser on a list whose whole protection is that there is one.
 *
 * Never throws: it runs inside a recipient's confirmation click, and a
 * Firestore failure must degrade to a suppression that stays in force, not to
 * a person told their confirmation failed.
 */
export async function releaseEmailForConfirmedOptIn(input: {
  email: string
  /** The site whose confirmation link was clicked, for the audit trail. */
  hostId: string
  /** The stream that was confirmed, likewise. */
  topicId: string
  firestore?: any
}): Promise<ConfirmedOptInRelease> {
  const key = emailSuppressionKey(input.email)
  if (!key) return 'nothing-to-release'
  try {
    const db = input.firestore ?? defaultFirestore()
    const ref = db.collection(EMAIL_SUPPRESSIONS_COLLECTION).doc(key)
    const snapshot = await ref.get()
    if (!snapshot.exists || snapshot.get('releasedAt')) {
      return 'nothing-to-release'
    }
    if (!OPT_IN_RELEASABLE_REASONS.includes(snapshot.get('reason'))) {
      return 'refused'
    }
    await ref.set(
      {
        releasedAt: FieldValue.serverTimestamp(),
        released: true,
        // No human released this, so the field says so rather than naming
        // whoever last touched the record.
        releasedByUid: null,
        releasedVia: 'double-opt-in' satisfies EmailReleaseChannel,
        releasedHostId: input.hostId || null,
        releasedTopicId: input.topicId || null,
      },
      { merge: true },
    )
    return 'released'
  } catch (error) {
    console.error(
      '[email-suppression] opt-in release failed; suppression stands',
      error,
    )
    return 'failed'
  }
}

/**
 * The BULK-SEND gate. See the module note for which senders must call this and
 * which must not.
 *
 * FAILS CLOSED, like `isPhoneContactSuppressed`: a read that throws answers
 * `true`, meaning "treat as suppressed". The cost of failing closed here is
 * one delayed informational email — every caller is a cron that runs again —
 * and it is nearly free besides, because every one of them is already deep
 * inside a Firestore-backed sweep that a Firestore outage has stopped anyway.
 * The cost of failing open is another delivery attempt at a mailbox that has
 * already told us permanently that it does not exist, which is precisely the
 * behaviour a provider scores a sending domain on. Never "fix" a flaky read
 * here by returning false.
 */
export async function isEmailSuppressed(
  email: string | null | undefined,
  injectedFirestore?: any,
): Promise<boolean> {
  const key = emailSuppressionKey(email)
  // An unusable value is one we cannot check against the list, so it is one we
  // must not send to. Same fail-closed rule.
  if (!key) return true
  try {
    const db = injectedFirestore ?? defaultFirestore()
    const snapshot = await db
      .collection(EMAIL_SUPPRESSIONS_COLLECTION)
      .doc(key)
      .get()
    if (!snapshot.exists) return false
    return !snapshot.get('releasedAt')
  } catch (error) {
    console.error('[email-suppression] lookup failed; failing closed', error)
    return true
  }
}

/**
 * The sendable subset of a recipient list, for the bulk senders.
 *
 * One `get()` per DISTINCT address rather than a query, so the check needs no
 * index and cannot fail open on a missing one. The list is deduplicated first
 * because the callers build it by fanning out over an org's owners and admins,
 * which routinely names the same person twice.
 */
export async function filterSuppressedEmails(
  emails: readonly string[],
  injectedFirestore?: any,
): Promise<string[]> {
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const email of emails) {
    const normalized = String(email ?? '')
      .trim()
      .toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    candidates.push(normalized)
  }
  const verdicts = await Promise.all(
    candidates.map((email) => isEmailSuppressed(email, injectedFirestore)),
  )
  return candidates.filter((_email, index) => !verdicts[index])
}

/*==========================================
 * THE SENDER A PERSON LEAVES IS THE CONSENT GROUP, NOT THE SITE.
 *
 * `consent-groups.ts` lets an org declare several sites ONE sender — a shop,
 * a booking page and a blog under one name, disclosed as one on every
 * capture form. To the person on the other end those are one sender, so
 * leaving any of them is leaving it: an unsubscribe filed by site A has to
 * withhold site B's mail too, or the recipient is made to unsubscribe once
 * per site of a sender they only ever knew as one.
 *
 * Every opt-out is written against the ONE site the person acted on and read
 * across the sending site's CURRENT group. Reading rather than copying on
 * write is what makes a site that joins a group inherit every refusal already
 * standing against its siblings, and it reaches every row already stored and
 * every link already sitting in an inbox — none of which a write-time fan-out
 * could.
 *
 * All three per-site facts are read this way: the site suppression list (an
 * unsubscribe, a hand-added opt-out, an erasure, and the bounces and
 * complaints the platform list already carries), the topic opt-outs, and the
 * recipient's cadence. A sibling's pending confirmation joins them only when
 * the org turned its group's confirmation switch on — see
 * {@link filterTopicSendable}. The group of one — every site of an org that
 * declared nothing — reads exactly the documents these filters always read,
 * in the same round trips.
 *=========================================*/

/**
 * The sites whose opt-out lists answer for a send made BY `hostId`, the
 * sending site first.
 *
 * The sending site's consent group: every site it names, because a refusal
 * standing on any of them is a refusal of the sender. Absent, or a group of
 * one, is the site alone.
 *
 * The group is the one `consentGroupForHost` resolved — never a set a caller
 * built from `org.hosts` or a shared domain, which would be inferring a
 * controller (see `consent-groups.ts`).
 *
 * Throws on a group resolved for a DIFFERENT site. That is a wiring defect no
 * runtime value produces, and the failure it would hide is one site's send
 * decided against another site's lists — the same refusal
 * `splitByMarketingConsent` makes over a consent map read for the wrong host.
 */
export function optOutHostIds(
  hostId: string,
  group?: Pick<ConsentGroup, 'hostId' | 'hostIds'> | null,
): string[] {
  if (!group) return [hostId]
  if (group.hostId !== hostId) {
    throw new Error(
      `[email-suppression] a consent group resolved for ${group.hostId} ` +
        `cannot decide a send from ${hostId}`,
    )
  }
  return consentGroupOptOutHosts(group)
}

/**
 * One keyed `getAll` per site in `hostIds`, positionally aligned with `keys`.
 *
 * Per site rather than one call over every (site, address) pair, so each
 * round trip is exactly the size the single-site read always was — a batch
 * of a campaign — and a group multiplies the number of calls, run in
 * parallel, rather than the size of one. A group of one is one call, over
 * the same references in the same order.
 *
 * Rejects when any read does; each caller keeps its own posture on that.
 */
export async function getAllAcrossSites(
  db: any,
  hostIds: readonly string[],
  subcollection: string,
  keys: readonly string[],
): Promise<any[][]> {
  return Promise.all(
    hostIds.map((id) => {
      const list = db.collection('hosts').doc(id).collection(subcollection)
      return db.getAll(...keys.map((key) => list.doc(key)))
    }),
  )
}

/**
 * The sendable subset for a send made in ONE SITE's name — BOTH lists.
 *
 * A per-site suppression says "not from this site". A platform suppression
 * says the address hard-bounced or somebody pressed "report spam", learned
 * anywhere in the product — including on transactional mail that carried no
 * site tag at all and could therefore never have reached the per-site list.
 * Consulting only the site's own list mails a known-dead or complaining
 * address from the one shared sending domain every tenant's mail leaves by,
 * which makes it every tenant's deliverability problem rather than one
 * merchant's.
 *
 * Composed from {@link filterSuppressedEmails} rather than reimplementing the
 * platform half: normalization, de-duplication and the fail-closed posture
 * live there, and a second copy of them is a second set of rules for two
 * senders to disagree about.
 *
 * ## "This site" means its consent group
 *
 * `group` is the sending site's consent group, and an entry on ANY of its
 * sites' lists withholds — see the section above. Every entry counts, whatever
 * its reason: an unsubscribe and a hand-added opt-out are the person leaving
 * the sender, an erasure is already written on every site of the workspace,
 * and a bounce or a complaint is on the platform list besides. Omitted, the
 * site alone, which is also the whole answer for an org that declared no
 * group.
 *
 * ## Both halves fail CLOSED
 *
 * A read that throws answers "suppressed". The platform half already does; the
 * per-site half matches it, because a list we could not read is not a list
 * that said this address is safe to mail. The cost of the other choice is a
 * message delivered to somebody who asked us to stop.
 *
 * ## One `getAll`, keyed, rather than a scan of the collection
 *
 * The per-site half looks up exactly the addresses being mailed, by document
 * id, in one round trip per site. Reading the whole collection instead —
 * which is what the campaign sender did — is bounded by however large the
 * collection has grown, so a site with more suppressions than the read window
 * fails OPEN on the remainder: the people most certain not to want the mail
 * are the ones a truncated read drops.
 */
export async function filterSendableForHost(
  hostId: string,
  emails: readonly string[],
  injectedFirestore?: any,
  group?: Pick<ConsentGroup, 'hostId' | 'hostIds'> | null,
): Promise<string[]> {
  const hostIds = optOutHostIds(hostId, group)
  const platformSendable = await filterSuppressedEmails(
    emails,
    injectedFirestore,
  )
  // `getAll` rejects an empty reference list, and there is nothing to ask.
  if (!platformSendable.length) return []
  const db = injectedFirestore ?? defaultFirestore()
  // Every survivor of the platform half is keyable — `isEmailSuppressed`
  // answers `true` for an address it cannot key — so this narrows the type
  // rather than dropping anybody.
  const keyed: Array<{ email: string; key: string }> = []
  for (const email of platformSendable) {
    const key = emailSuppressionKey(email)
    if (key) keyed.push({ email, key })
  }
  if (!keyed.length) return []
  try {
    const bySite = await getAllAcrossSites(
      db,
      hostIds,
      HOST_SUPPRESSIONS_SUBCOLLECTION,
      keyed.map((entry) => entry.key),
    )
    return keyed
      .filter(
        (_entry, index) =>
          !bySite.some((snapshots) => snapshots[index]?.exists),
      )
      .map((entry) => entry.email)
  } catch (error) {
    console.error(
      '[email-suppression] per-site lookup failed; failing closed',
      error,
    )
    return []
  }
}

/**
 * The subset of `emails` that may be mailed about `topicId` on this site.
 *
 * The third filter a campaign passes, after the platform list and the site's
 * own: the two suppression lists answer "may we mail this person at all", and
 * this answers "may we mail them about THIS". A recipient who unticked
 * "Promotions and offers" on the preference page is not suppressed — they
 * still get the newsletter — so the fact cannot live on either suppression
 * list without meaning something it does not mean.
 *
 * ## Two ways to be excluded, and both are held here
 *
 * Somebody who LEFT the stream, and somebody who has been asked to confirm
 * joining it and has not. The second is what makes a double opt-in worth
 * recording: an unconfirmed subscriber has to be a real quarantine, not a
 * field the send path never looks at. Both come back from
 * `readTopicSubscriptionState`, which is the only place the three states are
 * decided.
 *
 * Keyed by {@link emailSuppressionKey} and read with one `getAll`, which is
 * both halves of the point: the same derivation as the two lists it runs
 * beside, so one person is one document id everywhere; and one round trip
 * bounded by the size of the send, so adding topics does not make a campaign
 * cost more to resolve.
 *
 * ## This one fails OPEN, and that is the opposite of its neighbors
 *
 * Every other filter in this module answers "suppressed" when a read throws,
 * because the cost of guessing wrong is mailing somebody who told us to stop.
 * Here the cost of guessing wrong in that direction is refusing to send a
 * newsletter somebody asked for, on a read that failed for an unrelated
 * reason — and the campaign has already passed both suppression lists, so
 * nobody who asked us to stop entirely can reach this line. A topic
 * preference is a narrower fact than a suppression and it gets the treatment
 * that matches. A caller that wants the strict posture already has it one
 * layer up.
 *
 * An empty `topicId` is a campaign from before topics existed, or one whose
 * topic was never resolved. It filters nobody: there is no stream to have
 * left.
 *
 * ## Leaving a stream is leaving it for the whole consent group
 *
 * The topic catalog is the org's, so "Newsletter" on one site of a declared
 * group is the same stream on its siblings, and a person who left it on one
 * has left it from the sender. `group` extends the read to every site in it,
 * exactly as {@link filterSendableForHost} does for the suppression list.
 *
 * A sibling's REFUSAL always holds. A sibling's pending confirmation holds
 * only when the group `awaitsConfirmation` — the org's switch, resolved into
 * the group, so asking it reads nothing the refusal read did not already
 * read. Off, the question stays the concern of the site whose form asked it.
 */
export async function filterTopicSendable(
  hostId: string,
  topicId: string | null | undefined,
  emails: readonly string[],
  injectedFirestore?: any,
  group?: Pick<ConsentGroup, 'hostId' | 'hostIds' | 'awaitsConfirmation'> | null,
): Promise<string[]> {
  const hostIds = optOutHostIds(hostId, group)
  const topic = String(topicId ?? '').trim()
  if (!topic || !emails.length) return [...emails]
  // An unkeyable address cannot carry an opt-out record, so it cannot have
  // left this topic. It is dropped from the LOOKUP and kept in the answer —
  // the suppression filters above have already refused it on their own
  // stricter rule, so this one has no business refusing it a second time.
  const lookups: Array<{ email: string; key: string }> = []
  for (const email of emails) {
    const key = emailSuppressionKey(email)
    if (key) lookups.push({ email, key })
  }
  if (!lookups.length) return [...emails]
  try {
    const db = injectedFirestore ?? defaultFirestore()
    const bySite = await getAllAcrossSites(
      db,
      hostIds,
      TOPIC_OPT_OUTS_SUBCOLLECTION,
      lookups.map((entry) => entry.key),
    )
    /*
     * The shared state reader, never a field test written out here.
     *
     * An entry means one of three things and only that function knows all
     * three. The shorthand this replaced — "an entry with no
     * `resubscribedAt` is a live opt-out" — reads a CONFIRMED double
     * opt-in, which carries `pendingAt` and `confirmedAt` and no
     * `resubscribedAt`, as somebody who left.
     */
    const stateIn = (snapshot: any) =>
      snapshot?.exists
        ? readTopicSubscriptionState((snapshot.get('topics') ?? {})[topic])
        : 'subscribed'
    // The sending site first, as `optOutHostIds` ordered the reads — which
    // is how the fold tells its own pending question from a sibling's.
    const awaits = { awaitsConfirmation: group?.awaitsConfirmation === true }
    const gone = new Set<string>()
    lookups.forEach((entry, index) => {
      const states = bySite.map((snapshots) => stateIn(snapshots[index]))
      if (consentGroupTopicState(awaits, states) !== 'subscribed') {
        gone.add(entry.email)
      }
    })
    return emails.filter((email) => !gone.has(email))
  } catch (error) {
    console.error(
      '[email-suppression] topic opt-out lookup failed; failing open',
      error,
    )
    return [...emails]
  }
}

/*
 * THE FOURTH FILTER IS NOT IN THIS FILE, and where it is is forced.
 *
 * `filterCadenceSendable` — the subset that has not asked this site for mail
 * less often than right now — lives in `email-marketing-gate.ts`, because it
 * reads the per-recipient counter document that module owns and names. That
 * module already imports this one for the two suppression lists, so putting
 * the cadence filter here would close a cycle. A campaign's subtraction chain
 * therefore reads: this file's two lists, this file's topic opt-outs, then
 * that file's cadence.
 */

/**
 * The staff queue, newest first, ordered by `suppressedAt` so a re-recorded or
 * released entry surfaces again — the operator's question is "what changed",
 * not "what was first written". Mirrors `listContactSuppressions`.
 */
export async function listEmailSuppressions(options?: {
  limit?: number
  /**
   * Where the NEXT page starts: the `suppressedAt` of the last row already
   * shown, as `seconds.nanoseconds`.
   *
   * The full timestamp rather than milliseconds, because `startAfter` skips
   * exactly the value it is given: a millisecond-truncated cursor sits BEFORE
   * the record it names, so that record would arrive again at the top of the
   * following page. Repeating a row is a smaller fault than skipping one and
   * neither is necessary.
   */
  startAfter?: string | null
  /**
   * Predicates the caller adds beneath the ordering — equalities, one
   * `array-contains`, and ranges over `suppressedAt` itself, which are the
   * only shapes that keep this cursor valid. It must not add an `orderBy`.
   */
  narrow?: (query: any) => any
  firestore?: any
}): Promise<Array<EmailSuppressionRecord & { $id: string }>> {
  const db = options?.firestore ?? defaultFirestore()
  const collection = db.collection(EMAIL_SUPPRESSIONS_COLLECTION)
  let query = (options?.narrow ? options.narrow(collection) : collection).orderBy(
    'suppressedAt',
    'desc',
  )
  const cursor = suppressionCursorTimestamp(options?.startAfter)
  if (cursor) query = query.startAfter(cursor)
  const snapshot = await query
    .limit(Math.min(Math.max(options?.limit ?? 100, 1), 500))
    .get()
  return snapshot.docs.map((doc: any) => ({
    $id: doc.id,
    ...(doc.data() as EmailSuppressionRecord),
  }))
}

/**
 * The cursor a page hands back, from the last row on it.
 *
 * Null when the row carries no `suppressedAt` — every entry written since
 * AGL-1918 does, and `orderBy` has already excluded any that does not, so
 * this is the type narrowing rather than a case that occurs.
 */
export function suppressionCursorFrom(
  record: Record<string, any> | null | undefined,
): string | null {
  const at = record?.['suppressedAt'] as
    | { seconds?: number; _seconds?: number; nanoseconds?: number; _nanoseconds?: number }
    | undefined
  const seconds = at?.seconds ?? at?._seconds
  if (typeof seconds !== 'number') return null
  const nanoseconds = at?.nanoseconds ?? at?._nanoseconds ?? 0
  return `${seconds}.${nanoseconds}`
}

/** The inverse, for the query. Invalid input yields no cursor, never a guess. */
export function suppressionCursorTimestamp(
  cursor: string | null | undefined,
): Timestamp | null {
  const [rawSeconds, rawNanos] = String(cursor ?? '').split('.')
  const seconds = Number(rawSeconds)
  const nanoseconds = Number(rawNanos ?? 0)
  if (!Number.isFinite(seconds) || !seconds) return null
  return new Timestamp(seconds, Number.isFinite(nanoseconds) ? nanoseconds : 0)
}

/*==========================================
 * THE ERASURE ROW ON THE PER-SITE LIST (AGL-2623).
 *
 * A person erased from a workspace must not be quietly rebuilt by the next
 * form they fill in or the next order they place, and must not be mailed by
 * a campaign either. Both gates already read `hosts/{hostId}/suppressions`
 * — every campaign filter refuses an address with a row there — so the
 * erasure writes one row per site of the workspace rather than inventing a
 * third list, and the capture door reads the same row.
 *
 * The row carries NO address. Every other writer of this list stores the
 * email in the clear beside the hash, because a hub admin releasing an
 * unsubscribe needs to see who it was; an erasure row is the one whose
 * whole purpose is that the address is no longer held, so the id — the
 * hash — is the entire record, and a row that already held the address in
 * the clear has it removed. The hub's list renders such a row as an entry
 * with no address, which it already knows how to do.
 *
 * Per SITE, not platform-wide, on purpose: the erasure was asked of one
 * workspace, and a second workspace that knows the same person has a
 * relationship this request has no claim on. The platform list is for
 * bounces and complaints, which are facts about the address everywhere.
 *=========================================*/

/** The `reason` an erasure row carries. Read by the capture door, below. */
export const HOST_ERASURE_SUPPRESSION_REASON = 'erasure'

/**
 * Suppress an address on one site because the person was erased. Idempotent:
 * a second erasure of the same person merges onto the same row.
 */
export async function suppressEmailForHostErasure(input: {
  hostId: string
  email: string
  firestore?: any
}): Promise<{ key: string; created: boolean } | null> {
  const key = emailSuppressionKey(input.email)
  if (!key) return null
  const db = input.firestore ?? defaultFirestore()
  const ref = db
    .collection('hosts')
    .doc(input.hostId)
    .collection(HOST_SUPPRESSIONS_SUBCOLLECTION)
    .doc(key)
  const snapshot = await ref.get()
  await ref.set(
    {
      email: null,
      reason: HOST_ERASURE_SUPPRESSION_REASON,
      suppressedAt: FieldValue.serverTimestamp(),
      ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  )
  return { key, created: !snapshot.exists }
}

/**
 * Whether a site has erased this address, so a capture must not create a
 * contact for it. Only an ERASURE row refuses: an ordinary unsubscribe is a
 * mailing preference, and a person who unsubscribed and then bought
 * something is still a customer whose order the CRM should know about.
 *
 * Fails OPEN. A read that throws answers `false` and logs: the alternative
 * refuses every capture on the site for as long as the list is unreadable,
 * which turns a transient read failure into a silent drop of the site's
 * leads and orders. The window this leaves — a recreate during an outage
 * of the suppression read — is logged, and the next erasure run finds the
 * recreated record by the same address.
 */
export async function hostRefusesCaptureForErasure(
  hostId: string,
  email: string | null | undefined,
  injectedFirestore?: any,
): Promise<boolean> {
  const key = emailSuppressionKey(email)
  if (!key) return false
  try {
    const db = injectedFirestore ?? defaultFirestore()
    const snapshot = await db
      .collection('hosts')
      .doc(hostId)
      .collection(HOST_SUPPRESSIONS_SUBCOLLECTION)
      .doc(key)
      .get()
    return (
      Boolean(snapshot?.exists) &&
      snapshot.get('reason') === HOST_ERASURE_SUPPRESSION_REASON
    )
  } catch (error) {
    console.error(
      '[email-suppression] erasure lookup failed; the capture proceeds',
      error,
    )
    return false
  }
}
