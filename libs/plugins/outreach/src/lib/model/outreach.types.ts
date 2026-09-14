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
 * THE OUTREACH DOCUMENT MODEL (AGL-2974).
 *
 * One file both halves import — the console reads these documents, the server
 * routes write them — so a field is spelled once. Client-safe: types and
 * constants only, nothing that reaches Firestore.
 *
 * EVERY DOCUMENT HERE IS SERVER-WRITTEN. The Firestore rules let an
 * org-wide member holding `outreach.use` READ the three org collections on a
 * workspace that carries `features.outreach`, and refuse every client write,
 * because these documents are the sending engine's state: a client that
 * could write a mailbox could lift its daily cap, and one that could write
 * an enrollment could send a step twice. The credential collection is closed
 * to clients entirely.
 *
 * Lean on purpose. Each type carries what the mailbox and sequence work is
 * known to need and nothing speculative; a field is added where the code
 * that reads it lands. Times are epoch milliseconds throughout, the unit
 * `nextDueAtMs` has to be compared in.
 */

/**
 * Where Outreach keeps its records.
 *
 * Three collections under the organization, and one at the top level. The
 * top-level one holds credentials, so it is keyed by an `orgId` FIELD that a
 * path-scoped delete of `orgs/{orgId}` cannot see: the org erasure sweeps it
 * by that field (`libs/tenant/data/admin/src/lib/server/erase.ts` names it as
 * a literal, which the boundary forces, and `outreach.types.spec.ts` holds
 * the two spellings together, along with the rules').
 */
export const OUTREACH_COLLECTIONS = {
  /** `orgs/{orgId}/outreachMailboxes/{mailboxId}` — a connected mailbox. */
  mailboxes: 'outreachMailboxes',
  /** `orgs/{orgId}/outreachSequences/{sequenceId}` — the steps to send. */
  sequences: 'outreachSequences',
  /** `orgs/{orgId}/outreachEnrollments/{enrollmentId}` — one person in one sequence. */
  enrollments: 'outreachEnrollments',
  /**
   * `outreachMailboxCredentials/{mailboxId}` — the provider grant behind a
   * mailbox. TOP-LEVEL and closed to every client, staff included, so the
   * token material never shares a readable path with the mailbox it serves.
   */
  mailboxCredentials: 'outreachMailboxCredentials',
} as const

/** The org-scoped collections, by their {@link OUTREACH_COLLECTIONS} key. */
export type OutreachOrgCollection = Exclude<
  keyof typeof OUTREACH_COLLECTIONS,
  'mailboxCredentials'
>

/** `orgs/{orgId}/<collection>` for one of the org-scoped collections. */
export function outreachOrgCollectionPath(
  orgId: string,
  collection: OutreachOrgCollection,
): string {
  return `orgs/${orgId}/${OUTREACH_COLLECTIONS[collection]}`
}

/** Stamped by the server on every write. */
export interface OutreachTimestamps {
  createdAtMs: number
  updatedAtMs: number
}

/** The mail providers a mailbox can be connected through. */
export const OUTREACH_MAILBOX_PROVIDERS = ['google'] as const
export type OutreachMailboxProvider =
  (typeof OUTREACH_MAILBOX_PROVIDERS)[number]

/**
 * Where a mailbox stands.
 *
 * - `connected` — the grant works and the mailbox may send.
 * - `paused` — a member stopped it; enrollments on it wait.
 * - `reconnect_required` — the provider refused the grant (revoked, expired,
 *   password changed); nothing sends until the rep connects it again.
 * - `disconnected` — a member removed it; its credential is gone.
 */
export const OUTREACH_MAILBOX_STATUSES = [
  'connected',
  'paused',
  'reconnect_required',
  'disconnected',
] as const
export type OutreachMailboxStatus = (typeof OUTREACH_MAILBOX_STATUSES)[number]

/**
 * The hours a mailbox sends in, in its own {@link OutreachMailbox.timezone}.
 * A step that comes due outside the window waits for the next opening.
 */
export interface OutreachSendWindow {
  /** Days of the week it sends on, `0` Sunday through `6` Saturday. */
  days: number[]
  /** Minutes after local midnight the window opens, inclusive. */
  startMinute: number
  /** Minutes after local midnight the window closes, exclusive. */
  endMinute: number
}

/**
 * The counters a mailbox's sending is judged by.
 *
 * `sentToday` is what `dailyCap` refuses against, and it belongs to one
 * mailbox-local day — `sentOnDay` — so a counter from yesterday is read as
 * zero rather than as today's spend.
 */
export interface OutreachMailboxHealth {
  sentToday: number
  /** The local day (`YYYY-MM-DD` in the mailbox's timezone) `sentToday` counts. */
  sentOnDay: string | null
  /** Hard bounces on mail this mailbox sent. */
  bounces: number
  /** Replies detected on Outreach threads. */
  replies: number
  lastSentAtMs: number | null
  /** The last provider error, kept until a later send succeeds. */
  lastErrorAtMs: number | null
  lastErrorCode: string | null
}

/**
 * A rep's own mailbox, connected to send Outreach mail
 * (`orgs/{orgId}/outreachMailboxes/{id}`).
 *
 * Its grant lives in {@link OutreachMailboxCredentials} under the same id.
 */
export interface OutreachMailbox extends OutreachTimestamps {
  id: string
  provider: OutreachMailboxProvider
  /** The account's own address. */
  email: string
  /** The address mail goes out as: the account's, or an alias it may send as. */
  sendAs: string
  /** The From name recipients see. */
  displayName: string
  status: OutreachMailboxStatus
  /** The most mail it sends in one local day, ramp included. */
  dailyCap: number
  window: OutreachSendWindow
  /** IANA zone the window and the day boundary are read in. */
  timezone: string
  /**
   * When the warm-up ramp began, or `null` for a mailbox sending at its full
   * cap. The ramp is measured from here, not from connection, so a paused
   * mailbox can restart it.
   */
  rampStartedAtMs: number | null
  health: OutreachMailboxHealth
  /** The member who connected it, and whose mail it is. */
  connectedByUid: string
}

/**
 * The provider grant behind one mailbox
 * (`outreachMailboxCredentials/{mailboxId}`).
 *
 * Only the fields every reader relies on are declared here; the token
 * material is added by the code that stores it. `orgId` is REQUIRED, not
 * decorative: the org erasure finds these documents by it, and a credential
 * written without one would outlive its workspace.
 *
 * NAME EVERY SEALED FIELD WITH A SECRET WORD — `refreshToken`,
 * `tokenCiphertext`. The personal-data export discloses these documents with
 * secrets redacted, and its redaction reads field names first: a name
 * carrying `token`, `secret` or `credential` is withheld whatever its value,
 * while a neutral name such as `ciphertext` is judged by the value's shape
 * alone and can be disclosed.
 */
export interface OutreachMailboxCredentials extends OutreachTimestamps {
  /** The mailbox id, which is also this document's id. */
  id: string
  orgId: string
  mailboxId: string
  provider: OutreachMailboxProvider
}

/** A sequence's lifecycle. Only an `active` sequence advances its enrollments. */
export const OUTREACH_SEQUENCE_STATUSES = [
  'draft',
  'active',
  'paused',
  'archived',
] as const
export type OutreachSequenceStatus =
  (typeof OUTREACH_SEQUENCE_STATUSES)[number]

/**
 * One email step.
 *
 * Steps are a union on `kind` so a step of another kind joins without
 * reshaping the ones already stored; `email` is the only kind there is.
 */
export interface OutreachEmailStep {
  /** Stable within the sequence, so an edit that reorders steps is traceable. */
  id: string
  kind: 'email'
  /** Days to wait after the previous step is sent (after enrollment, for the first). */
  waitDays: number
  subject: string
  /** The message as its author wrote it; merge fields resolve at send time. */
  body: string
}
export type OutreachSequenceStep = OutreachEmailStep

/** Behavior a sequence applies to every enrollment in it. */
export interface OutreachSequenceSettings {
  /** Stop an enrollment when its recipient replies. */
  stopOnReply: boolean
}

/** An ordered set of steps sent from one mailbox (`orgs/{orgId}/outreachSequences/{id}`). */
export interface OutreachSequence extends OutreachTimestamps {
  id: string
  name: string
  /** The site whose CRM the enrolled people are records of. */
  hostId: string
  /** The mailbox every step is sent from. */
  mailboxId: string
  steps: OutreachSequenceStep[]
  settings: OutreachSequenceSettings
  status: OutreachSequenceStatus
}

/** Where one person's run through a sequence stands. */
export const OUTREACH_ENROLLMENT_STATUSES = [
  'active',
  'paused',
  'completed',
  'stopped',
] as const
export type OutreachEnrollmentStatus =
  (typeof OUTREACH_ENROLLMENT_STATUSES)[number]

/** Why an enrollment was `stopped` before its last step. */
export const OUTREACH_STOP_REASONS = [
  'replied',
  'bounced',
  'unsubscribed',
  'manual',
  'mailbox_unavailable',
] as const
export type OutreachStopReason = (typeof OUTREACH_STOP_REASONS)[number]

/** One person in one sequence (`orgs/{orgId}/outreachEnrollments/{id}`). */
export interface OutreachEnrollment extends OutreachTimestamps {
  id: string
  sequenceId: string
  /** The CRM contact the person is. */
  contactId: string
  /** The address the steps go to, captured at enrollment. */
  email: string
  hostId: string
  mailboxId: string
  /** The index into `steps` of the NEXT step to send. */
  stepIndex: number
  /** When that step comes due, or `null` when nothing is waiting. */
  nextDueAtMs: number | null
  status: OutreachEnrollmentStatus
  /** Set exactly when `status` is `stopped`. */
  stopReason: OutreachStopReason | null
  /** The provider thread the steps are sent into, once the first has gone. */
  gmailThreadId: string | null
}
