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

import {
  CONTACT_SOURCE_LABELS,
  type ContactSource,
  normalizeContactEmail,
} from '@aglyn/aglyn'
import type { ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  CONTACTS_LIST_EMAIL_PARAM,
  CONTACTS_LIST_FORM_PARAM,
  CONTACTS_LIST_SOURCE_PARAM,
} from './crm-routes'

/** What the Contacts list opens ON, read off its own address. */
export interface ContactsListSeed {
  /** The grid filter to start with — the query's predicate — or none. */
  filter: ListFilterRequest | null
  /** The source select's starting value. */
  source: ContactSource | ''
  /** The form the list was opened for, when it was. */
  formId: string | null
  /**
   * The address the list was asked to OPEN, normalized, when it was — the
   * list moves on to the record itself once exactly one row matches.
   */
  openEmail: string | null
}

const NO_SEED: ContactsListSeed = {
  filter: null,
  source: '',
  formId: null,
  openEmail: null,
}

/**
 * The Contacts list's starting state, from the query string another surface
 * sent it with (AGL-2612).
 *
 * Two surfaces address the list rather than a record: a form's own page,
 * asking for the people that form captured, and an Inbox submission row,
 * asking for the person with this address. Each is a filter the list
 * already speaks — `formIds contains` and `email equals` — so the seed is
 * the SAME `ListFilterRequest` the grid's own panel would produce, and the
 * query built from it is the query a typed filter builds. Nothing here is a
 * second predicate.
 *
 * Pure, and strict about what it accepts: an unknown source or an address
 * that is not one seeds nothing rather than a filter that matches nothing,
 * because an empty list under a bad link reads as "no such people".
 */
export function contactsListSeed(
  params: { get(name: string): string | null } | null | undefined,
): ContactsListSeed {
  if (!params) return NO_SEED
  const rawSource = params.get(CONTACTS_LIST_SOURCE_PARAM) ?? ''
  const source =
    rawSource in CONTACT_SOURCE_LABELS ? (rawSource as ContactSource) : ''
  const formId = (params.get(CONTACTS_LIST_FORM_PARAM) ?? '').trim() || null
  const openEmail = normalizeContactEmail(
    params.get(CONTACTS_LIST_EMAIL_PARAM),
  )
  const filter: ListFilterRequest | null = formId
    ? { field: 'formIds', op: 'contains', value: formId }
    : openEmail
      ? { field: 'email', op: 'equals', value: openEmail }
      : null
  return { filter, source, formId, openEmail }
}
