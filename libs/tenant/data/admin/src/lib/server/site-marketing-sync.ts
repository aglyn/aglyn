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
 * A SITE'S MARKETING CONSENT, AS AN OUTSIDE LIST MIRRORS IT (AGL-3639).
 *
 * A connector that keeps a merchant's own email platform in step with the
 * site — their Mailchimp audience, their Klaviyo list — has two questions to
 * ask of the platform and one fact to hand back, and all three are answered
 * from the records every send already reads:
 *
 *  - **May this site market to this person?** The consent basis on the
 *    person's record, under the org's policy and the site's consent group
 *    (`marketing-consent.ts`), then the two suppression lists: the platform's
 *    `emailSuppressions` and the group's `hosts/{hostId}/suppressions`. The
 *    same decision a campaign makes, so the outside list and the site's own
 *    sends never disagree about one person.
 *  - **Who left lately?** The site's suppression list, walked in the order
 *    it was written, so an unsubscribe on the site reaches the outside list
 *    without the person's record having to change.
 *  - **This person left over there.** Filed as the site's own unsubscribe —
 *    the record the site's unsubscribe link writes, read by every sender —
 *    marked with WHERE it came from (`via`), so the walk above does not hand
 *    it straight back to the list it came from, and so only that list can
 *    lift it again.
 *
 * Only the site's suppression list is written. The person's consent basis is
 * never changed from outside: declining it would stop every stream on every
 * site of the group, and a person who unsubscribed from one newsletter tool
 * said no more than that (the same rule AGL-3305 set for the account side).
 *
 * ## Reads fail LOUD here
 *
 * The send path's filters fail closed — a list that could not be read
 * answers "suppressed". A mirror cannot take that posture: "suppressed" here
 * becomes an unsubscribe WRITTEN to the merchant's outside list, for every
 * person on a page, over a read that failed for an unrelated reason. So
 * every read in this module throws, and the connector's run fails and is
 * retried rather than acting on an answer nobody measured.
 */

import {
  consentGroupForHost,
  consentGroupOptOutHosts,
} from '@aglyn/aglyn/app-utils/consent-groups'
import { emailSearchTokens } from '@aglyn/aglyn/app-utils/email-search'
import {
  marketingConsentDecision,
  readMarketingBasis,
  resolveMarketingConsentPolicy,
} from '@aglyn/aglyn/app-utils/marketing-consent'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { stampRecordEmailState } from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  EMAIL_SUPPRESSIONS_COLLECTION,
  HOST_SUPPRESSIONS_SUBCOLLECTION,
  UNSUBSCRIBE_SUPPRESSION_REASON,
} from './email-suppression'
import firebaseAdmin from './firebase-admin'
import { mirrorPlatformResubscribe, mirrorPlatformUnsubscribe } from './platform-marketing-consent'

const defaultFirestore = () => firebaseAdmin.app().firestore()

/**
 * What an outside list should hold for one person.
 *
 * `withheld` is not a refusal: nobody recorded a basis this site may use
 * (and none is grandfathered), so the person is left OFF the outside list
 * rather than added as unsubscribed — adding them at all would copy an
 * address the site has no standing to market to.
 */
export type SiteMarketingStatus = 'subscribed' | 'unsubscribed' | 'withheld'

export interface SiteMarketingPerson {
  email: string
  /** The person's record as the plugin that keeps people stores it, or `null`. */
  data: Readonly<Record<string, unknown>> | null
}

/**
 * Each person's status for one site, in the order asked. Throws when any
 * list cannot be read — see the module comment.
 *
 * @param org the owning org's document data: its consent policy and its
 *            declared consent groups.
 */
export async function readSiteMarketingStatuses(input: {
  hostId: string
  org: Readonly<Record<string, unknown>> | null
  people: readonly SiteMarketingPerson[]
  firestore?: any
}): Promise<SiteMarketingStatus[]> {
  if (!input.people.length) return []
  const db = input.firestore ?? defaultFirestore()
  const group = consentGroupForHost((input.org as Record<string, unknown> | null) ?? null, input.hostId)
  const policy = resolveMarketingConsentPolicy(input.org?.['marketingConsentPolicy'])
  const keys = input.people.map((person) => personKey(person.email))
  const keyed = keys.filter((key): key is string => Boolean(key))
  const suppressed = new Set<string>()
  if (keyed.length) {
    const platform = await db.getAll(
      ...keyed.map((key) => db.collection(EMAIL_SUPPRESSIONS_COLLECTION).doc(key)),
    )
    platform.forEach((snapshot: any, index: number) => {
      if (snapshot?.exists && !snapshot.get('releasedAt')) suppressed.add(keyed[index])
    })
    const sites = await Promise.all(
      consentGroupOptOutHosts(group).map((siteId) => {
        const list = db.collection('hosts').doc(siteId).collection(HOST_SUPPRESSIONS_SUBCOLLECTION)
        return db.getAll(...keyed.map((key) => list.doc(key)))
      }),
    )
    for (const snapshots of sites) {
      snapshots.forEach((snapshot: any, index: number) => {
        if (snapshot?.exists) suppressed.add(keyed[index])
      })
    }
  }
  return input.people.map((person, index): SiteMarketingStatus => {
    const key = keys[index]
    if (!key) return 'withheld'
    if (suppressed.has(key)) return 'unsubscribed'
    const decision = marketingConsentDecision(
      readMarketingBasis((person.data as Record<string, unknown> | null) ?? null, group),
      policy,
    )
    if (decision.reason === 'declined') return 'unsubscribed'
    return decision.verdict === 'withheld' ? 'withheld' : 'subscribed'
  })
}

/** One row of a site's suppression list, as the walk answers it. */
export interface SiteSuppressionChange {
  email: string
  /** `unsubscribe`, `bounce`, `complaint`, `erasure`, … — every row means "do not market". */
  reason: string
  /** Where an unsubscribe filed by {@link recordSiteUnsubscribe} came from; `null` for the site's own. */
  via: string | null
}

export interface SiteSuppressionChangesPage {
  rows: SiteSuppressionChange[]
  /** The cursor to store; `null` when nothing was written after the one asked with. */
  next: string | null
}

const encodeCursor = (stamp: any, id: string): string | null => {
  const seconds = Number(stamp?.seconds)
  const nanoseconds = Number(stamp?.nanoseconds ?? 0)
  if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) return null
  return `${Math.trunc(seconds)}.${Math.trunc(nanoseconds)}.${id}`
}

/** Reads a suppression-walk cursor, or `null` for anything this module did not hand out. */
export function decodeSiteSuppressionCursor(
  cursor: string | null | undefined,
): { seconds: number; nanoseconds: number; id: string } | null {
  const match = /^(\d{1,12})\.(\d{1,9})\.([A-Za-z0-9_-]{1,128})$/.exec(String(cursor ?? ''))
  return match ? { seconds: Number(match[1]), nanoseconds: Number(match[2]), id: match[3] } : null
}

/**
 * The site's suppression list in the order it was last written
 * (`suppressedAt`, then the id), after a cursor. A single-field ordering, so
 * no composite index is involved. A row with no `suppressedAt` (written
 * before the field) is not on the walk; the person's next change reaches the
 * outside list through {@link readSiteMarketingStatuses} instead.
 */
export async function listSiteSuppressionChanges(input: {
  hostId: string
  after: string | null
  limit: number
  firestore?: any
}): Promise<SiteSuppressionChangesPage> {
  const db = input.firestore ?? defaultFirestore()
  const limit = Math.min(500, Math.max(1, Math.floor(Number(input.limit) || 0)))
  let query = db
    .collection('hosts')
    .doc(input.hostId)
    .collection(HOST_SUPPRESSIONS_SUBCOLLECTION)
    .orderBy('suppressedAt', 'asc')
    .orderBy(FieldPath.documentId(), 'asc')
  const after = decodeSiteSuppressionCursor(input.after)
  if (after) query = query.startAfter(new Timestamp(after.seconds, after.nanoseconds), after.id)
  const snapshot = await query.limit(limit).get()
  const rows: SiteSuppressionChange[] = []
  let next: string | null = null
  for (const doc of snapshot.docs) {
    next = encodeCursor(doc.get('suppressedAt'), doc.id) ?? next
    const email = String(doc.get('email') ?? '').trim().toLowerCase()
    if (!email) continue
    rows.push({
      email,
      reason: String(doc.get('reason') ?? UNSUBSCRIBE_SUPPRESSION_REASON),
      via: typeof doc.get('via') === 'string' ? doc.get('via') : null,
    })
  }
  return { rows, next }
}

/** A `via` tag: who filed an unsubscribe from outside the site. */
const VIA = /^[a-z][a-z0-9-]{1,62}:[a-z][a-z0-9-]{1,62}$/

/**
 * Files an unsubscribe the person made on an outside list as the site's own
 * (`reason: 'unsubscribe'`), marked `via` — `<plugin>:<list>` — so the walk
 * can tell it apart and only the same list can lift it.
 *
 * The same rules as the site's own unsubscribe link: a row of another kind
 * (a bounce, an erasure) stays that kind and is not rewritten; an existing
 * unsubscribe keeps the date and the door it was first filed by; a new one
 * says so on the person's record and, on the platform's own marketing site,
 * on the account's answer (AGL-3305).
 *
 * @returns whether this call created the row.
 */
export async function recordSiteUnsubscribe(input: {
  hostId: string
  email: string
  via: string
  /** The words on the person's record, e.g. `Unsubscribed in Mailchimp.` */
  detail: string
  firestore?: any
}): Promise<{ created: boolean }> {
  const key = personKey(input.email)
  if (!key || !input.hostId || !VIA.test(input.via)) return { created: false }
  const email = String(input.email).trim().toLowerCase()
  const db = input.firestore ?? defaultFirestore()
  const ref = db.collection('hosts').doc(input.hostId).collection(HOST_SUPPRESSIONS_SUBCOLLECTION).doc(key)
  const created: boolean = await db.runTransaction(async (transaction: any) => {
    const existing = await transaction.get(ref)
    if (existing.exists) return false
    transaction.set(ref, {
      email,
      emailTokens: emailSearchTokens(email),
      reason: UNSUBSCRIBE_SUPPRESSION_REASON,
      via: input.via,
      suppressedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    })
    return true
  })
  if (created) {
    await stampRecordEmailState({
      hostId: input.hostId,
      email,
      state: { status: 'unsubscribed', atMs: Date.now(), source: 'campaign', detail: input.detail },
    })
    await mirrorPlatformUnsubscribe({ hostId: input.hostId, email, left: 'everything' })
  }
  return { created }
}

/**
 * Lifts an unsubscribe filed by {@link recordSiteUnsubscribe} from the SAME
 * outside list — the person subscribed again where they had left. Anything
 * else stands: the site's own unsubscribe (the person told the site), a row
 * another list filed, a bounce, a complaint, an erasure.
 *
 * A lifted row is mirrored onto the account's answer the way the site's own
 * resubscribe link is (AGL-3305): only on the platform's marketing site, and
 * only a No an email door recorded — which is the No the unsubscribe above
 * mirrored — so the account's answer and the site's list move together.
 *
 * @returns whether a row was lifted.
 */
export async function releaseSiteUnsubscribe(input: {
  hostId: string
  email: string
  via: string
  firestore?: any
}): Promise<boolean> {
  const key = personKey(input.email)
  if (!key || !input.hostId || !VIA.test(input.via)) return false
  const db = input.firestore ?? defaultFirestore()
  const ref = db.collection('hosts').doc(input.hostId).collection(HOST_SUPPRESSIONS_SUBCOLLECTION).doc(key)
  const released: boolean = await db.runTransaction(async (transaction: any) => {
    const existing = await transaction.get(ref)
    if (!existing.exists) return false
    if (existing.get('reason') !== UNSUBSCRIBE_SUPPRESSION_REASON) return false
    if (existing.get('via') !== input.via) return false
    transaction.delete(ref)
    return true
  })
  if (released) {
    await mirrorPlatformResubscribe({
      hostId: input.hostId,
      email: String(input.email).trim().toLowerCase(),
      via: 'email-resubscribe',
      firestore: db,
    })
  }
  return released
}

/** Distinct, keyable addresses, each with its key. */
function keyedEmails(emails: readonly string[]): Array<{ email: string; key: string }> {
  const out = new Map<string, { email: string; key: string }>()
  for (const raw of emails) {
    const email = String(raw ?? '').trim().toLowerCase()
    const key = personKey(email)
    if (key && !out.has(key)) out.set(key, { email, key })
  }
  return [...out.values()]
}

/**
 * {@link recordSiteUnsubscribe} for a page of addresses an outside list
 * reported, reading the site's rows in one round trip first: an address
 * that already has a row of any kind is left alone without a transaction,
 * which is most of them on every run after the first — a list reports back
 * the unsubscribes it was just sent.
 *
 * @returns how many rows this call created.
 */
export async function recordSiteUnsubscribes(input: {
  hostId: string
  emails: readonly string[]
  via: string
  detail: string
  firestore?: any
}): Promise<number> {
  const entries = keyedEmails(input.emails)
  if (!entries.length || !input.hostId || !VIA.test(input.via)) return 0
  const db = input.firestore ?? defaultFirestore()
  const list = db.collection('hosts').doc(input.hostId).collection(HOST_SUPPRESSIONS_SUBCOLLECTION)
  const snapshots = await db.getAll(...entries.map((entry) => list.doc(entry.key)))
  let created = 0
  for (const [index, entry] of entries.entries()) {
    if (snapshots[index]?.exists) continue
    const outcome = await recordSiteUnsubscribe({
      hostId: input.hostId,
      email: entry.email,
      via: input.via,
      detail: input.detail,
      firestore: db,
    })
    if (outcome.created) created += 1
  }
  return created
}

/**
 * {@link releaseSiteUnsubscribe} for a page of addresses an outside list
 * reported as subscribed again, reading the rows in one round trip first:
 * only a row that list filed is worth a transaction.
 *
 * @returns how many rows this call lifted.
 */
export async function releaseSiteUnsubscribes(input: {
  hostId: string
  emails: readonly string[]
  via: string
  firestore?: any
}): Promise<number> {
  const entries = keyedEmails(input.emails)
  if (!entries.length || !input.hostId || !VIA.test(input.via)) return 0
  const db = input.firestore ?? defaultFirestore()
  const list = db.collection('hosts').doc(input.hostId).collection(HOST_SUPPRESSIONS_SUBCOLLECTION)
  const snapshots = await db.getAll(...entries.map((entry) => list.doc(entry.key)))
  let released = 0
  for (const [index, entry] of entries.entries()) {
    const snapshot = snapshots[index]
    if (!snapshot?.exists || snapshot.get('via') !== input.via) continue
    if (await releaseSiteUnsubscribe({ hostId: input.hostId, email: entry.email, via: input.via, firestore: db })) {
      released += 1
    }
  }
  return released
}
