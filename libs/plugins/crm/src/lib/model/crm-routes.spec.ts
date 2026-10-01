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

import { crmRoutes } from './crm-routes'

/**
 * Every address inside the CRM's hub (AGL-2622, AGL-2662): the sections and
 * the record pages, under a site's hub and the organization's. Other
 * surfaces reach the same addresses through the record routes the CRM
 * publishes (`crm-record-routes.ts`), which build them with this table.
 */
describe('crmRoutes under a site’s hub', () => {
  const routes = crmRoutes('/acme/hosts/shop/crm')

  it('names the sections', () => {
    expect(routes.section('leads')).toBe('/acme/hosts/shop/crm/leads')
    expect(routes.section('contacts')).toBe('/acme/hosts/shop/crm/contacts')
  })

  it('names each record’s page under its own section, encoding the id', () => {
    expect(routes.contact('c 1')).toBe('/acme/hosts/shop/crm/contacts/c%201')
    expect(routes.lead('l/1')).toBe('/acme/hosts/shop/crm/leads/l%2F1')
    expect(routes.company('co1')).toBe('/acme/hosts/shop/crm/companies/co1')
    expect(routes.deal('d1')).toBe('/acme/hosts/shop/crm/deals/d1')
  })

  it('asks the Contacts list to open one address by its email key', () => {
    expect(routes.contactByEmail('ada@example.test')).toBe(
      '/acme/hosts/shop/crm/contacts?email=ada%40example.test',
    )
  })
})

describe('crmRoutes under the organization’s hub', () => {
  const orgRoutes = crmRoutes('/acme/crm')

  it('names the sections', () => {
    expect(orgRoutes.section('tasks')).toBe('/acme/crm/tasks')
    expect(orgRoutes.section('deals')).toBe('/acme/crm/deals')
  })

  it('names each record’s page, encoding the id', () => {
    expect(orgRoutes.contact('c 1')).toBe('/acme/crm/contacts/c%201')
    expect(orgRoutes.company('co1')).toBe('/acme/crm/companies/co1')
    expect(orgRoutes.deal('d/1')).toBe('/acme/crm/deals/d%2F1')
  })

  it('names a lead by its id alone, like every other record (AGL-3275)', () => {
    // One org collection makes the person key unambiguous, so a lead
    // addresses the way a contact or a deal does.
    expect(orgRoutes.lead('l/1')).toBe('/acme/crm/leads/l%2F1')
  })
})
