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

/**
 * AGL-3080: what the console's search finds in the CRM, declared here rather
 * than named by the console. Each group is pinned against the field its
 * writer stores and the address its record page answers on, at both levels.
 */

import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import { CRM_SEARCH_SOURCES } from './crm-search-sources'

const source = (id: string) => {
  const found = CRM_SEARCH_SOURCES.find((entry) => entry.id === id)
  if (!found) throw new Error(`no CRM search source "${id}"`)
  return found
}

const onSite = { orgSlug: 'acme', host: 'demo' }
const atOrg = { orgSlug: 'acme', host: null }

describe('the CRM search sources', () => {
  /**
   * Every group is the organization's shared data, judged by `visibleTo`,
   * so the palette reads each through the viewer's tokens — leads included,
   * one org document per person since AGL-3275.
   */
  it('reads every group from the org data root', () => {
    expect(CRM_SEARCH_SOURCES.map((entry) => [entry.id, entry.scope, entry.collection])).toEqual([
      ['contacts', 'orgData', 'contacts'],
      ['leads', 'orgData', 'leads'],
      ['companies', 'orgData', CRM_COLLECTIONS.companies],
      ['deals', 'orgData', CRM_COLLECTIONS.deals],
      ['tasks', 'orgData', 'crmTasks'],
      ['activities', 'orgData', 'crmActivities'],
    ])
  })

  /**
   * Getting `nameField` wrong renders a whole group of rows labeled with
   * their document id.
   */
  it('names each row by the field its writer stores', () => {
    // A person a checkout captured with no name is labeled by the address.
    expect(source('contacts')).toMatchObject({ nameField: 'name', fallbackNameField: 'email' })
    expect(source('contacts').extraFields).toEqual(['email', 'phone', 'companyName'])
    expect(source('leads')).toMatchObject({ nameField: 'name', fallbackNameField: 'email' })
    expect(source('companies')).toMatchObject({ nameField: 'name', extraFields: ['domain'] })
    expect(source('deals').nameField).toBe('title')
    expect(source('tasks')).toMatchObject({ nameField: 'title', extraFields: ['notes'] })
    // A sent email carries a subject; a hand-logged activity only a body.
    expect(source('activities')).toMatchObject({ nameField: 'subject', fallbackNameField: 'body' })
  })

  it('lists its groups after the pages and before the building blocks', () => {
    for (const entry of CRM_SEARCH_SOURCES) {
      expect(entry.order).toBeGreaterThan(30)
      expect(entry.order).toBeLessThan(100)
    }
  })

  it('opens each record in the hub at the scope the reader stands at', () => {
    expect(source('contacts').href({ $id: 'c 1' }, onSite)).toBe(
      '/acme/hosts/demo/crm/contacts/c%201',
    )
    expect(source('leads').href({ $id: 'l1' }, onSite)).toBe('/acme/hosts/demo/crm/leads/l1')
    expect(source('companies').href({ $id: 'co1' }, onSite)).toBe(
      '/acme/hosts/demo/crm/companies/co1',
    )
    expect(source('deals').href({ $id: 'd/1' }, onSite)).toBe('/acme/hosts/demo/crm/deals/d%2F1')
    expect(source('contacts').href({ $id: 'c 1' }, atOrg)).toBe('/acme/crm/contacts/c%201')
    // A lead addresses by its id alone at both levels (AGL-3275).
    expect(source('leads').href({ $id: 'l/1' }, atOrg)).toBe('/acme/crm/leads/l%2F1')
    expect(source('companies').href({ $id: 'co1' }, atOrg)).toBe('/acme/crm/companies/co1')
    expect(source('deals').href({ $id: 'd1' }, atOrg)).toBe('/acme/crm/deals/d1')
  })

  /**
   * A task and an activity have no page of their own, so the useful
   * destination is the record they were filed under — the deal before the
   * company, the company before the person, the person before the lead.
   */
  it('opens a task and an activity on the record they were filed under', () => {
    const task = source('tasks')
    const activity = source('activities')
    expect(task.href({ $id: 't1', dealId: 'd1', contactId: 'c1' }, onSite)).toBe(
      '/acme/hosts/demo/crm/deals/d1',
    )
    expect(task.href({ $id: 't2', companyId: 'co1', contactId: 'c1' }, onSite)).toBe(
      '/acme/hosts/demo/crm/companies/co1',
    )
    expect(task.href({ $id: 't3', contactId: 'c1', leadId: 'l1' }, onSite)).toBe(
      '/acme/hosts/demo/crm/contacts/c1',
    )
    expect(task.href({ $id: 't4', leadId: 'l1' }, atOrg)).toBe('/acme/crm/leads/l1')
    expect(activity.href({ $id: 'a1', dealId: 'd1' }, atOrg)).toBe('/acme/crm/deals/d1')
    expect(activity.href({ $id: 'a2', leadId: 'l1' }, onSite)).toBe(
      '/acme/hosts/demo/crm/leads/l1',
    )
  })

  it('lands a task that names no record on the Tasks list', () => {
    expect(source('tasks').href({ $id: 't5' }, onSite)).toBe('/acme/hosts/demo/crm/tasks')
    expect(source('tasks').href({ $id: 't5' }, atOrg)).toBe('/acme/crm/tasks')
  })

  /**
   * A row with nowhere to go is dropped by the palette rather than drawn as
   * a link to nothing: an activity that names no record, a row with no id.
   */
  it('answers null for a row it cannot address', () => {
    expect(source('activities').href({ $id: 'a3' }, onSite)).toBeNull()
    expect(source('contacts').href({}, onSite)).toBeNull()
  })
})
