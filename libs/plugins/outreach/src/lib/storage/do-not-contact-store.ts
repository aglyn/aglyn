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
 * The organization's Outreach do-not-contact list (AGL-2980):
 * `orgs/{orgId}/outreachDoNotContact/{key}`, one document per address.
 *
 * SERVER ONLY — the key hashes with `node:crypto`. Two kinds of caller, and
 * the API is shaped for both:
 *
 * - The console's routes: the enrollment gates read the list for every
 *   person being enrolled at once ({@link lookupOutreachDoNotContact}, one
 *   `getAll`), and "Mark do-not-contact" on an enrollment adds an entry with
 *   the member as its author.
 * - The sending runtime: it re-reads the list for each person before each
 *   send ({@link isOutreachDoNotContact}), and adds an entry when a reply
 *   opts out, when the unsubscribe link is used and when an address bounces
 *   for good, with `source: 'runtime'` and no member.
 *
 * ## Reads answer `null` when they could not be made
 *
 * `null` is not `false`. The gates read a `null` lookup as "we couldn't
 * check" and refuse the person, which is the only safe reading of a list
 * whose whole job is to stop mail: a person who asked not to be emailed must
 * not be emailed because a read timed out.
 *
 * ## An entry is written once
 *
 * The first reason an address was added is the record of why it is there;
 * a later add for the same address — an unsubscribe after a member already
 * marked it — finds it on the list and changes nothing. `create()` makes
 * that atomic without a transaction: two adds racing for one address cannot
 * both write.
 */

import { outreachDoNotContactKey } from '../engine/do-not-contact'
import {
  OUTREACH_COLLECTIONS,
  OUTREACH_DO_NOT_CONTACT_REASONS,
  OUTREACH_DO_NOT_CONTACT_SOURCES,
  type OutreachDoNotContactEntry,
  type OutreachDoNotContactReason,
  type OutreachDoNotContactSource,
} from '../model/outreach.types'

/** The longest detail an entry keeps. */
export const OUTREACH_DO_NOT_CONTACT_DETAIL_MAX = 500

/** `getAll` takes this many references at most per call. */
const GET_ALL_CHUNK = 300

/** gRPC `ALREADY_EXISTS`, which `create()` rejects with when the document is there. */
const ALREADY_EXISTS = 6

/** `orgs/{orgId}/outreachDoNotContact`. */
export function outreachDoNotContactCollection(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): FirebaseFirestore.CollectionReference {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(OUTREACH_COLLECTIONS.doNotContact)
}

/** A stored entry held to its shape, or `null` for a document that is not one. */
export function readOutreachDoNotContactEntry(
  key: string,
  data: Record<string, unknown> | undefined,
): OutreachDoNotContactEntry | null {
  if (!data) return null
  const reason = data['reason']
  const source = data['source']
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value ? value : null
  const addedAtMs = Number(data['addedAtMs'])
  return {
    key,
    // An entry some other writer produced still keeps its address off the
    // list's sends; only how it reads is defaulted.
    reason: (OUTREACH_DO_NOT_CONTACT_REASONS as readonly unknown[]).includes(reason)
      ? (reason as OutreachDoNotContactReason)
      : 'manual',
    source: (OUTREACH_DO_NOT_CONTACT_SOURCES as readonly unknown[]).includes(source)
      ? (source as OutreachDoNotContactSource)
      : 'member',
    addedByUid: text(data['addedByUid']),
    addedAtMs: Number.isFinite(addedAtMs) && addedAtMs > 0 ? addedAtMs : 0,
    enrollmentId: text(data['enrollmentId']),
    sequenceId: text(data['sequenceId']),
    detail: text(data['detail']),
  }
}

/**
 * Whether each address is on the list, in one round trip: `true` or `false`
 * per address, or `null` for an address that cannot be keyed and for every
 * address when the read failed. Keyed by the address exactly as given.
 */
export async function lookupOutreachDoNotContact(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  emails: readonly string[],
): Promise<Map<string, boolean | null>> {
  const answers = new Map<string, boolean | null>()
  const keyed: Array<{ email: string; key: string }> = []
  for (const email of emails) {
    const key = outreachDoNotContactKey(email)
    if (key) keyed.push({ email, key })
    else answers.set(email, null)
  }
  if (!keyed.length) return answers
  const list = outreachDoNotContactCollection(firestore, orgId)
  try {
    for (let start = 0; start < keyed.length; start += GET_ALL_CHUNK) {
      const chunk = keyed.slice(start, start + GET_ALL_CHUNK)
      const snapshots = await firestore.getAll(...chunk.map((entry) => list.doc(entry.key)))
      chunk.forEach((entry, index) => {
        answers.set(entry.email, snapshots[index]?.exists === true)
      })
    }
  } catch (error) {
    console.error('[outreach] do-not-contact lookup failed; reading as unchecked', error)
    for (const entry of keyed) answers.set(entry.email, null)
  }
  return answers
}

/** Whether one address is on the list; `null` when that could not be told. */
export async function isOutreachDoNotContact(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  email: string,
): Promise<boolean | null> {
  return (await lookupOutreachDoNotContact(firestore, orgId, [email])).get(email) ?? null
}

/** The entry an address has, or `null` when it has none. */
export async function getOutreachDoNotContactEntry(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  email: string,
): Promise<OutreachDoNotContactEntry | null> {
  const key = outreachDoNotContactKey(email)
  if (!key) return null
  const snapshot = await outreachDoNotContactCollection(firestore, orgId).doc(key).get()
  return snapshot.exists ? readOutreachDoNotContactEntry(key, snapshot.data()) : null
}

export interface AddOutreachDoNotContactInput {
  orgId: string
  email: string
  reason: OutreachDoNotContactReason
  source: OutreachDoNotContactSource
  /** The member adding it; omit or `null` for the runtime. */
  addedByUid?: string | null
  nowMs: number
  enrollmentId?: string | null
  sequenceId?: string | null
  detail?: string | null
}

export interface AddOutreachDoNotContactResult {
  key: string
  /** False when the address was on the list already; its entry is unchanged. */
  created: boolean
  /** The entry as it stands: the new one, or the one that was already there. */
  entry: OutreachDoNotContactEntry
}

/**
 * Puts an address on the list — see the module note for why a second add
 * changes nothing. Throws for a value that is not an address, a reason or a
 * source the list does not know, and a member-sourced add with no member:
 * a list that could hold an entry nobody can explain is not evidence of
 * anything.
 */
export async function addOutreachDoNotContact(
  firestore: FirebaseFirestore.Firestore,
  input: AddOutreachDoNotContactInput,
): Promise<AddOutreachDoNotContactResult> {
  const key = outreachDoNotContactKey(input.email)
  if (!key) throw new Error('[outreach] cannot key a do-not-contact entry for that value')
  if (!(OUTREACH_DO_NOT_CONTACT_REASONS as readonly string[]).includes(input.reason)) {
    throw new Error(`[outreach] "${String(input.reason)}" is not a do-not-contact reason`)
  }
  if (!(OUTREACH_DO_NOT_CONTACT_SOURCES as readonly string[]).includes(input.source)) {
    throw new Error(`[outreach] "${String(input.source)}" is not a do-not-contact source`)
  }
  const addedByUid = typeof input.addedByUid === 'string' && input.addedByUid ? input.addedByUid : null
  if (input.source === 'member' && !addedByUid) {
    throw new Error('[outreach] a member-added do-not-contact entry names the member')
  }
  const detail = String(input.detail ?? '').replace(/\s+/g, ' ').trim()
  const entry: OutreachDoNotContactEntry = {
    key,
    reason: input.reason,
    source: input.source,
    addedByUid,
    addedAtMs: input.nowMs,
    enrollmentId: input.enrollmentId || null,
    sequenceId: input.sequenceId || null,
    detail: detail ? detail.slice(0, OUTREACH_DO_NOT_CONTACT_DETAIL_MAX) : null,
  }
  const ref = outreachDoNotContactCollection(firestore, input.orgId).doc(key)
  try {
    await ref.create(entry)
    return { key, created: true, entry }
  } catch (error) {
    if ((error as { code?: unknown })?.code !== ALREADY_EXISTS) throw error
    const existing = await ref.get()
    return {
      key,
      created: false,
      entry: readOutreachDoNotContactEntry(key, existing.data()) ?? entry,
    }
  }
}
