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
 * One mailbox-local day's sending, as the health panel sums it (AGL-2978).
 */
export interface OutreachMailboxDailyHealth {
  sent: number
  bounces: number
  replies: number
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
  /**
   * Per mailbox-local day (`YYYY-MM-DD`), the sends, bounces and replies
   * counted on it (AGL-2978). The Mailboxes panel shows the last seven days
   * summed; the sending runtime increments the day it counts on and may drop
   * days older than a week. Absent, or empty, until the first send.
   */
  daily?: Record<string, OutreachMailboxDailyHealth>
}

/**
 * An address a connected Google account may send as, which Gmail has
 * verified — its own address, or an alias whose ownership Gmail confirmed
 * (AGL-2978). Only these are offered as a mailbox's `sendAs`.
 */
export interface OutreachSendAsAddress {
  email: string
  /** The name Gmail holds for the address, `''` when it holds none. */
  displayName: string
  /** The account's own address. */
  isPrimary: boolean
  /** The address Gmail sends as by default. */
  isDefault: boolean
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
  /**
   * The verified addresses `sendAs` may be, as Gmail listed them at the last
   * connect (AGL-2978). A changed alias shows up here on the next reconnect.
   */
  sendAsOptions: OutreachSendAsAddress[]
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
  /** When the grant behind it was last connected (AGL-2978). */
  connectedAtMs: number
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

/*==========================================
 * SEQUENCES (AGL-2979).
 *
 * The limits are the outbound playbook's: a person gets at most four emails
 * from one sequence, spaced by business days, and the tasks between them are
 * the rep's own touches — a LinkedIn note, a call. The engine
 * (`../engine/sequence-validation.ts`) holds a stored sequence to them.
 *==========================================*/

/** The most steps one sequence holds, emails and tasks together. */
export const OUTREACH_MAX_STEPS = 8

/** The most of those steps that send an email. */
export const OUTREACH_MAX_EMAIL_STEPS = 4

/** The longest wait one step may carry, in business days. */
export const OUTREACH_MAX_STEP_DELAY_BUSINESS_DAYS = 30

/**
 * The shortest wait before an email that follows an earlier email. The first
 * email may wait `0` — "the next opening of the window", or the same day as
 * a task before it — and so may a task, but each later email waits at least
 * this long after the step before it.
 */
export const OUTREACH_MIN_EMAIL_FOLLOW_UP_BUSINESS_DAYS = 1

/**
 * One email step.
 *
 * Steps are a union on `kind`, so a later kind joins without reshaping the
 * ones already stored.
 */
export interface OutreachEmailStep {
  /** Stable within the sequence, so an edit that reorders steps is traceable. */
  id: string
  kind: 'email'
  /**
   * Business days to wait after the previous step, counted in the mailbox's
   * zone — after enrollment for the first step, where `0` means the next
   * opening of the sending window.
   */
  delayBusinessDays: number
  /**
   * The subject, merge fields allowed. Required on the first email and on
   * any email that starts a new thread; an in-thread email is sent as `Re:`
   * the thread's own subject, so its field is not read.
   */
  subject: string
  /**
   * Whether the email goes out as a reply in the thread the earlier emails
   * started. True by default for every email after the first; the first
   * email always starts the thread, whatever this says.
   */
  replyInThread: boolean
  /** Plain text with merge fields, as its author wrote it; `''` when `templateId` is set. */
  body: string
  /**
   * A CRM email template (`orgs/{orgId}/crmEmailTemplates/{id}`) whose body
   * is sent instead of `body`, or `null`. Only the body is taken from it: the
   * step's own subject is the one that is sent.
   */
  templateId: string | null
}

/** The rep's own touches a task step asks for. */
export const OUTREACH_TASK_KINDS = ['linkedin', 'call', 'todo'] as const
export type OutreachTaskKind = (typeof OUTREACH_TASK_KINDS)[number]

export const OUTREACH_TASK_KIND_LABELS: Record<OutreachTaskKind, string> = {
  linkedin: 'LinkedIn',
  call: 'Call',
  todo: 'To-do',
}

/** One task step: a CRM task for the rep, created when the step comes due. */
export interface OutreachTaskStep {
  id: string
  kind: 'task'
  taskKind: OutreachTaskKind
  /** What the task says, e.g. "Connect on LinkedIn". */
  title: string
  /** Business days after the previous step; `0` is the same day. */
  delayBusinessDays: number
}

export type OutreachSequenceStep = OutreachEmailStep | OutreachTaskStep

/** The countries a new sequence sends to: the United States alone. */
export const OUTREACH_DEFAULT_ALLOWED_COUNTRIES: readonly string[] = ['US']

/** Behavior a sequence applies to every enrollment in it. */
export interface OutreachSequenceSettings {
  /**
   * The hours this sequence sends in, replacing its mailbox's own window;
   * `null` sends in the mailbox's. Read in the mailbox's zone either way.
   */
  window: OutreachSendWindow | null
  /**
   * ISO-3166-1 alpha-2 codes a recipient may be in, uppercase. Default
   * {@link OUTREACH_DEFAULT_ALLOWED_COUNTRIES}: Canada, the United Kingdom
   * and most of the EU need a consent basis a cold email does not have.
   */
  allowedCountries: string[]
  /** Whether a contact who is already a customer may be enrolled. Default `false`. */
  allowCustomers: boolean
}

/** An ordered set of steps sent from one mailbox (`orgs/{orgId}/outreachSequences/{id}`). */
export interface OutreachSequence extends OutreachTimestamps {
  id: string
  name: string
  /** The site whose CRM the enrolled people are records of. */
  hostId: string
  /**
   * The mailbox every email step is sent from. A setting of the sequence,
   * kept beside `settings` rather than inside it because enrollments and a
   * mailbox's own screens select sequences by it.
   */
  mailboxId: string
  steps: OutreachSequenceStep[]
  settings: OutreachSequenceSettings
  status: OutreachSequenceStatus
}

/*==========================================
 * ENROLLMENTS (AGL-2979).
 *==========================================*/

/**
 * Where one person's run through a sequence stands.
 *
 * `active` sends and `paused` waits. The rest end the sending, and each says
 * why: `finished` sent every step, `replied` heard back, `bounced` reached a
 * mailbox that does not exist, `opted_out` was asked to stop, `stopped` was
 * ended by a member or a gate, `failed` could not be sent. The transitions
 * between them are the engine's (`../engine/enrollment-state.ts`).
 */
export const OUTREACH_ENROLLMENT_STATUSES = [
  'active',
  'paused',
  'finished',
  'replied',
  'bounced',
  'opted_out',
  'stopped',
  'failed',
] as const
export type OutreachEnrollmentStatus =
  (typeof OUTREACH_ENROLLMENT_STATUSES)[number]

/**
 * Why an enrollment is not `active`, recorded beside the status. `finished`
 * needs none; each other status allows the reasons
 * `OUTREACH_STOP_REASONS_BY_STATUS` names.
 */
export const OUTREACH_STOP_REASONS = [
  /** A person wrote back in the thread. */
  'reply',
  /** The recipient's server refused the address for good. */
  'hard_bounce',
  /** A reply asked not to be emailed again. */
  'opt_out_reply',
  /** The unsubscribe link or header was used. */
  'unsubscribe',
  /** The address is on the organization's do-not-contact list. */
  'do_not_contact',
  /** A gate refused the next send — the person became a customer, say. */
  'gate',
  /** A member paused or stopped it. */
  'manual',
  /** The sequence was archived with the person still in it. */
  'sequence_archived',
  /** The provider refused the send for good, or the email could not be composed. */
  'send_failed',
] as const
export type OutreachStopReason = (typeof OUTREACH_STOP_REASONS)[number]

/** The statuses a stop reason is recorded with, and the reasons each allows. */
export const OUTREACH_STOP_REASONS_BY_STATUS: Readonly<
  Record<
    Exclude<OutreachEnrollmentStatus, 'active' | 'finished'>,
    readonly OutreachStopReason[]
  >
> = {
  paused: ['manual'],
  replied: ['reply'],
  bounced: ['hard_bounce'],
  opted_out: ['opt_out_reply', 'unsubscribe', 'do_not_contact'],
  stopped: ['manual', 'gate', 'sequence_archived'],
  failed: ['send_failed'],
}

/**
 * What a rep confirms before a COLD contact is enrolled — one with no
 * inbound capture behind them — each recorded with who confirmed it and
 * when, because each is a fact only the rep can know:
 *
 * - `us_business_address`: the address is a business address in the US;
 * - `published_or_given`: they or their company published it, or they gave
 *   it to us — never guessed from a name or bought on a list;
 * - `verified_deliverable`: a verifier said it accepts mail.
 */
export const OUTREACH_ATTESTATION_KINDS = [
  'us_business_address',
  'published_or_given',
  'verified_deliverable',
] as const
export type OutreachAttestationKind = (typeof OUTREACH_ATTESTATION_KINDS)[number]

/** The sentence a rep ticks for each attestation. */
export const OUTREACH_ATTESTATION_LABELS: Record<OutreachAttestationKind, string> = {
  us_business_address: 'This is a US business address',
  published_or_given:
    'They or their company published this address, or they gave it to us',
  verified_deliverable: 'This address was verified as deliverable',
}

/** One confirmation, as stored. */
export interface OutreachAttestation {
  /** The member who confirmed it. */
  uid: string
  atMs: number
}

/** The confirmations an enrollment carries, by kind. */
export type OutreachAttestations = Partial<
  Record<OutreachAttestationKind, OutreachAttestation>
>

/** The longest personal line an enrollment keeps: one sentence, not a letter. */
export const OUTREACH_PERSONAL_LINE_MAX = 300

/** One person in one sequence (`orgs/{orgId}/outreachEnrollments/{id}`). */
export interface OutreachEnrollment extends OutreachTimestamps {
  id: string
  sequenceId: string
  /** The CRM contact the person is. */
  contactId: string
  /** The address the steps go to, normalized, captured at enrollment. */
  email: string
  hostId: string
  mailboxId: string
  /** The index into `steps` of the NEXT step to run. */
  stepIndex: number
  /** When that step comes due, or `null` when nothing is waiting. */
  nextDueAtMs: number | null
  status: OutreachEnrollmentStatus
  /** Why the status is not `active`; `null` while active and once finished. */
  stopReason: OutreachStopReason | null
  /** Plain-language detail: the gate's reason, the bounce's diagnostic. */
  stopDetail: string | null
  stoppedAtMs: number | null
  /** The member who paused or stopped it; `null` when the engine did. */
  stoppedByUid: string | null
  /**
   * The rep's signal sentence — why this person, now — merged into the
   * steps as `{{enrollment.personalLine}}`. Required for a cold contact.
   */
  personalLine: string
  /** Whether the contact was cold (no inbound capture) when enrolled. */
  cold: boolean
  attestations: OutreachAttestations
  /** The member who enrolled the person. */
  enrolledByUid: string
  /** The provider thread the next in-thread email is sent into, once one exists. */
  gmailThreadId: string | null
  /** Every provider thread this enrollment has sent into, oldest first — what reply sync watches. */
  gmailThreadIds: string[]
  /** The subject the current thread was started with, as sent. */
  threadSubject: string | null
  /**
   * The `Message-ID`s of the emails sent into the current thread, oldest
   * first, angle brackets included: the next in-thread email answers the
   * last and names them all in `References`.
   */
  messageIds: string[]
  /** When the last step ran. */
  lastSentAtMs: number | null
}

/*==========================================
 * ORGANIZATION SETTINGS (AGL-2979).
 *==========================================*/

/**
 * What every Outreach email's footer says about who sent it — the
 * identification and the postal address CAN-SPAM requires on commercial
 * mail. The composer refuses to write an email without a legal name and a
 * postal address, and a sequence cannot be activated without them.
 */
export interface OutreachOrgSettings {
  /** The organization's legal name, as the footer prints it: "Example Co LLC". */
  legalName: string
  /**
   * The name the solicitation sentence uses when it is not the legal name:
   * "This is a business solicitation from Example Co." `''` uses the legal
   * name.
   */
  brandName: string
  /**
   * A valid physical postal address: a street address, a USPS PO box, or a
   * private mailbox registered with the USPS. Line breaks are printed as
   * commas.
   */
  postalAddress: string
}
