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
 * The PLAN is the other axis, and it is asked once, of the whole hub
 * (AGL-2851). The CRM is included from Starter and a Free workspace has none
 * of it, so `plugin.ts` declares `features.crm` on the extension and no
 * section declares a flag of its own. On a plan without it the shell draws
 * every section here locked and answers every address beneath the hub — a
 * bare `/crm`, a section, a record — with the upgrade notice beside the rail.
 * A section that later belongs to a narrower entitlement declares that flag,
 * which can only narrow.
 *
 * Rail ORDER decides where a bare `/crm` lands: the shell redirects it to
 * the first section this reader may open, which is Contacts on every plan
 * that opens the CRM. There is deliberately no separate default constant.
 * Settings is LAST (AGL-2613): it is the section a reader visits once and
 * the records are what the rail is for, so it sits where a settings entry
 * sits in every hub — after the work, before nothing.
 */
export const CRM_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'contacts', label: 'Contacts' },
  { id: 'leads', label: 'Leads' },
  { id: 'companies', label: 'Companies' },
  { id: 'deals', label: 'Deals' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'reports', label: 'Reports' },
  { id: 'fields', label: 'Fields' },
  { id: 'settings', label: 'Settings' },
]
