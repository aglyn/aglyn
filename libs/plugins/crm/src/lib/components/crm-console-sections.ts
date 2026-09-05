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

export type CrmConsoleSectionId =
  | 'contacts'
  | 'leads'
  | 'companies'
  | 'deals'
  | 'tasks'
  | 'reports'
  | 'fields'

/**
 * The CRM hub's sections, in rail order (AGL-2595).
 *
 * One list, read twice and never copied: `plugin.ts` registers it on the nav
 * item so the shell can route and gate each section, and the hub page
 * switches its body on the id the shell resolves back. A second copy is how a
 * section comes to be routable under one id and drawn under another.
 *
 * Ids appear in links people keep, so they are persisted vocabulary. The
 * surface is called CRM and its first section Contacts, the way Salesforce
 * and HubSpot lay the same objects out — Leads, Contacts, Companies, Deals —
 * so `/crm/contacts` names the list and reads as one.
 *
 * Every section here ships with the surface and inherits the nav item's
 * `release_contacts` gate — no `navTabId` on any of them. A section that
 * later needs its own schedule declares one, which can only narrow.
 *
 * The PLAN is the other axis (AGL-2611), and it splits the rail in two.
 * Contacts declares no flag: the list, its tags, notes, segments and export
 * are the capture projection every plan's email audiences read, banded by
 * `contactsPerHost` and on Free. Every other section is the CRM SUITE —
 * `features.crm`, included from Starter — so each names the flag, the shell
 * draws it locked on a plan without it and refuses its body with the
 * upgrade notice, and a bare `/crm` on Free lands on the one section Free
 * has. Declared per section rather than on the extension because the
 * extension's flag would take the contacts list with it.
 *
 * Rail ORDER decides where a bare `/crm` lands: the shell redirects it to
 * the first section this reader may open. There is deliberately no separate
 * default constant.
 */
export const CRM_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'contacts', label: 'Contacts' },
  { id: 'leads', label: 'Leads', featureFlag: 'crm' },
  { id: 'companies', label: 'Companies', featureFlag: 'crm' },
  { id: 'deals', label: 'Deals', featureFlag: 'crm' },
  { id: 'tasks', label: 'Tasks', featureFlag: 'crm' },
  { id: 'reports', label: 'Reports', featureFlag: 'crm' },
  { id: 'fields', label: 'Fields', featureFlag: 'crm' },
]
