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
 * THE RETAINED-REFUSAL STORE, ON THE ADMIN SDK (AGL-3338):
 * `orgs/{orgId}/retainedRefusals/{personKey}`.
 *
 * What the store is for, and why it holds what it holds, is the pure
 * module's note (`@aglyn/aglyn/app-utils/retained-refusals`). This is its
 * server doors:
 *
 *  - {@link removeContactKeepingRefusals} — the one way a contact is let go
 *    of outside an erasure: the CRM's delete and `DELETE /v1/contacts/{id}`.
 *    It decides against the document read in its own transaction, so a
 *    refusal written a moment before the delete is still the one kept;
 *  - {@link retainRefusals} — the write a record's delete makes, inside the
 *    delete's own transaction when it has one, so a record is never gone
 *    with its refusals unkept;
 *  - {@link readRetainedRefusals} — the read the list gate and the Inbox's
 *    add-to-list make beside the records, which THROWS on a failed read: a
 *    reader that cannot see whether somebody refused must not read them as
 *    somebody who did not;
 *  - {@link carryRetainedRefusals} — one page of a consent group change's
 *    carry over the store, the org-level twin of the per-site carries in
 *    `consent-group-carry.ts`.
 *
 * Anchored on the organization document, or on any collection under it —
 * the caller already holds the records it is reading or deleting, and the
 * store is their sibling.
 */

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import {
  MARKETING_CONSENT_BY_HOST_FIELD,
  MARKETING_CONSENT_FIELD,
} from '@aglyn/aglyn/app-utils/marketing-consent'
import {
  RETAINED_AT_FIELD,
  RETAINED_REFUSALS_COLLECTION,
  type RetainedRefusals,
  refusalsOf,
  retainedEntries,
  retainedRefusalCarry,
} from '@aglyn/aglyn/app-utils/retained-refusals'
import {
  type ContactDetach,
  contactEmails,
  normalizeContactEmail,
} from '@aglyn/aglyn/app-utils/contacts'
import type { ConsentGroupCarry } from '@aglyn/aglyn/app-utils/consent-group-change'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { ConsentGroupCarryPage } from './consent-group-carry'

type Doc = Record<string, unknown>

/** The organization document, or a collection directly under it. */
export type RetainedRefusalsAnchor =
  | FirebaseFirestore.DocumentReference
  | FirebaseFirestore.CollectionReference

/** Keys one `getAll` of the store reads. */
export const RETAINED_REFUSALS_READ_CHUNK = 100

/** Documents one page of the carry reads. */
export const RETAINED_REFUSALS_CARRY_PAGE = 300

/** The organization document `anchor` is, or is directly under. */
function orgOf(anchor: RetainedRefusalsAnchor): FirebaseFirestore.DocumentReference {
  const orgRef =
    typeof (anchor as FirebaseFirestore.DocumentReference).collection === 'function'
      ? (anchor as FirebaseFirestore.DocumentReference)
      : (anchor as FirebaseFirestore.CollectionReference).parent
  if (!orgRef) throw new Error('[retained-refusals] a root collection has no organization')
  return orgRef
}

/** The store under the organization `anchor` is, or is directly under. */
export function retainedRefusalsStore(anchor: RetainedRefusalsAnchor): FirebaseFirestore.CollectionReference {
  return orgOf(anchor).collection(RETAINED_REFUSALS_COLLECTION)
}

export interface RetainRefusalsInput {
  /** The organization document — or `contactsRef`, the collection the record was in. */
  orgRef?: FirebaseFirestore.DocumentReference
  contactsRef?: FirebaseFirestore.CollectionReference
  /**
   * The address the person is known by — or every one, when a merge left the
   * record answering to more than one: each is kept under its own key.
   */
  email: string | readonly string[]
  /** The record the refusals come from, stamped on each entry. */
  contactId: string
  /** What `planContactDetach`'s delete (or `refusalsOf`) named. */
  retained: RetainedRefusals | null | undefined
  nowMs: number
  /** The delete's transaction, so the retention and the delete land together. */
  transaction?: FirebaseFirestore.Transaction
}

/**
 * Keeps a record's refusals in the store, one document per address, and
 * answers how many documents it wrote.
 *
 * Each site's entry is written under its own field path, replacing that
 * site's entry and leaving every other site retained earlier as it was; the
 * unscoped refusal is written only when there is one, so it is never
 * cleared by a later record that had none. Nothing is written when there is
 * nothing to keep.
 *
 * Inside a transaction the writes join it, and the caller must have done its
 * reads first, as a transaction requires. Outside one they are a batch.
 */
export async function retainRefusals(input: RetainRefusalsInput): Promise<number> {
  const { retained } = input
  const hostIds = Object.keys(retained?.byHost ?? {})
  if (!retained || (!hostIds.length && !retained.unscoped)) return 0
  const anchor = input.orgRef ?? input.contactsRef
  if (!anchor) throw new Error('[retained-refusals] name the organization or its contacts')
  const orgRef = orgOf(anchor)
  const store = orgRef.collection(RETAINED_REFUSALS_COLLECTION)
  const emails = typeof input.email === 'string' ? [input.email] : input.email
  const keys = [
    ...new Set(emails.map((email) => personKey(email)).filter((key): key is string => Boolean(key))),
  ]
  if (!keys.length) return 0

  const data: Doc = {
    [MARKETING_CONSENT_BY_HOST_FIELD]: retainedEntries(retained, input.contactId, input.nowMs),
    [RETAINED_AT_FIELD]: input.nowMs,
    updatedAt: FieldValue.serverTimestamp(),
  }
  const fields: Array<string | FirebaseFirestore.FieldPath> = [
    ...hostIds.map((hostId) => new FieldPath(MARKETING_CONSENT_BY_HOST_FIELD, hostId)),
    RETAINED_AT_FIELD,
    'updatedAt',
  ]
  if (retained.unscoped) {
    data[MARKETING_CONSENT_FIELD] = false
    fields.push(MARKETING_CONSENT_FIELD)
  }

  if (input.transaction) {
    for (const key of keys) input.transaction.set(store.doc(key), data, { mergeFields: fields })
    return keys.length
  }
  const batch = orgRef.firestore.batch()
  for (const key of keys) batch.set(store.doc(key), data, { mergeFields: fields })
  await batch.commit()
  return keys.length
}

/** What {@link removeContactKeepingRefusals} did to one contact. */
export type ContactRemoval =
  | { outcome: 'missing' }
  | { outcome: 'refused'; error: string }
  | { outcome: 'detached' }
  | {
      outcome: 'deleted'
      /** Retained documents written, one per address the contact answered to. */
      retained: number
    }

export interface RemoveContactInput {
  contactRef: FirebaseFirestore.DocumentReference
  /**
   * What letting go of this contact means, decided against the document as
   * the transaction read it: `planContactDetach` for a holder letting go,
   * {@link deleteWholeContact} for a delete regardless of holders, or a
   * sentence refusing it.
   */
  decide: (contact: Doc) => ContactDetach | { refused: string }
  nowMs: number
}

/** The decision `DELETE /v1/contacts/{id}` makes: the document goes, every refusal on it kept. */
export const deleteWholeContact = (contact: Doc): ContactDetach => ({
  action: 'delete',
  retained: refusalsOf(contact),
})

/**
 * Lets go of one contact in one transaction, keeping every refusal it holds.
 *
 * A DETACH drops the leaving holder's facet, its consent GRANTS, its scope
 * tokens and its capture attribution; a refusal entry is not among the
 * removals `planContactDetach` names, so it stays for the holders that
 * remain. A DELETE copies every refusal on the document into the store under
 * each address the contact answers to — the primary and every one a merge
 * folded in, since the list gate may be asked about any of them — and
 * deletes the document in the same commit.
 *
 * ⛔ Not the erasure path, which removes the person everywhere and closes the
 * door with suppression rows before it deletes anything.
 */
export async function removeContactKeepingRefusals(
  input: RemoveContactInput,
): Promise<ContactRemoval> {
  const { contactRef, nowMs } = input
  const orgRef = contactRef.parent.parent
  if (!orgRef) throw new Error('[retained-refusals] a contact lives under an organization')
  return contactRef.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(contactRef)
    if (!snapshot.exists) return { outcome: 'missing' } as const
    const contact = (snapshot.data() ?? {}) as Doc
    const decided = input.decide(contact)
    if ('refused' in decided) return { outcome: 'refused', error: decided.refused } as const
    if (decided.action === 'delete') {
      const retained = await retainRefusals({
        orgRef,
        email: contactEmails(contact),
        contactId: contactRef.id,
        retained: decided.retained,
        nowMs,
        transaction,
      })
      transaction.delete(contactRef)
      return { outcome: 'deleted', retained } as const
    }
    transaction.update(contactRef, {
      ...Object.fromEntries(decided.remove.map((path) => [path, FieldValue.delete()])),
      visibleTo: FieldValue.arrayRemove(...decided.removeTokens),
      capturedByHostIds: FieldValue.arrayRemove(...decided.removeHostIds),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { outcome: 'detached' } as const
  })
}

/**
 * The retained documents for these addresses, keyed by the normalized
 * address; an address with nothing retained is absent.
 *
 * Throws when a read fails, and deliberately: every caller decides whether
 * an operator may enroll somebody, and a read that could not see a refusal
 * has to reach the caller's failed-read branch rather than read as none.
 */
export async function readRetainedRefusals(
  anchor: RetainedRefusalsAnchor,
  emails: readonly string[],
): Promise<Map<string, Doc>> {
  const found = new Map<string, Doc>()
  const byKey = new Map<string, string>()
  for (const raw of emails) {
    const email = normalizeContactEmail(raw)
    const key = email ? personKey(email) : null
    if (email && key) byKey.set(key, email)
  }
  if (!byKey.size) return found
  const orgRef = orgOf(anchor)
  const store = orgRef.collection(RETAINED_REFUSALS_COLLECTION)
  const keys = [...byKey.keys()]
  for (let at = 0; at < keys.length; at += RETAINED_REFUSALS_READ_CHUNK) {
    const chunk = keys.slice(at, at + RETAINED_REFUSALS_READ_CHUNK)
    const snapshots = await orgRef.firestore.getAll(...chunk.map((key) => store.doc(key)))
    for (const snapshot of snapshots) {
      const email = byKey.get(snapshot.id)
      if (email && snapshot.exists) found.set(email, (snapshot.data() ?? {}) as Doc)
    }
  }
  return found
}

export interface CarryRetainedRefusalsOptions {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  carry: ConsentGroupCarry
  changeId: string
  cursor: string | null
  /** Only documents written at or after this instant — the catch-up. */
  sinceMs?: number | null
  pageSize?: number
  dryRun?: boolean
}

interface Cursor {
  id: string
  /** `updatedAt` on the last document a catch-up read. */
  at?: { seconds: number; nanoseconds: number }
}

function readCursor(raw: string | null): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Cursor
    return typeof parsed?.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** The error codes that mean "somebody wrote this document since I read it". */
const RACED = new Set([5, 9])
const codeOf = (error: unknown): number | undefined => (error as { code?: number } | null)?.code

/**
 * One page of the carry `to ← from` over the store: every retained refusal
 * `from` holds is given to `to` where `to` has no entry, with where it came
 * from and which change carried it. See `retainedRefusalCarry`.
 *
 * The full pass reads only the documents refusing `from`, by id. The
 * catch-up reads everything written since `sinceMs`, by `updatedAt` then id,
 * and decides each document in hand: an equality on a site's entry beside a
 * range on `updatedAt` would need a composite index per site, which no
 * index file can declare.
 *
 * Idempotent, like every carry: a write only fills an entry `to` lacks, so
 * a page re-run after a crash, the catch-up and the sweep write nothing that
 * was already carried. A write that raced another writer is decided again
 * once from a fresh read; failing twice throws, and the executor retries the
 * page from its cursor.
 */
export async function carryRetainedRefusals(
  options: CarryRetainedRefusalsOptions,
): Promise<ConsentGroupCarryPage> {
  const { firestore, carry, changeId } = options
  const store = firestore.collection('orgs').doc(options.orgId).collection(RETAINED_REFUSALS_COLLECTION)
  const limit = options.pageSize ?? RETAINED_REFUSALS_CARRY_PAGE
  const cursor = readCursor(options.cursor)
  const since = options.sinceMs ?? null

  let query: FirebaseFirestore.Query
  if (since !== null) {
    query = store
      .where('updatedAt', '>=', Timestamp.fromMillis(since))
      .orderBy('updatedAt')
      .orderBy(FieldPath.documentId())
    if (cursor?.at) query = query.startAfter(new Timestamp(cursor.at.seconds, cursor.at.nanoseconds), cursor.id)
  } else {
    query = store
      .where(`${MARKETING_CONSENT_BY_HOST_FIELD}.${carry.fromHostId}.${MARKETING_CONSENT_FIELD}`, '==', false)
      .orderBy(FieldPath.documentId())
    if (cursor) query = query.startAfter(cursor.id)
  }
  const page = await query.limit(limit).get()
  if (page.empty) return { done: true, cursor: null, read: 0, written: 0 }

  const decide = (snapshot: FirebaseFirestore.DocumentSnapshot) => {
    const patch = snapshot.exists ? retainedRefusalCarry(snapshot.data(), carry, changeId) : null
    return patch ? { snapshot, patch } : null
  }
  const due = page.docs.map(decide).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  const written = options.dryRun ? due.length : await writeCarried(firestore, carry, due, decide)

  const last = page.docs[page.docs.length - 1]
  const next: Cursor = { id: last.id }
  if (since !== null) {
    const value = last.get('updatedAt')
    if (value instanceof Timestamp) next.at = { seconds: value.seconds, nanoseconds: value.nanoseconds }
  }
  const done = page.size < limit
  return { done, cursor: done ? null : JSON.stringify(next), read: page.size, written }
}

type Carried = { snapshot: FirebaseFirestore.DocumentSnapshot; patch: Doc }

/**
 * Writes one page's patches through a `BulkWriter`, each guarded by the read
 * it was decided from, and decides the ones that raced once more.
 */
async function writeCarried(
  firestore: FirebaseFirestore.Firestore,
  carry: ConsentGroupCarry,
  due: Carried[],
  decide: (snapshot: FirebaseFirestore.DocumentSnapshot) => Carried | null,
): Promise<number> {
  let written = 0
  for (let round = 0; round < 2 && due.length; round += 1) {
    const writer = firestore.bulkWriter()
    const outcomes = due.map(({ snapshot, patch }) =>
      writer
        .update(
          snapshot.ref,
          { ...patch, updatedAt: FieldValue.serverTimestamp() },
          { lastUpdateTime: snapshot.updateTime as FirebaseFirestore.Timestamp },
        )
        .then(
          () => ({ snapshot, error: null as unknown }),
          (error: unknown) => ({ snapshot, error: error ?? new Error('The write failed') }),
        ),
    )
    await writer.close()
    const raced: FirebaseFirestore.DocumentSnapshot[] = []
    for (const { snapshot, error } of await Promise.all(outcomes)) {
      if (error === null) {
        written += 1
        continue
      }
      const code = codeOf(error)
      if (code === undefined || !RACED.has(code)) throw error
      raced.push(snapshot)
    }
    if (!raced.length) return written
    const fresh = await firestore.getAll(...raced.map((snapshot) => snapshot.ref))
    due = fresh.map(decide).filter((entry): entry is Carried => entry !== null)
  }
  if (due.length) {
    throw new Error(
      `[retained-refusals] ${due.length} document(s) kept changing under the carry to ${carry.toHostId}`,
    )
  }
  return written
}
