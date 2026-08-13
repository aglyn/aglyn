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
 * The clickwrap acceptance record, `users/{uid}/legalAcceptances/{version}`
 * (AGL-1497).
 *
 * WHY A COLLECTION, AND WHY UNDER THE USER
 *
 * Acceptance is a fact about a HUMAN, not about an org. An org has many
 * members and they arrive by different doors — the founder who created it, a
 * teammate who accepted an invite, and a site collaborator who is created with
 * org `role: 'viewer'` and may never touch the org's billing at all. "The org
 * accepted" and "this person accepted" are different statements, and only the
 * second one is a contract with the person in front of you. Storing it on
 * `orgs/{id}` would make the first stand in for the second, and storing it as
 * a field on `users/{uid}` would keep only the latest answer.
 *
 * One document PER VERSION, so the history is additive: when the Terms change
 * — and ToS §5.3 expressly reserves that right — a re-acceptance ADDS a
 * document instead of overwriting the evidence of what was agreed before it.
 * The version is the document id, which makes the write idempotent for free:
 * a retried request cannot produce a second record of the same acceptance.
 *
 * IMMUTABILITY. The first acceptance of a version wins and is never rewritten.
 * ToS §18.5 gives a 30-day window to opt out of arbitration measured from
 * FIRST accepting, so that timestamp decides a real right — a later write that
 * moved it would silently restart somebody's clock.
 *
 * The timestamp is the SERVER's. A record whose time the client supplied is
 * worth very little in the dispute it exists for.
 *
 * Firestore rules make this collection owner-readable and `write: if false`,
 * so it is Admin-SDK-only: the person the record is about cannot forge, amend
 * or delete their own acceptance.
 */

import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'

const firestore = () => firebaseAdmin.app().firestore()

/**
 * A document as it was PRESENTED.
 *
 * The URL alone is worthless as evidence: it is mutable, and answers "what
 * does that page say today?" rather than "what did this person see?". The
 * `sha256` is what makes the record self-contained — it pins the exact text,
 * so the archived snapshot can be proved to be the one that was accepted and
 * any later edit to it is detectable instead of silent.
 */
export interface LegalDocumentReference {
  /** Stable key, e.g. `terms`, `privacy`. */
  key: string
  /** The absolute URL rendered in the consent control. */
  url: string
  /** SHA-256 of the document text as published at this version. */
  sha256?: string
  /** Byte length of that same text. */
  bytes?: number
}

export interface RecordLegalAcceptanceInput {
  /** The document-set version presented. Becomes the document id. */
  version: string
  /** Exactly what was linked, so the record pins content and not just a date. */
  documents: LegalDocumentReference[]
  /** Which door the acceptance came through, e.g. `signup-password`. */
  context: string
  /** Standard clickwrap evidence; both are best-effort. */
  ipAddress?: string | null
  userAgent?: string | null
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
}

/**
 * Write the acceptance record, once, for `version`.
 *
 * @returns `recorded: false` when a record for this version already existed —
 *   a normal outcome (a retry, or a second sign-up attempt on an account that
 *   already agreed), not an error.
 */
export async function recordLegalAcceptance(
  uid: string,
  input: RecordLegalAcceptanceInput,
): Promise<{ recorded: boolean; version: string }> {
  const version = String(input.version ?? '').trim()
  // Loud, not best-effort. Everything else on the sign-up path is allowed to
  // fail quietly because the account still exists and the user is signed in —
  // but an acceptance we cannot attribute to a person and a version is not
  // evidence of anything, and silently keeping half of one is worse than
  // failing where somebody can see it.
  if (!uid) throw new Error('recordLegalAcceptance: uid is required')
  if (!version) throw new Error('recordLegalAcceptance: version is required')

  const ref = (input.firestore ?? firestore())
    .collection('users')
    .doc(uid)
    .collection('legalAcceptances')
    .doc(version)

  const snapshot = await ref.get()
  if (snapshot.exists) return { recorded: false, version }

  await ref.set({
    version,
    documents: input.documents ?? [],
    method: 'clickwrap',
    context: input.context ?? null,
    acceptedAt: FieldValue.serverTimestamp(),
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  })
  return { recorded: true, version }
}

export default recordLegalAcceptance
