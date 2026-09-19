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

/** Where the people to enroll come from: a saved Contacts view, or contacts picked by search. */
export type OutreachEnrollSource =
  | { kind: 'view'; viewId: string }
  | { kind: 'contacts'; contactIds: string[] }

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
  contactId: string
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

/** One person to enroll, with what the rep supplied for them. */
export interface OutreachEnrollPersonRequest {
  contactId: string
  personalLine?: string
  attestations?: OutreachAttestationKind[]
}

/** `POST outreach/enroll` — the gates are checked again, here, before anything is written. */
export interface OutreachEnrollRequest {
  orgId: string
  sequenceId: string
  people: OutreachEnrollPersonRequest[]
}

export type OutreachEnrollOutcome =
  | { contactId: string; email: string | null; outcome: 'enrolled'; enrollmentId: string }
  | { contactId: string; email: string | null; outcome: 'blocked'; blocks: OutreachEnrollBlock[] }

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
 * PREVIEW
 *==========================================*/

/** `POST outreach/preview` — one email of a saved sequence, as a person would get it. */
export interface OutreachPreviewRequest {
  orgId: string
  sequenceId: string
  /** The contact to write it to; a sample person when absent. */
  contactId?: string
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
