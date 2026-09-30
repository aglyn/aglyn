/**
 * @license
 * Copyright 2026 Aglyn LLC
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *   http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ConsoleSearchSource } from '@aglyn/aglyn'
import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import type { PluginRecordRouteContext } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { crmHubRoutes } from './crm-record-routes'

/**
 * What the console's search finds in the CRM (AGL-3080): people, leads,
 * companies, deals, and the team's tasks and activities, each opening on its
 * record in the hub at the scope the reader stands at.
 *
 * Every group is the organization's shared data, read through the reader's
 * `visibleTo` tokens under a site and unfiltered at the organization level,
 * where only an org-wide member is offered it — the same reading the hub's
 * own lists make. The extension's `crm` plan flag and `data.manage`
 * permission gate all six, as they gate the hub the rows open in.
 *
 * Listed after the site's own pages and emails (30) and before its building
 * blocks (100): a person is the thing most often looked up after a page.
 */

/** A row's field as the plain string an address is built from. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One record's page, or `null` for a row without an id. */
function recordHref(
  row: Readonly<Record<string, unknown>>,
  open: (id: string) => string,
): string | null {
  const id = text(row['$id'])
  return id ? open(id) : null
}

/**
 * Where a task or an activity opens: the record it was filed under.
 *
 * Neither has a page of its own — a task is a row in a record's Tasks card
 * and in the Tasks list, an activity a line on a timeline — so the useful
 * destination is the deal, company, person or lead it belongs to, in that
 * order: a task filed on a deal is about that deal, and landing on the
 * contact would make the reader find it again. A lead addresses by its id
 * alone at both levels (AGL-3275), so one filed on a lead opens the lead.
 *
 * A task that names no record — a standing task somebody typed into the list
 * — lands on the Tasks section, which is where it is. An activity that names
 * none has nowhere to go and answers `null`, which drops the row.
 */
function workHref(
  kind: 'task' | 'activity',
  row: Readonly<Record<string, unknown>>,
  context: PluginRecordRouteContext,
): string | null {
  const routes = crmHubRoutes(context)
  const dealId = text(row['dealId'])
  if (dealId) return routes.deal(dealId)
  const companyId = text(row['companyId'])
  if (companyId) return routes.company(companyId)
  const contactId = text(row['contactId'])
  if (contactId) return routes.contact(contactId)
  const leadId = text(row['leadId'])
  if (leadId) return routes.lead(leadId)
  return kind === 'task' ? routes.section('tasks') : null
}

export const CRM_SEARCH_SOURCES: readonly ConsoleSearchSource[] = [
  {
    /*
     * People, by name, email, phone number or company (AGL-2596). The phone
     * and the company name are top-level echoes of the viewing holder's
     * facet, written by every path that sets them, precisely so a read that
     * never resolves a facet can hit them. A person a checkout captured with
     * no name is labeled by the address, as the Contacts list labels them.
     */
    id: 'contacts',
    group: 'Contacts',
    noun: 'contacts',
    scope: 'orgData',
    collection: 'contacts',
    nameField: 'name',
    fallbackNameField: 'email',
    extraFields: ['email', 'phone', 'companyName'],
    order: 40,
    href: (row, context) =>
      recordHref(row, (id) => crmHubRoutes(context).contact(id)),
  },
  {
    /*
     * People captured and not yet qualified, by name or address. One org
     * document per person, scoped by `visibleTo` like a contact (AGL-3275),
     * so the group reads and gates exactly as contacts do.
     */
    id: 'leads',
    group: 'Leads',
    noun: 'leads',
    scope: 'orgData',
    collection: 'leads',
    nameField: 'name',
    fallbackNameField: 'email',
    extraFields: ['email'],
    order: 41,
    href: (row, context) =>
      recordHref(row, (id) => crmHubRoutes(context).lead(id)),
  },
  {
    // A company by its name or its domain (AGL-2622).
    id: 'companies',
    group: 'Companies',
    noun: 'companies',
    scope: 'orgData',
    collection: CRM_COLLECTIONS.companies,
    nameField: 'name',
    extraFields: ['domain'],
    order: 42,
    href: (row, context) =>
      recordHref(row, (id) => crmHubRoutes(context).company(id)),
  },
  {
    id: 'deals',
    group: 'Deals',
    noun: 'deals',
    scope: 'orgData',
    collection: CRM_COLLECTIONS.deals,
    nameField: 'title',
    order: 43,
    href: (row, context) =>
      recordHref(row, (id) => crmHubRoutes(context).deal(id)),
  },
  {
    /*
     * The team's own work (AGL-2662): a task by its title or notes. The
     * collection is the PREFIXED name — `crmTasks` — because `tasks` is a
     * word the org document wants for other things.
     */
    id: 'tasks',
    group: 'Tasks',
    noun: 'tasks',
    scope: 'orgData',
    collection: CRM_COLLECTIONS.tasks,
    nameField: 'title',
    extraFields: ['notes'],
    order: 44,
    href: (row, context) => workHref('task', row, context),
  },
  {
    // A sent email carries a subject; everything a person logs by hand
    // carries only the body it was written into, and a row labeled by its
    // document id is a row nobody recognizes.
    id: 'activities',
    group: 'Activities',
    noun: 'activities',
    scope: 'orgData',
    collection: CRM_COLLECTIONS.activities,
    nameField: 'subject',
    fallbackNameField: 'body',
    extraFields: ['body', 'outcome'],
    order: 45,
    href: (row, context) => workHref('activity', row, context),
  },
]
