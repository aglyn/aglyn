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

/* -------------------------------------------------------------------------
 * READING the record (AGL-2316)
 *
 * Everything above writes. Until AGL-2316 nothing read, which made both
 * promises in this module's header undeliverable: the §18.5 opt-out window
 * was unprovable, and "re-acceptance is additive" described a mechanism with
 * no trigger, because nobody ever compared an accepted version against a
 * current one.
 *
 * WHICH STRING IS "THE CURRENT VERSION" — and why nothing new is invented
 * here. `apps/console/constants/legal-documents.ts` has carried
 * `LEGAL_DOCUMENT_VERSION` since AGL-1497; it is `v6` today, it is what the
 * writer route already stamps on every record, and `v1`..`v6` all exist as
 * immutable snapshots under `apps/console/constants/legal/`. AGL-2316 was
 * filed believing no such constant existed — it greps for `LEGAL_VERSION` and
 * `legalVersion`, which is not its name. So the scheme is not a decision; it
 * is an existing, published fact, and re-basing it (on an effective date, say)
 * would orphan every acceptance already written. The constants file argues the
 * date case and rejects it: the masters carry an unfilled `[EFFECTIVE DATE]`,
 * and ToS §5.3 changes the Terms by MOVING the "Last updated" date, so the
 * date is the field that shifts under the identifier rather than being one.
 *
 * The current version is a PARAMETER here rather than an import. This library
 * is consumed by the console and by the tenant app, and the constant plus its
 * snapshots live in the console; passing it in keeps the comparison logic on
 * the server library and the published fact in the one place a publish edits.
 * ------------------------------------------------------------------------- */

/**
 * ToS §18.5: written notice to legal@aglyn.com "within 30 days of first
 * accepting these Terms".
 *
 * Pinned here, and pinned AGAINST THE PUBLISHED TEXT by
 * `apps/console/specs/legal-acceptance-optout-window.spec.ts`, which re-reads
 * the number out of the snapshot for the current version. A window that
 * silently disagreed with the document it implements would compute a
 * confident wrong answer, which is worse than computing none.
 */
export const ARBITRATION_OPT_OUT_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The numeric rank of a `v<N>` version, or `null` when the id is not of that
 * shape. `apps/console/specs/legal-document-version.spec.ts` already requires
 * `/^v\d+$/` of the live constant, so `null` here means a stored record from
 * some other scheme — not a normal case, and deliberately not guessed at.
 */
export function parseLegalDocumentVersion(version: string): number | null {
  const match = /^v(\d+)$/.exec(String(version ?? '').trim())
  if (!match) return null
  const rank = Number(match[1])
  return Number.isFinite(rank) ? rank : null
}

/**
 * Order two version ids: negative when `a` is older, positive when newer, 0
 * when equal.
 *
 * An unparseable id sorts OLDER than any `v<N>`, so an unrecognised stored
 * version can never suppress a re-acceptance prompt by looking newest. Two
 * unparseable ids fall back to a string compare, which is arbitrary but
 * stable — the alternative is a comparator that is not a total order, and
 * `Array#sort` with one of those produces a different answer per engine.
 */
export function compareLegalDocumentVersions(a: string, b: string): number {
  const left = parseLegalDocumentVersion(a)
  const right = parseLegalDocumentVersion(b)
  if (left !== null && right !== null) return left - right
  if (left !== null) return 1
  if (right !== null) return -1
  return String(a ?? '').localeCompare(String(b ?? ''))
}

/** One stored acceptance, flattened for transport to a surface. */
export interface StoredLegalAcceptance {
  version: string
  /** ISO-8601, from the SERVER timestamp. Null only if the write was partial. */
  acceptedAt: string | null
  /** The door it came through, e.g. `signup-password`, `reaccept-console`. */
  context: string | null
  method: string | null
  ipAddress: string | null
  userAgent: string | null
  /** What was presented, with the content hashes that pin it. */
  documents: LegalDocumentReference[]
}

/**
 * The §18.5 clock. Measured from the FIRST acceptance of ANY version, not
 * from the current one: the clause says "first accepting these Terms", and a
 * window that restarted on every re-acceptance would hand a returning
 * customer a right the document does not give them — and would silently take
 * one away in the other direction if it were measured from the newest.
 */
export interface ArbitrationOptOutWindow {
  /** ISO of the earliest acceptance on file; null when there is none. */
  firstAcceptedAt: string | null
  /** ISO of the last instant notice may be sent; null when unmeasurable. */
  deadline: string | null
  /**
   * Null — NOT false — when there is nothing to measure from. "We hold no
   * acceptance" and "the window has closed" are different answers to a
   * dispute, and collapsing them is how a staff surface asserts something
   * nobody verified.
   */
  open: boolean | null
  /** Whole days left, 0 once closed; null when unmeasurable. */
  daysRemaining: number | null
}

export type LegalReacceptanceReason =
  /** Current version is on file — nothing to ask for. */
  | 'none'
  /** No acceptance of any version. Pre-AGL-1497 accounts, and SSO/invite doors. */
  | 'never-accepted'
  /** They accepted, but an older version than the one published now. */
  | 'version-superseded'

export interface LegalAcceptanceStatus {
  /** The version the caller says is current — echoed so a surface can show it. */
  currentVersion: string
  /** True when THIS version is on file. */
  accepted: boolean
  /** Every accepted version, oldest first. */
  acceptedVersions: string[]
  latestAcceptedVersion: string | null
  /** ISO of the acceptance of `currentVersion`, when there is one. */
  currentVersionAcceptedAt: string | null
  reacceptanceRequired: boolean
  reacceptanceReason: LegalReacceptanceReason
  arbitration: ArbitrationOptOutWindow
  /** The full history, oldest first — the evidence a dispute is answered from. */
  acceptances: StoredLegalAcceptance[]
}

function toIso(value: unknown): string | null {
  if (!value) return null
  const asDate = (value as { toDate?: () => Date })?.toDate?.()
  if (asDate instanceof Date && !Number.isNaN(asDate.getTime())) {
    return asDate.toISOString()
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

/**
 * Read the whole (tiny) acceptance history for one user.
 *
 * A plain collection `get()` with NO `orderBy` and NO `where`, sorted in
 * memory. That is not laziness: a query with an order or a filter is the kind
 * that needs an index, indexes here deploy by hand, and a read that throws
 * `FAILED_PRECONDITION` on the one page a dispute is answered from is the
 * worst possible failure for this feature. One document per version means the
 * collection is single digits, so the sort is free.
 */
export async function readLegalAcceptances(
  uid: string,
  options: { firestore?: any } = {},
): Promise<StoredLegalAcceptance[]> {
  if (!uid) throw new Error('readLegalAcceptances: uid is required')
  const snapshot = await (options.firestore ?? firestore())
    .collection('users')
    .doc(uid)
    .collection('legalAcceptances')
    .get()

  const records: StoredLegalAcceptance[] = (snapshot?.docs ?? []).map(
    (doc: any) => ({
      // The document id IS the version (see the header). Falling back to it
      // means a record whose `version` field never landed is still usable.
      version: String(doc.get('version') ?? doc.id ?? ''),
      acceptedAt: toIso(doc.get('acceptedAt')),
      context: (doc.get('context') as string) ?? null,
      method: (doc.get('method') as string) ?? null,
      ipAddress: (doc.get('ipAddress') as string) ?? null,
      userAgent: (doc.get('userAgent') as string) ?? null,
      documents: (doc.get('documents') as LegalDocumentReference[]) ?? [],
    }),
  )
  return records.sort((a, b) =>
    compareLegalDocumentVersions(a.version, b.version),
  )
}

/**
 * Turn a history into the two answers AGL-2316 asks for: did this person
 * accept and which version, and is the §18.5 window still open.
 *
 * Pure, and separated from the read so both boundaries are testable without a
 * Firestore double.
 */
export function evaluateLegalAcceptance(input: {
  acceptances: StoredLegalAcceptance[]
  currentVersion: string
  /** Injectable for tests; defaults to now. */
  now?: Date
  optOutDays?: number
}): LegalAcceptanceStatus {
  const currentVersion = String(input.currentVersion ?? '').trim()
  const acceptances = [...(input.acceptances ?? [])].sort((a, b) =>
    compareLegalDocumentVersions(a.version, b.version),
  )
  const now = input.now ?? new Date()
  const optOutDays = input.optOutDays ?? ARBITRATION_OPT_OUT_DAYS

  const acceptedVersions = acceptances.map((record) => record.version)
  const latestAcceptedVersion =
    acceptedVersions.length > 0
      ? acceptedVersions[acceptedVersions.length - 1]
      : null
  const currentRecord = acceptances.find(
    (record) => record.version === currentVersion,
  )

  // FIRST acceptance by TIME, not by version rank. They usually agree, but a
  // backfill or an out-of-order repair would make the ranks lie, and §18.5's
  // clock is a clock.
  const timestamps = acceptances
    .map((record) => record.acceptedAt)
    .filter((iso): iso is string => Boolean(iso))
    .sort()
  const firstAcceptedAt = timestamps.length > 0 ? timestamps[0] : null

  let arbitration: ArbitrationOptOutWindow = {
    firstAcceptedAt: null,
    deadline: null,
    open: null,
    daysRemaining: null,
  }
  if (firstAcceptedAt) {
    const deadlineMs = new Date(firstAcceptedAt).getTime() + optOutDays * DAY_MS
    const remainingMs = deadlineMs - now.getTime()
    arbitration = {
      firstAcceptedAt,
      deadline: new Date(deadlineMs).toISOString(),
      // INCLUSIVE of the deadline instant. "within 30 days of first
      // accepting" includes the thirtieth day, and the cheap `<` would close
      // the window a full day early for anyone who read the clause literally.
      open: remainingMs >= 0,
      daysRemaining: remainingMs > 0 ? Math.ceil(remainingMs / DAY_MS) : 0,
    }
  }

  let reacceptanceReason: LegalReacceptanceReason = 'none'
  if (acceptances.length === 0) reacceptanceReason = 'never-accepted'
  else if (
    currentVersion &&
    compareLegalDocumentVersions(currentVersion, latestAcceptedVersion) > 0
  ) {
    reacceptanceReason = 'version-superseded'
  }

  return {
    currentVersion,
    accepted: Boolean(currentRecord),
    acceptedVersions,
    latestAcceptedVersion,
    currentVersionAcceptedAt: currentRecord?.acceptedAt ?? null,
    reacceptanceRequired: reacceptanceReason !== 'none',
    reacceptanceReason,
    arbitration,
    acceptances,
  }
}

/** Read + evaluate in one call — what every surface actually wants. */
export async function getLegalAcceptanceStatus(
  uid: string,
  options: { currentVersion: string; firestore?: any; now?: Date },
): Promise<LegalAcceptanceStatus> {
  const acceptances = await readLegalAcceptances(uid, {
    firestore: options.firestore,
  })
  return evaluateLegalAcceptance({
    acceptances,
    currentVersion: options.currentVersion,
    now: options.now,
  })
}
