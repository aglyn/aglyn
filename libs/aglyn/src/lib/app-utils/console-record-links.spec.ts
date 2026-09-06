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
  contactInteractionHref,
  crmContactByEmailHref,
  crmHubHref,
  crmRecordHref,
  crmSectionHref,
  INTERACTION_LINK_LABELS,
  siteRecordLinks,
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

  it('asks the Contacts list to open one address', () => {
    expect(crmContactByEmailHref(context, 'ada@example.test')).toBe(
      '/acme/hosts/shop/crm/contacts?email=ada%40example.test',
    )
  })
})

describe('the site records a timeline points back at', () => {
  const links = siteRecordLinks(context)

  it('opens a submission in the Inbox reader and an order in its dialog', () => {
    expect(links.submission('sub-1')).toBe(
      '/acme/hosts/shop/inbox/submissions?submission=sub-1',
    )
    expect(links.order('ord-1')).toBe('/acme/hosts/shop/products/orders?order=ord-1')
  })

  it('narrows the orders list to one buyer', () => {
    expect(links.ordersByCustomer('ada@example.test')).toBe(
      '/acme/hosts/shop/products/orders?email=ada%40example.test',
    )
  })

  it('lands bookings and members on their pages', () => {
    expect(links.bookings()).toBe('/acme/hosts/shop/bookings')
    expect(links.members()).toBe('/acme/hosts/shop/users')
  })

  /**
   * A door that left nothing to open carries no link: a list that could not
   * show the row would read as the record having been deleted.
   */
  it('links a captured interaction by its door, or not at all', () => {
    expect(contactInteractionHref({ type: 'form', refId: 'sub-1' }, context)).toBe(
      links.submission('sub-1'),
    )
    expect(contactInteractionHref({ type: 'order', refId: 'ord-1' }, context)).toBe(
      links.order('ord-1'),
    )
    expect(contactInteractionHref({ type: 'booking', refId: 'b-1' }, context)).toBe(
      links.bookings(),
    )
    expect(contactInteractionHref({ type: 'member' }, context)).toBe(links.members())
    expect(contactInteractionHref({ type: 'form' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'order' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'newsletter', refId: 'x' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'manual' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'import' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'api' }, context)).toBeNull()
  })

  it('labels exactly the doors that link', () => {
    for (const type of ['form', 'order', 'booking', 'member'] as const) {
      expect(INTERACTION_LINK_LABELS[type]).toBeTruthy()
      expect(contactInteractionHref({ type, refId: 'r' }, context)).not.toBeNull()
    }
    for (const type of ['newsletter', 'api', 'manual', 'import'] as const) {
      expect(INTERACTION_LINK_LABELS[type]).toBeUndefined()
    }
  })
})
