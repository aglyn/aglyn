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
 * The contract of `crm/contact-remove` (AGL-3338), client-safe: what the
 * record page's Delete and the contacts bar's Remove send, and what each
 * contact is answered with.
 */

/** The most contacts one request may name — the bar sends a selection in pieces this size. */
export const CRM_CONTACT_REMOVE_MAX = 200

export interface ContactRemoveRequest {
  /** The mounted site; at the organization level the record's own site, or nothing. */
  hostId?: string | null
  /** The organization, which makes the call the route's organization variant. */
  orgId?: string
  contactIds: string[]
}

/**
 * One contact's answer: `detached` when other sites still hold the person
 * and only this holder's half went, `deleted` when nobody else did and the
 * document went with it — or refused, with a sentence written for the reader.
 */
export type ContactRemoveOutcome =
  | { contactId: string; ok: true; removed: 'detached' | 'deleted' }
  | { contactId: string; ok: false; error: string }

export interface ContactRemoveResponse {
  ok: true
  results: ContactRemoveOutcome[]
}
