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
 * reason one refuses. Client-safe — types only, and the one refusal shape.
 *
 * Every request names its organization (`orgId`, in the query of a `GET`
 * and the JSON body of a `POST`): the routes serve an organization-level
 * surface that names no site.
 */

import type { OutreachComplianceIssue } from './compliance-settings'
import type { OutreachComplianceSettingsDocument } from './outreach.types'

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

/** A refusal, in the one shape every route answers with. */
export interface OutreachRouteRefusal {
  /** A sentence written for the person reading it. */
  error: string
  reason: OutreachRouteRefusalReason
  /** The field-level reasons behind an `invalid-settings` refusal. */
  issues?: OutreachComplianceIssue[]
}

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
