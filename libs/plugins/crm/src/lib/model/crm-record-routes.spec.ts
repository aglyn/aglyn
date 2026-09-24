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
 *
 * @jest-environment node
 */

import {
  listPluginRecordRouteKinds,
  pluginRecordByEmailHref,
  pluginRecordFilteredHref,
  pluginRecordHref,
  pluginRecordListHref,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  CRM_CONTACT_FILTER_FORM,
  registerCrmRecordRoutes,
} from './crm-record-routes'
import { crmRoutes } from './crm-routes'

const site = { orgSlug: 'acme', host: 'demo' }
const org = { orgSlug: 'acme', host: null }
const siteHub = crmRoutes('/acme/hosts/demo/crm')

beforeEach(() => {
  resetPluginServicesForTests()
  registerCrmRecordRoutes()
})

describe('the addresses the CRM publishes', () => {
  it('owns the four record kinds', () => {
    expect(listPluginRecordRouteKinds()).toEqual(
      ['contact', 'lead', 'company', 'deal'].map((kind) => ({
        kind,
        pluginId: 'crm',
      })),
    )
  })

  it('answers exactly what the CRM’s own route table builds', () => {
    // The registry is a second door onto the same table, never a second
    // spelling of it: a link built elsewhere lands where the CRM's own do.
    expect(pluginRecordHref('contact', site, 'c 1')).toBe(siteHub.contact('c 1'))
    expect(pluginRecordHref('lead', site, 'l1')).toBe(siteHub.lead('l1'))
    expect(pluginRecordHref('company', site, 'co1')).toBe(siteHub.company('co1'))
    expect(pluginRecordHref('deal', site, 'd1')).toBe(siteHub.deal('d1'))
    expect(pluginRecordListHref('lead', site)).toBe(siteHub.section('leads'))
    expect(pluginRecordByEmailHref('contact', site, 'ada@example.com')).toBe(
      siteHub.contactByEmail('ada@example.com'),
    )
    expect(
      pluginRecordFilteredHref('contact', site, CRM_CONTACT_FILTER_FORM, 'f1'),
    ).toBe(siteHub.contactsByForm('f1'))
  })

  it('addresses the organization’s hub when no site is named', () => {
    expect(pluginRecordListHref('contact', org)).toBe('/acme/crm/contacts')
    expect(pluginRecordHref('deal', org, 'd1')).toBe('/acme/crm/deals/d1')
  })

  it('addresses a lead by its id alone at the organization level (AGL-3303)', () => {
    // A lead is one org row per person (AGL-3275), so the org hub's own
    // lead page takes the id with no site — the page the organization's
    // Inbox sends "Open in CRM" to.
    expect(pluginRecordHref('lead', org, 'l 1')).toBe(
      crmRoutes('/acme/crm').lead('l 1'),
    )
    expect(pluginRecordHref('lead', org, 'l1')).toBe('/acme/crm/leads/l1')
  })

  it('has no address for a filter it does not know', () => {
    expect(pluginRecordFilteredHref('contact', site, 'shoe-size', '9')).toBeNull()
  })

  it('registers again without refusing itself', () => {
    expect(() => registerCrmRecordRoutes()).not.toThrow()
    expect(listPluginRecordRouteKinds()).toHaveLength(4)
  })
})
