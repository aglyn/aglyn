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
import type { ContactsConsoleSectionId } from '../components/contacts-console-sections'

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
  const section = (id: ContactsConsoleSectionId) => `${basePath}/${id}`
  return {
    section,
    contact: (id: string) => `${section('people')}/${encodeURIComponent(id)}`,
    company: (id: string) => `${section('companies')}/${encodeURIComponent(id)}`,
    deal: (id: string) => `${section('deals')}/${encodeURIComponent(id)}`,
  }
}

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
