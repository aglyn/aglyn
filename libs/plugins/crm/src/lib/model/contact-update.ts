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

import type { AglynPostalAddress, ContactCustomValue } from '@aglyn/aglyn'

/**
 * THE CONTACT PROFILE ROUTE'S CONTRACT (AGL-2804), in one module both halves
 * import, so the field the console sends and the field the handler reads
 * cannot drift apart.
 *
 * `crm/contact-update` is the console's one writer of a contact's facets.
 * The Firestore rules cannot tell one field of a holder's facet from another
 * — the holder is a map key a rule cannot address — so a client update may
 * not change a facet at all beyond letting a holder go, and every edit the
 * console makes to one arrives here: the record page's profile, custom
 * fields, files and campaign filing, the company page's link, and the bulk
 * bar's tags, owner and company. A lifecycle stage has a route of its own,
 * `crm/contact-stage`, because moving it is an event.
 */

/**
 * The most contacts one request names — the contacts list's window, which is
 * as much as a selection reaches. A larger selection is sent in pieces.
 */
export const CRM_CONTACT_UPDATE_MAX = 200

/**
 * What one request sets, for ONE holder: the viewing site's group under a
 * site, and at the organization level each contact's own primary holder.
 *
 * A text field sent as `''` is CLEARED — removed from the facet — except
 * `notes`, which are stored as typed. A list replaces the stored list;
 * `addTag` and `removeTag` change one tag and leave the rest as the server
 * holds them.
 */
export interface ContactUpdateFields {
  /** This holder's own name for the person. The canonical name is never written. */
  name?: string
  /** As typed; stored as E.164, and refused when it cannot be read as a number. */
  phone?: string
  jobTitle?: string
  address?: AglynPostalAddress | null
  notes?: string
  tags?: string[]
  addTag?: string
  removeTag?: string
  campaignIds?: string[]
  /** A member of the organization, or `''` for nobody. */
  ownerUid?: string
  /** The company to file the person under, or `null` to unlink them. */
  companyId?: string | null
  /**
   * The company's label on the record. Left out beside `companyId`, the
   * linked company's own name is written, and an unlink clears it.
   */
  companyName?: string
  /** Only the keys that changed, each judged against its definition; `null` clears. */
  custom?: Record<string, ContactCustomValue>
  mediaIds?: string[]
}

/** Every field the route reads. A body naming any other is refused, not trimmed. */
export const CONTACT_UPDATE_FIELDS: ReadonlyArray<keyof ContactUpdateFields> = [
  'name',
  'phone',
  'jobTitle',
  'address',
  'notes',
  'tags',
  'addTag',
  'removeTag',
  'campaignIds',
  'ownerUid',
  'companyId',
  'companyName',
  'custom',
  'mediaIds',
]

export interface ContactUpdateRequest {
  /** The mounted site; at the organization level the record's own site, or nothing. */
  hostId?: string | null
  /** The organization, which makes the call the route's organization variant. */
  orgId?: string
  contactIds: string[]
  set: ContactUpdateFields
}

/** One contact's answer: saved, or refused with a sentence written for the reader. */
export type ContactUpdateOutcome =
  | { contactId: string; ok: true }
  | { contactId: string; ok: false; error: string }

export interface ContactUpdateResponse {
  ok: true
  results: ContactUpdateOutcome[]
}
