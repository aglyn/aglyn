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
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * WHAT THE STAFF SITE CONTENT TABS ASK FIRESTORE (AGL-3379, AGL-3680).
 *
 * Each tab of the staff site page's Content card is a paged walk of one of
 * the site's collections (`staff-doc-table.component`), in document-id order
 * by default — the one order that drops nothing. None of them filters, so
 * every header order is served as asked; each is `alone` all the same, so a
 * tab that gains a filter cannot put an order on its query that it has no
 * composite for.
 *
 * ## Which header orders the QUERY, and why the others sort the page
 *
 *   Name     `nameLower` on layouts, components and forms — every create
 *            stamps it (`artifactCreateListKeys`, `newFormListFields`) and
 *            `backfill-artifacts-list-keys.mjs` / `backfill-form-list-fields.mjs`
 *            stamped the rest. NOT on pages and email designs: a deleted
 *            screen's name keys are CLEARED (so the email templates list
 *            drops the tombstone), and these tabs show trashed rows, which an
 *            `orderBy('nameLower')` would drop. Not on templates: a starter
 *            page's `nameLower` is its STARTER's name, not the page name the
 *            tab shows. Those sort the page.
 *   Updated  `updatedAt`, stamped by every create and edit, and by
 *            `backfill-artifacts-list-keys.mjs` where it was missing.
 *   Kind     a component's and a template's stored `kind` (the same backfill).
 *            The other tabs' Status chips are derived — the routing map, the
 *            submission count — and sort the page.
 */

/** The walk every tab keeps by default: the document id, ascending. */
const ID_ORDER: ListQuerySort = { path: LIST_QUERY_ID_PATH, direction: 'asc' }

const headerSorts = (column: string, path: string, label: string): ListQuerySort[] => [
  { path, direction: 'asc', column, label, alone: true },
  { path, direction: 'desc', column, label, alone: true },
]

const NAME = headerSorts('displayName', 'nameLower', 'Name')
const UPDATED = headerSorts('updatedAt', 'updatedAt', 'Updated')
// The Kind chips column is the shared `status` field (`chipsColumn`).
const KIND = headerSorts('status', 'kind', 'Kind')

export type StaffSiteContentTab =
  | 'screens'
  | 'emails'
  | 'layouts'
  | 'components'
  | 'templates'
  | 'forms'

export interface StaffSiteContentList {
  /** The site subcollection the tab walks. */
  collection: string
  declaration: ListQueryDeclaration
  /** The tab's scope, on every query. */
  base: readonly ListQueryFilter[]
}

const list = (
  collection: string,
  sorts: readonly ListQuerySort[],
  base: readonly ListQueryFilter[] = [],
): StaffSiteContentList => ({
  collection,
  declaration: { fields: [], sorts: [ID_ORDER, ...sorts] },
  base,
})

/** Email designs are the site's screens of kind `email`. */
export const STAFF_EMAIL_DESIGN_BASE: readonly ListQueryFilter[] = [
  { path: 'kind', op: '==', value: 'email' },
]

export const STAFF_SITE_CONTENT_LISTS: Readonly<Record<StaffSiteContentTab, StaffSiteContentList>> = {
  screens: list('screens', UPDATED),
  emails: list('screens', UPDATED, STAFF_EMAIL_DESIGN_BASE),
  layouts: list('layouts', [...NAME, ...UPDATED]),
  components: list('components', [...NAME, ...UPDATED, ...KIND]),
  templates: list('templates', [...UPDATED, ...KIND]),
  forms: list('forms', [...NAME, ...UPDATED]),
}
