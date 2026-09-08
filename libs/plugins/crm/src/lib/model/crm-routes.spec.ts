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
  crmContactByEmailHref,
  crmHubHref,
  crmOrgHubHref,
  crmOrgLeadHref,
  crmOrgRecordHref,
  crmOrgSectionHref,
  crmRecordHref,
  crmSectionHref,
} from '@aglyn/aglyn'
import { crmRoutes } from './crm-routes'

/**
 * The plugin's own builder and the shared one the console app uses must
 * spell one address (AGL-2622). The app cannot import this plugin, so the
 * two are pinned to each other here rather than sharing code — the one
 * place a drift between them would be caught before a search result or a
 * Users-row link resolved to a page the hub does not serve.
 */
describe('crmRoutes agrees with the console-side builders', () => {
  const context = { orgSlug: 'acme', host: 'shop' }
  const routes = crmRoutes(crmHubHref(context))

  it('names the same hub and sections', () => {
    expect(routes.section('leads')).toBe(crmSectionHref(context, 'leads'))
    expect(routes.section('contacts')).toBe(crmSectionHref(context, 'contacts'))
  })

  it('names the same record pages', () => {
    expect(routes.contact('c 1')).toBe(crmRecordHref(context, 'contact', 'c 1'))
    expect(routes.lead('l/1')).toBe(crmRecordHref(context, 'lead', 'l/1'))
    expect(routes.company('co1')).toBe(crmRecordHref(context, 'company', 'co1'))
    expect(routes.deal('d1')).toBe(crmRecordHref(context, 'deal', 'd1'))
  })

  it('asks the Contacts list to open one address with the same key', () => {
    expect(routes.contactByEmail('ada@example.test')).toBe(
      crmContactByEmailHref(context, 'ada@example.test'),
    )
  })
})

/**
 * And the same pinning one level up (AGL-2662). The console's search offers
 * the CRM's records at the ORGANIZATION hub too, where a lead's address
 * carries its site — so the plugin's builder and the shared one have to
 * agree about the extra segment as well as about the sections.
 */
describe('crmRoutes agrees with the console-side builders at the org hub', () => {
  const orgRoutes = crmRoutes(crmOrgHubHref('acme'))

  it('names the same hub and sections', () => {
    expect(orgRoutes.section('tasks')).toBe(crmOrgSectionHref('acme', 'tasks'))
    expect(orgRoutes.section('deals')).toBe(crmOrgSectionHref('acme', 'deals'))
  })

  it('names the same record pages', () => {
    expect(orgRoutes.contact('c 1')).toBe(crmOrgRecordHref('acme', 'contact', 'c 1'))
    expect(orgRoutes.company('co1')).toBe(crmOrgRecordHref('acme', 'company', 'co1'))
    expect(orgRoutes.deal('d/1')).toBe(crmOrgRecordHref('acme', 'deal', 'd/1'))
  })

  it('names the site before the lead, on both sides', () => {
    expect(orgRoutes.lead('l/1', 'host-1')).toBe(
      crmOrgLeadHref('acme', 'host-1', 'l/1'),
    )
  })
})
