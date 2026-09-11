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
  | 'settings'

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
 * `release_crm` gate — no `navTabId` on any of them. A section that
 * later needs its own schedule declares one, which can only narrow.
 *
 * The PLAN is the other axis (AGL-2611, AGL-2790), and it splits the rail in
 * two. Leads declares no flag: the people a site's forms, sign-ups and
 * bookings captured are readable on every plan, and on a plan without the
 * CRM suite the section and a lead's page draw them read-only, asking the
 * plan themselves for every act. Every other section is the CRM SUITE —
 * `features.crm`, included from Starter — Contacts among them, so each names
 * the flag, the shell draws it locked on a plan without it and refuses its
 * body (and every record beneath it) with the upgrade notice, and a bare
 * `/crm` on such a plan lands on Leads, the one section it has. Declared per
 * section rather than on the extension because the extension's flag would
 * take Leads with it.
 *
 * Rail ORDER decides where a bare `/crm` lands: the shell redirects it to
 * the first section this reader may open — Contacts on a plan with the
 * suite, Leads on one without. There is deliberately no separate default
 * constant. Settings is LAST (AGL-2613): it is the section a reader visits
 * once and the records are what the rail is for, so it sits where a
 * settings entry sits in every hub — after the work, before nothing.
 */
export const CRM_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'contacts', label: 'Contacts', featureFlag: 'crm' },
  { id: 'leads', label: 'Leads' },
  { id: 'companies', label: 'Companies', featureFlag: 'crm' },
  { id: 'deals', label: 'Deals', featureFlag: 'crm' },
  { id: 'tasks', label: 'Tasks', featureFlag: 'crm' },
  { id: 'reports', label: 'Reports', featureFlag: 'crm' },
  { id: 'fields', label: 'Fields', featureFlag: 'crm' },
  { id: 'settings', label: 'Settings', featureFlag: 'crm' },
]
