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
 * THE CONTRACT OF OUTREACH'S SETTINGS, SEQUENCE AND ENROLLMENT ROUTES
 * (AGL-2980): what the console sends, what the routes answer, and every
 * reason one refuses. Client-safe — types and the batch limit only.
 *
 * Every request names its organization (`orgId`, in the query of a `GET`
 * and the JSON body of a `POST`): the routes serve an organization-level
 * surface that names no site.
 */

import type { OutreachComposeError } from '../engine/compose'
import type { OutreachComplianceIssue } from './compliance-settings'
import type {
  OutreachAttestationKind,
  OutreachComplianceSettingsDocument,
  OutreachDoNotContactDomainEntry,
  OutreachEnrollment,
  OutreachSequence,
} from './outreach.types'
import type { OutreachSequenceDraft, OutreachSequenceIssue } from './sequence-draft'

/** Every reason these routes refuse with, for a caller to branch on. */
export type OutreachRouteRefusalReason =
  | 'unauthenticated'
  | 'email-unverified'
  | 'org-required'
  | 'not-a-member'
  | 'not-org-wide'
  | 'permission'
  | 'entitlement'
  | 'method-not-allowed'
  | 'invalid-request'
  | 'invalid-domain'
  | 'invalid-settings'
  | 'invalid-sequence'
  | 'sequence-not-found'
  | 'sequence-archived'
  | 'sequence-not-active'
  | 'activation-refused'
  | 'delete-refused'
  | 'mailbox-unavailable'
  | 'enrollment-not-found'
  | 'transition-refused'
  | 'view-not-found'
  | 'view-unsupported'
  | 'contact-not-found'
  | 'link-domain-refused'

/** A refusal, in the one shape every route answers with. */
export interface OutreachRouteRefusal {
  /** A sentence written for the person reading it. */
  error: string
  reason: OutreachRouteRefusalReason
  /** The field-level reasons behind an `invalid-*` or `activation-refused` refusal. */
  issues?: ReadonlyArray<OutreachComplianceIssue | OutreachSequenceIssue>
}

/*==========================================
 * COMPLIANCE SETTINGS
 *==========================================*/

/** `GET outreach/settings?orgId` — and the answer to a save. */
export interface OutreachSettingsResponse {
  ok: true
  settings: OutreachComplianceSettingsDocument
}

/** `POST outreach/settings` */
export interface OutreachSettingsSaveRequest {
  orgId: string
  legalName: string
  brandName: string
  postalAddress: string
  allowedCountries: string[]
}

/** The answer to a save: the settings as stored, and whether anything changed. */
export interface OutreachSettingsSaveResponse extends OutreachSettingsResponse {
  changed: boolean
}

/*==========================================
 * SEQUENCES
 *==========================================*/

/** `POST outreach/sequences/save` — a new sequence without `sequenceId`, an edit with one. */
export interface OutreachSequenceSaveRequest {
  orgId: string
  sequenceId?: string
  sequence: OutreachSequenceDraft
}

export interface OutreachSequenceSaveResponse {
  ok: true
  sequence: OutreachSequence
  created: boolean
  /** What the save allowed but probably isn't what was meant. */
  warnings: OutreachSequenceIssue[]
}

/** What `outreach/sequences/status` does to a sequence. */
export type OutreachSequenceAction = 'activate' | 'pause' | 'archive'

/** `POST outreach/sequences/status` */
export interface OutreachSequenceStatusRequest {
  orgId: string
  sequenceId: string
  action: OutreachSequenceAction
}

export interface OutreachSequenceStatusResponse {
  ok: true
  sequence: OutreachSequence
  /** The open enrollments an archive stopped; `0` for anything else. */
  stoppedEnrollments: number
}

/** `POST outreach/sequences/delete` — a draft nobody was ever enrolled in. */
export interface OutreachSequenceDeleteRequest {
  orgId: string
  sequenceId: string
}

/*==========================================
 * ENROLLING
 *==========================================*/

/** The most people one preview or one enroll reads. */
export const OUTREACH_ENROLL_BATCH_MAX = 50

/**
 * Which CRM record a person to enroll is (AGL-3234): a contact by its
 * document id, or a lead the sequence's site holds by its person key.
 */
export type OutreachPersonRef = { kind: 'contact'; id: string } | { kind: 'lead'; id: string }

/**
 * Where the people to enroll come from: a saved Contacts or Leads view,
 * contacts picked by search, or leads picked from the sequence's site.
 */
export type OutreachEnrollSource =
  | { kind: 'view'; viewId: string }
  | { kind: 'contacts'; contactIds: string[] }
  | { kind: 'leads'; leadIds: string[] }

/** `POST outreach/enroll/preview` */
export interface OutreachEnrollPreviewRequest {
  orgId: string
  sequenceId: string
  source: OutreachEnrollSource
}

/**
 * Where one person stands:
 *
 * - `eligible` — enrolled on Confirm as they are;
 * - `needs_confirmation` — enrolled once the rep writes the personal line
 *   and ticks the attestations `requires` names;
 * - `blocked` — refused whatever the rep confirms, for the `blocks` given.
 */
export type OutreachEnrollPreviewStatus = 'eligible' | 'needs_confirmation' | 'blocked'

/** One reason a person can't be enrolled, in a sentence a rep can act on. */
export interface OutreachEnrollBlock {
  code: string
  reason: string
}

export interface OutreachEnrollPreviewPerson {
  /** The key the dialog and the confirm name this person by: the record's own id. */
  personId: string
  /** The record the person is (AGL-3234). */
  target: 'contact' | 'lead'
  /** The contact's id; `''` for a lead. */
  contactId: string
  /** The lead's person key; `null` for a contact. */
  leadId: string | null
  name: string
  /** The address the steps would go to, or `null` when the contact has none. */
  email: string | null
  /** No inbound capture behind them — the heavier rules apply. */
  cold: boolean
  /** ISO-3166-1 alpha-2, when anything names one. */
  country: string | null
  status: OutreachEnrollPreviewStatus
  /** Why a `blocked` person is refused; empty otherwise. */
  blocks: OutreachEnrollBlock[]
  /** What the rep must supply before a `needs_confirmation` person is enrolled. */
  requires: {
    personalLine: boolean
    attestations: OutreachAttestationKind[]
  }
}

export interface OutreachEnrollPreviewResponse {
  ok: true
  people: OutreachEnrollPreviewPerson[]
  /** Everyone the source named, before the batch limit. */
  total: number
  /** True when the source named more people than one enrollment reads. */
  truncated: boolean
}

/** One person to enroll, with what the rep supplied for them: a contact by id, or a lead by key. */
export interface OutreachEnrollPersonRequest {
  contactId?: string
  leadId?: string
  personalLine?: string
  attestations?: OutreachAttestationKind[]
}

/** `POST outreach/enroll` — the gates are checked again, here, before anything is written. */
export interface OutreachEnrollRequest {
  orgId: string
  sequenceId: string
  people: OutreachEnrollPersonRequest[]
}

interface OutreachEnrollOutcomePerson {
  personId: string
  target: 'contact' | 'lead'
  contactId: string
  leadId: string | null
  email: string | null
}

export type OutreachEnrollOutcome =
  | (OutreachEnrollOutcomePerson & { outcome: 'enrolled'; enrollmentId: string })
  | (OutreachEnrollOutcomePerson & { outcome: 'blocked'; blocks: OutreachEnrollBlock[] })

export interface OutreachEnrollResponse {
  ok: true
  results: OutreachEnrollOutcome[]
  enrolled: number
}

/*==========================================
 * ENROLLMENTS
 *==========================================*/

/** What a member may do to one enrollment. */
export type OutreachEnrollmentAction = 'pause' | 'resume' | 'stop' | 'do_not_contact'

/** `POST outreach/enrollments/action` */
export interface OutreachEnrollmentActionRequest {
  orgId: string
  enrollmentId: string
  action: OutreachEnrollmentAction
  /** Why, for a stop or a do-not-contact. */
  detail?: string
}

export interface OutreachEnrollmentActionResponse {
  ok: true
  /** False when the enrollment was already where the action would put it. */
  changed: boolean
  enrollment: OutreachEnrollment
  /** Other open enrollments of the same address a do-not-contact stopped. */
  stoppedOthers: number
}

/*==========================================
 * DO NOT CONTACT: DOMAINS (AGL-3244)
 *==========================================*/

/** `GET outreach/do-not-contact/domains?orgId` — and the answer to a change. */
export interface OutreachDoNotContactDomainsResponse {
  ok: true
  /** Every domain on the list, alphabetically. */
  domains: OutreachDoNotContactDomainEntry[]
}

/** `POST outreach/do-not-contact/domains` */
export interface OutreachDoNotContactDomainRequest {
  orgId: string
  action: 'add' | 'remove'
  /** The domain, or an address at it. */
  domain: string
  /** Why, for an add. */
  detail?: string
}

/** The answer to a change: the list as it stands, and whether anything changed. */
export interface OutreachDoNotContactDomainResponse extends OutreachDoNotContactDomainsResponse {
  changed: boolean
  /** The domain as the list spells it. */
  domain: string
}

/*==========================================
 * LINK DOMAINS (AGL-3306)
 *==========================================*/

/** Where a mailbox domain's click-tracking host stands. */
export type OutreachLinkDomainStatus = 'not-set-up' | 'requested' | 'records-issued' | 'verified' | 'failed'

/** One DNS record the member publishes, as the sending-domain cards print them. */
export interface OutreachLinkDomainRecord {
  type: string
  name: string
  value: string
  required: boolean
  note: string
}

/**
 * One sending domain of the organization's connected mailboxes, and its
 * `links.` host: what tracked links in mail from it read now, and what is
 * left to do for them to read `https://links.<domain>/<id>`.
 */
export interface OutreachLinkDomain {
  /** The mailboxes' sending domain. */
  domain: string
  /** `links.<domain>`. */
  host: string
  status: OutreachLinkDomainStatus
  /** The records to publish; empty until the host is set up. */
  records: OutreachLinkDomainRecord[]
  /** Why it is not verified, in a sentence; `null` when nothing is wrong. */
  detail: string | null
  /** How a tracked link in mail from this domain starts today. */
  linkPrefix: string | null
  checkedAtMs: number | null
  verifiedAtMs: number | null
}

/** `GET outreach/link-domains?orgId` */
export interface OutreachLinkDomainsResponse {
  ok: true
  domains: OutreachLinkDomain[]
  /** Whether the member may set a host up, check it, or remove it. */
  canManage: boolean
}

/** `POST outreach/link-domains` */
export interface OutreachLinkDomainRequest {
  orgId: string
  domain: string
  action: 'set-up' | 'check' | 'remove'
}

export interface OutreachLinkDomainResponse extends OutreachLinkDomainsResponse {
  /** The domain the action was for. */
  domain: string
}

/*==========================================
 * PREVIEW
 *==========================================*/

/** `POST outreach/preview` — one email of a saved sequence, as a person would get it. */
export interface OutreachPreviewRequest {
  orgId: string
  sequenceId: string
  /** The contact to write it to; a sample person when absent. */
  contactId?: string
  /** Or a lead the sequence's site holds (AGL-3234), written to as the contact it would be. */
  leadId?: string
  personalLine?: string
  /** Which step; the first email when absent. */
  stepIndex?: number
}

export interface OutreachPreviewResponse {
  ok: true
  stepIndex: number
  subject: string
  /** The plain text, footer included. */
  text: string
  unresolvedFields: string[]
  /** Why it could not be written, when it could not. */
  error: OutreachComposeError | null
}
