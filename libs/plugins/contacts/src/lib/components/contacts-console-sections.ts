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

import type { ConsoleNavSection } from '@aglyn/aglyn'

export type ContactsConsoleSectionId =
  | 'people'
  | 'companies'
  | 'deals'
  | 'tasks'
  | 'reports'
  | 'fields'

/**
 * The Contacts console's sections, in rail order (AGL-2595).
 *
 * One list, read twice and never copied: `plugin.ts` registers it on the nav
 * item so the shell can route and gate each section, and the hub page
 * switches its body on the id the shell resolves back. A second copy is how a
 * section comes to be routable under one id and drawn under another.
 *
 * Ids appear in links people keep, so they are persisted vocabulary. The
 * first is `people` rather than `contacts` because the surface is already
 * called Contacts: `/contacts/contacts` would name the same thing twice, and
 * a rail entry reading "Contacts" under a header reading "Contacts" would
 * say nothing. The LABEL still reads "Contacts", because that is what the
 * list is.
 *
 * Every section here ships with the surface and inherits the nav item's
 * `release_contacts` gate — no `navTabId` on any of them. A section that
 * later needs its own schedule declares one, which can only narrow.
 *
 * Rail ORDER decides where a bare `/contacts` lands: the shell redirects it to
 * the first section this reader may open. There is deliberately no separate
 * default constant.
 */
export const CONTACTS_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'people', label: 'Contacts' },
  { id: 'companies', label: 'Companies' },
  { id: 'deals', label: 'Deals' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'reports', label: 'Reports' },
  { id: 'fields', label: 'Fields' },
]
