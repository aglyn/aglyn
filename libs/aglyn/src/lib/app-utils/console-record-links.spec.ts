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
  crmHubHref,
  crmOrgHubHref,
  crmOrgRecordHref,
  crmOrgSectionHref,
  crmRecordHref,
  crmSectionHref,
} from './console-record-links'

const context = { orgSlug: 'acme', host: 'shop' }

describe('the CRM hub, addressed from outside the plugin (AGL-2622)', () => {
  it('names the hub by the slug the shell resolves', () => {
    expect(crmHubHref(context)).toBe('/acme/hosts/shop/crm')
    expect(crmSectionHref(context, 'leads')).toBe('/acme/hosts/shop/crm/leads')
  })

  it('addresses each record kind under its own section, encoding the id', () => {
    expect(crmRecordHref(context, 'contact', 'c1')).toBe('/acme/hosts/shop/crm/contacts/c1')
    expect(crmRecordHref(context, 'lead', 'l1')).toBe('/acme/hosts/shop/crm/leads/l1')
    expect(crmRecordHref(context, 'company', 'co 1')).toBe(
      '/acme/hosts/shop/crm/companies/co%201',
    )
    expect(crmRecordHref(context, 'deal', 'a/b')).toBe('/acme/hosts/shop/crm/deals/a%2Fb')
  })
})

describe('the same hub with no site under it (AGL-2662)', () => {
  it('names the organization hub and its sections', () => {
    expect(crmOrgHubHref('acme')).toBe('/acme/crm')
    expect(crmOrgSectionHref('acme', 'tasks')).toBe('/acme/crm/tasks')
  })

  it('addresses a record by id alone, encoding it', () => {
    expect(crmOrgRecordHref('acme', 'contact', 'c 1')).toBe('/acme/crm/contacts/c%201')
    expect(crmOrgRecordHref('acme', 'company', 'co1')).toBe('/acme/crm/companies/co1')
    expect(crmOrgRecordHref('acme', 'deal', 'a/b')).toBe('/acme/crm/deals/a%2Fb')
  })

  /**
   * A LEAD IS NO LONGER THE EXCEPTION (AGL-3275/3277).
   *
   * Its id is a person key, and while a lead lived under its site two sites
   * held two documents carrying that one id — so an org-level address had to
   * name the site to say which. One org collection makes the key unambiguous,
   * and `crmOrgLeadHref` went with the host path it existed for.
   */
  it('addresses a lead the same way, by id alone', () => {
    expect(crmOrgRecordHref('acme', 'lead', 'l/1')).toBe('/acme/crm/leads/l%2F1')
  })
})
