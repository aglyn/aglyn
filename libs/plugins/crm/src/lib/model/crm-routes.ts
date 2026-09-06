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

import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import type { CrmConsoleSectionId } from '../components/crm-console-sections'
import { CRM_VIEW_PARAM } from './crm-view-param'

/**
 * Every address inside the Contacts surface, built from the one string the
 * shell hands the page (AGL-2595).
 *
 * The hub owns three kinds of deeper route — `people/{contactId}`,
 * `companies/{companyId}`, `deals/{dealId}` — and eight surfaces link into
 * them: a deal names its contact and company, a task names all three, a
 * report drills into a deal, an activity names whoever it happened with.
 * Eight surfaces each spelling `${basePath}/people/${id}` is eight places
 * for one of them to spell it `contacts/`, and a link that 404s inside the
 * hub is indistinguishable from a record that was deleted.
 *
 * The id is URL-encoded because Firestore ids are opaque: the console mints
 * them, but an import or an API caller may not, and a slash in an id would
 * otherwise read as a further segment.
 */
export function crmRoutes(basePath: string) {
  const section = (id: CrmConsoleSectionId) => `${basePath}/${id}`
  return {
    section,
    contact: (id: string) => `${section('contacts')}/${encodeURIComponent(id)}`,
    /**
     * The Contacts list narrowed to the people one form captured (AGL-2612):
     * source `form`, and the `formIds` filter on the form's id. The form's
     * own page links here; the list reads the two keys back through
     * `contactsListSeed`, which is the other half of this address.
     */
    contactsByForm: (formId: string) =>
      `${section('contacts')}?${new URLSearchParams({
        [CONTACTS_LIST_SOURCE_PARAM]: 'form',
        [CONTACTS_LIST_FORM_PARAM]: formId,
      }).toString()}`,
    /**
     * The Contacts list asked to OPEN the one person with this address
     * (AGL-2612). The list is the lookup: a contact's id is minted at
     * capture and nothing outside the CRM holds it, so a surface that has
     * only an email — an Inbox submission row — links here, the list
     * filters on the address (a whole-collection query, under the scope
     * the viewer may read) and moves straight on to the record when exactly
     * one matches. No match leaves the filtered list on screen, which is
     * the honest answer for a submission whose contact the band dropped.
     */
    contactByEmail: (email: string) =>
      `${section('contacts')}?${new URLSearchParams({
        [CONTACTS_LIST_EMAIL_PARAM]: email,
      }).toString()}`,
    lead: (id: string) => `${section('leads')}/${encodeURIComponent(id)}`,
    company: (id: string) => `${section('companies')}/${encodeURIComponent(id)}`,
    deal: (id: string) => `${section('deals')}/${encodeURIComponent(id)}`,
    /**
     * A section opened on one of its saved views (AGL-2617). The list reads
     * the key back through `crmViewIdFromParams`; the same key composes
     * with the Contacts seeds above, which is why it is a query key and not
     * a path segment.
     */
    sectionView: (id: CrmConsoleSectionId, viewId: string) =>
      `${section(id)}?${new URLSearchParams({
        [CRM_VIEW_PARAM]: viewId,
      }).toString()}`,
  }
}

/**
 * The query keys the Contacts list reads on arrival — written by the two
 * builders above and parsed by `contactsListSeed`, named once so neither
 * side can misspell the other.
 */
export const CONTACTS_LIST_SOURCE_PARAM = 'source'
export const CONTACTS_LIST_FORM_PARAM = 'formId'
export const CONTACTS_LIST_EMAIL_PARAM = 'email'

export type CrmRoutes = ReturnType<typeof crmRoutes>

/**
 * What the hub hands a record page: the shell's context, the record's id and
 * the surface's own path so the page can link back to its list.
 *
 * `basePath` is required here where the shell's prop is optional, because a
 * record page is only ever reached THROUGH the hub, which has already refused
 * to render without one.
 */
export type CrmDetailPageProps = Pick<
  ConsolePluginPageProps,
  'hostId' | 'org' | 'permissions' | 'releaseFlag' | 'hostRole'
> & {
  id: string
  basePath: string
}
