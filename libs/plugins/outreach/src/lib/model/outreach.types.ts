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
 * org-wide member holding `outreach.use` READ the org collections on a
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
 * Five collections under the organization, and one at the top level. The
 * org-scoped ones are erased with the org, whose erasure deletes the whole
 * `orgs/{orgId}` tree. The top-level one holds credentials, so it is keyed by
 * an `orgId` FIELD that a path-scoped delete of `orgs/{orgId}` cannot see:
 * the org erasure sweeps it by that field
 * (`libs/tenant/data/admin/src/lib/server/erase.ts` names it as a literal,
 * which the boundary forces, and `outreach.types.spec.ts` holds the two
 * spellings together, along with the rules').
 */
export const OUTREACH_COLLECTIONS = {
  /** `orgs/{orgId}/outreachMailboxes/{mailboxId}` — a connected mailbox. */
  mailboxes: 'outreachMailboxes',
  /** `orgs/{orgId}/outreachSequences/{sequenceId}` — the steps to send. */
  sequences: 'outreachSequences',
  /** `orgs/{orgId}/outreachEnrollments/{enrollmentId}` — one person in one sequence. */
  enrollments: 'outreachEnrollments',
  /**
   * `orgs/{orgId}/outreachSettings/{settingsId}` — the organization's own
   * Outreach settings, one document per concern. `compliance` holds who
   * every email says sent it and the countries Outreach may send to.
   */
  settings: 'outreachSettings',
  /**
   * `orgs/{orgId}/outreachDoNotContact/{key}` — the addresses Outreach never
   * emails for this organization, keyed by `outreachDoNotContactKey`.
   */
  doNotContact: 'outreachDoNotContact',
  /**
   * `orgs/{orgId}/outreachDoNotContactDomains/{domain}` — the domains
   * Outreach never emails for this organization (AGL-3244), keyed by the
   * domain itself: a domain names a company, not a person.
   */
  doNotContactDomains: 'outreachDoNotContactDomains',
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
  /**
   * The mailbox's most recent sends, newest last, at most
   * `OUTREACH_BOUNCE_RATE_WINDOW_SENDS` of them, each marked when a hard
   * bounce came back for it (AGL-2981): the window the bounce-rate pause is
   * judged over. A send is named by a digest of its `Message-ID`, never by
   * its recipient.
   */
  recentSends?: OutreachRecentSend[]
  /** When a reply last called this mailbox's email spam (AGL-2981). */
  lastComplaintAtMs?: number | null
}

/** One send in {@link OutreachMailboxHealth.recentSends}. */
export interface OutreachRecentSend {
  /** A digest of the send's `Message-ID`: what a bounce is matched to. */
  id: string
  atMs: number
  bounced: boolean
}

/** Why a mailbox paused itself (AGL-2981): the engine's health decision, kept. */
export interface OutreachMailboxAutoPause {
  reason: 'bounces_today' | 'bounce_rate' | 'complaint'
  /** The sentence the mailbox's card shows. */
  message: string
  atMs: number
  /** For a complaint, when resuming stops being premature; `null` otherwise. */
  untilMs: number | null
}

/** Where a mailbox's reply and bounce sync has read to (AGL-2981). */
export interface OutreachMailboxSync {
  /** Everything received before this was read by an earlier run, epoch ms. */
  throughMs: number
  /** Gmail ids of messages outside any enrollment's thread already handled. */
  handledMessageIds: string[]
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
  /**
   * Set when the mailbox paused ITSELF on its health (AGL-2981), and cleared
   * when a member pauses or resumes it; absent otherwise.
   */
  autoPause?: OutreachMailboxAutoPause | null
  /** The reply and bounce sync's place in the mailbox (AGL-2981). */
  sync?: OutreachMailboxSync | null
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
  /**
   * Whether the links in this sequence's emails are rewritten so clicks are
   * counted (AGL-3239). Default `false`, and `false` on every sequence
   * written before the setting existed: turning it on changes what the
   * recipient sees in the body, which is not a change to make on anyone's
   * behalf.
   *
   * It buys the one engagement number a plain-text sequence can honestly
   * report. It costs a visible link: the destination in the body becomes a
   * signed link on the console that forwards to it. There is no equivalent
   * setting for opens, because a pixel needs an HTML part — see
   * `../engine/click-tracking.ts`.
   */
  trackClicks: boolean
}

/*==========================================
 * WHAT A SEQUENCE MEASURED (AGL-3239).
 *
 * Counters on the sequence document, incremented by the sending runtime and
 * by the click route. They are NOT derived from the enrollments on read: the
 * console lists enrollments a page at a time, so a rollup taken over what is
 * loaded would report the first page's numbers as the sequence's.
 *
 * Every field is optional and every absence means "not recorded", never
 * zero. The distinction is the whole of `campaign-report.ts`'s honesty and
 * it is kept here for the same reason: a sequence that ran before this
 * existed has no counters, and reporting its click rate as 0% would publish
 * a fact about our schema as a fact about its recipients.
 *=========================================*/

/**
 * The per-destination click rollup under one sequence:
 * `orgs/{orgId}/outreachSequences/{id}/reports/links`.
 *
 * One document per sequence, holding a bounded map — the campaign rollup's
 * own shape and its own cap, so "a link" means the same thing in a rep's
 * report and a marketer's. Here rather than beside the writer, because the
 * console's listener is a browser module and the writer is not.
 */
export const OUTREACH_LINK_ROLLUP_PATH = ['reports', 'links'] as const

/** The counters one sequence is judged by. */
export interface OutreachSequenceStats {
  /** Email steps that left. One person getting four emails counts four. */
  sent?: number
  /**
   * Distinct enrollments that have had at least one email — the denominator
   * of every engagement rate, and the thing `sent` is not.
   */
  people?: number
  /**
   * At least one email of this sequence went out with its links rewritten.
   *
   * Absent is NOT false; it is "never recorded", which is what every
   * sequence sent before the setting existed reads as. Either way the report
   * withholds the click rate rather than showing 0% — see
   * {@link OutreachSequenceStats} above.
   */
  clickTracked?: boolean
  /** Click EVENTS judged a person's. One reader clicking twice counts two. */
  clicks?: number
  /** Enrollments whose FIRST human click was seen: the rate's numerator. */
  uniqueClicks?: number
  /**
   * Clicks a link scanner or a security gateway made, counted apart and
   * never in the rate (`../engine/click-tracking.ts`). Shown, not hidden:
   * a large number here is the reader's evidence that the small number
   * beside it is the real one.
   */
  machineClicks?: number
  /** When a person last followed a link. */
  lastClickAtMs?: number | null
}

/** What one enrollment did with the links it was sent (AGL-3239). */
export interface OutreachEnrollmentEngagement {
  /** Click events judged this person's, machines excluded. */
  clicks: number
  /** The first, which is what makes them one of the sequence's `uniqueClicks`. */
  firstClickAtMs: number | null
  lastClickAtMs: number | null
  /** The destination they followed last, as `campaignLinkKey` reduces it. */
  lastClickUrl: string | null
  /** Clicks on this person's links that were a machine's. */
  machineClicks: number
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
  /**
   * The campaigns the sequence is in (AGL-3254): container ids from the
   * site's `emailCampaigns`, under the field every campaign member carries
   * (`CAMPAIGN_MEMBERSHIP_FIELD`). Everyone enrolled gains them on their
   * own record at enroll time, and what the sequence produces is credited
   * to them. Absent on a sequence saved before it could join one.
   */
  campaignIds?: string[]
  /**
   * What it measured (AGL-3239). Absent until the first email leaves, and
   * absent forever on a sequence that finished before the counters existed.
   */
  stats?: OutreachSequenceStats
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

/**
 * Which CRM record an enrollment names (AGL-3234). A person is a LEAD until
 * somebody qualifies them and a CONTACT after, and a sequence works either:
 * an enrollment made on a lead follows the lead to the contact it becomes,
 * so the thread and the steps carry on as one enrollment.
 */
export const OUTREACH_ENROLLMENT_TARGETS = ['contact', 'lead'] as const
export type OutreachEnrollmentTarget = (typeof OUTREACH_ENROLLMENT_TARGETS)[number]

/** One person in one sequence (`orgs/{orgId}/outreachEnrollments/{id}`). */
export interface OutreachEnrollment extends OutreachTimestamps {
  id: string
  sequenceId: string
  /**
   * The record the person is (AGL-3234): `contact` for a CRM contact,
   * `lead` for a lead the sequence's site holds. A stored enrollment with
   * no target is a contact's — every enrollment was, before leads could be
   * sequenced.
   */
  target: OutreachEnrollmentTarget
  /**
   * The CRM contact the person is — `''` while the enrollment targets a
   * lead that has not converted. Filled in, beside `target: 'contact'`, the
   * moment the lead becomes a contact.
   */
  contactId: string
  /**
   * `hosts/{hostId}/leads/{leadId}` — the person key — for an enrollment
   * made on a lead; kept once the lead converts, so the lead's page still
   * lists the sequence. `null` for an enrollment made on a contact.
   */
  leadId: string | null
  /**
   * The person's name as the sending site knew it at enrollment, `''` when
   * it had none — what the enrollments table shows beside the address,
   * without a read of every record on the page (AGL-2980).
   */
  contactName: string
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
  /**
   * A sending run's hold on the step it is running (AGL-2981): taken in a
   * transaction before the step runs, cleared when it is recorded. Absent
   * or `null` while no run holds one.
   */
  sendClaim?: OutreachSendClaim | null
  /** Every step the runtime ran, oldest first (AGL-2981). */
  stepRecords?: OutreachStepRecord[]
  /** Gmail ids of this enrollment's thread messages the sync has handled, the last hundred. */
  syncedMessageIds?: string[]
  /**
   * What this person did with the links they were sent (AGL-3239). Absent
   * until their first click, which is why the table reads an absence as
   * "no clicks" only for a sequence that tracks them at all.
   */
  engagement?: OutreachEnrollmentEngagement
  /**
   * The sequence's campaigns as they stood when the person was enrolled
   * (AGL-3254): what every outcome of this enrollment is credited to. A
   * campaign the sequence joins later does not claim the people already
   * in it, and one it leaves keeps what it was credited with.
   */
  campaignIds?: string[]
}

/** A sending run's claim on one enrollment's step (AGL-2981). */
export interface OutreachSendClaim {
  /** The run that holds it. */
  token: string
  atMs: number
  stepIndex: number
  /**
   * The `Message-ID` an email step goes out with, minted before the send, so
   * a claim a run died holding is settled by looking for the message rather
   * than by sending it again. `null` for a task step.
   */
  messageId: string | null
}

/** One step the runtime ran for an enrollment (AGL-2981). */
export interface OutreachStepRecord {
  stepIndex: number
  stepId: string
  kind: 'email' | 'task'
  atMs: number
  /** Gmail's id for the sent message. */
  gmailMessageId?: string
  /** Gmail's thread the message went into. */
  gmailThreadId?: string
  /** The `Message-ID` it went out with, angle brackets included. */
  messageId?: string
  /** The subject as sent. */
  subject?: string
  /** The record system's task for a task step; `null` when none could be filed. */
  taskId?: string | null
  /**
   * The destinations this email's links were rewritten to point at, in the
   * order a click token indexes them (AGL-3239). Absent on a step that
   * carried no links, and on every step sent before tracking existed.
   *
   * Kept so the console can say WHICH link a person followed without the
   * token having to carry the URL back to us, and so a rewritten body can be
   * read afterwards for what it actually offered them.
   */
  links?: string[]
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
   * "This is a sales email from Example Co." `''` uses the legal
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

/** The id of the compliance document in the `settings` collection. */
export const OUTREACH_COMPLIANCE_SETTINGS_ID = 'compliance'

/**
 * The organization's Outreach compliance settings
 * (`orgs/{orgId}/outreachSettings/compliance`): the footer's sender identity,
 * and the countries Outreach may send to at all.
 *
 * `allowedCountries` is a CEILING over every sequence's own list — a
 * sequence sends only to the countries both name — so narrowing it here
 * narrows every sequence at once, without editing any of them. Default
 * {@link OUTREACH_DEFAULT_ALLOWED_COUNTRIES}.
 */
export interface OutreachComplianceSettings extends OutreachOrgSettings {
  /** ISO-3166-1 alpha-2 codes, uppercase, in the order they were chosen. */
  allowedCountries: string[]
}

/** The compliance settings as stored, with who changed them last. */
export interface OutreachComplianceSettingsDocument
  extends OutreachComplianceSettings {
  /** `0` until the organization first saves them. */
  updatedAtMs: number
  updatedByUid: string | null
}

/*==========================================
 * DO NOT CONTACT (AGL-2980).
 *
 * The organization's own list of addresses Outreach never emails, whoever
 * enrolls them and from whichever site. A member adds one by hand; the
 * sending runtime adds one when a reply asks to be left alone, when the
 * unsubscribe link is used, and when an address bounces for good.
 *
 * AN ENTRY CARRIES NO ADDRESS. Its id is `outreachDoNotContactKey(email)` —
 * the same hash the platform's suppression lists key by — and that is all a
 * lookup needs, since every caller holds the address it is about to use.
 * So the list keeps working after a person is erased from the workspace,
 * which is exactly when a promise not to email them must still hold, while
 * holding nothing that identifies them.
 *==========================================*/

/** Why an address is on the list. */
export const OUTREACH_DO_NOT_CONTACT_REASONS = [
  /** A member put it there. */
  'manual',
  /** A reply asked not to be emailed again. */
  'opt_out_reply',
  /** The unsubscribe link or header was used. */
  'unsubscribe',
  /** Mail to it bounced for good. */
  'hard_bounce',
  /**
   * The recipient organization's mail gateway refused the sender outright
   * (AGL-3244) — a Barracuda, Proofpoint or Mimecast policy block — which is
   * a verdict on the whole domain, and is filed against it.
   */
  'gateway_block',
] as const
export type OutreachDoNotContactReason =
  (typeof OUTREACH_DO_NOT_CONTACT_REASONS)[number]

/** What put an address on the list: a member, or the sending runtime. */
export const OUTREACH_DO_NOT_CONTACT_SOURCES = ['member', 'runtime'] as const
export type OutreachDoNotContactSource =
  (typeof OUTREACH_DO_NOT_CONTACT_SOURCES)[number]

/** One address on the list (`orgs/{orgId}/outreachDoNotContact/{key}`). */
export interface OutreachDoNotContactEntry {
  /** `outreachDoNotContactKey` of the address, which is also the document id. */
  key: string
  reason: OutreachDoNotContactReason
  source: OutreachDoNotContactSource
  /** The member who added it; `null` when the runtime did. */
  addedByUid: string | null
  addedAtMs: number
  /** The enrollment that led here, when one did. */
  enrollmentId: string | null
  /** That enrollment's sequence. */
  sequenceId: string | null
  /** Plain-language detail: why the member added it, the bounce's diagnostic. */
  detail: string | null
}

/**
 * One domain on the list (`orgs/{orgId}/outreachDoNotContactDomains/{domain}`)
 * (AGL-3244): no address at it is emailed, whoever enrolls them.
 *
 * Unlike an address entry it CARRIES THE DOMAIN, in clear, because the
 * Compliance page lists it and a member takes it off by name; a domain is a
 * company's, not a person's, and a person erasure leaves it alone. A member
 * adds one by hand; the sending runtime adds one when a hard bounce reads
 * as the domain's mail gateway refusing the sender rather than one address
 * being unknown.
 */
export interface OutreachDoNotContactDomainEntry {
  /** The domain, lower-cased, which is also the document id. */
  domain: string
  reason: OutreachDoNotContactReason
  source: OutreachDoNotContactSource
  /** The member who added it; `null` when the runtime did. */
  addedByUid: string | null
  addedAtMs: number
  /** The enrollment whose bounce led here, when one did. */
  enrollmentId: string | null
  /** That enrollment's sequence. */
  sequenceId: string | null
  /** Plain-language detail: the member's note, or the bounce's diagnostic. */
  detail: string | null
}
