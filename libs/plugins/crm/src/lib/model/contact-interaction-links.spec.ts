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

/**
 * Where a contact's captured history points back at (AGL-2622): the record
 * each capture door left. The submission, the order and the booking are other
 * plugins' records, so this stands in the addresses the inbox, commerce and
 * bookings plugins publish — what each publishes is held in its own spec.
 */

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { standInSiteRecordRoutes } from '../testing/stand-in-site-record-routes'
import { contactInteractionHref, INTERACTION_LINK_LABELS } from './contact-interaction-links'

const context = { orgSlug: 'acme', host: 'shop' }

beforeEach(() => {
  resetPluginServicesForTests()
  standInSiteRecordRoutes()
})

describe('the record a captured interaction points back at', () => {
  /**
   * A door that left nothing to open carries no link: a list that could not
   * show the row would read as the record having been deleted.
   */
  it('links a captured interaction by its door, or not at all', () => {
    expect(contactInteractionHref({ type: 'form', refId: 'sub-1' }, context)).toBe(
      '/acme/hosts/shop/inbox/submissions?submission=sub-1',
    )
    expect(contactInteractionHref({ type: 'order', refId: 'ord-1' }, context)).toBe(
      '/acme/hosts/shop/products/orders?order=ord-1',
    )
    expect(contactInteractionHref({ type: 'booking', refId: 'b-1' }, context)).toBe(
      '/acme/hosts/shop/bookings',
    )
    expect(contactInteractionHref({ type: 'member' }, context)).toBe('/acme/hosts/shop/users')
    expect(contactInteractionHref({ type: 'form' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'order' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'newsletter', refId: 'x' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'manual' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'import' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'api' }, context)).toBeNull()
  })

  it('links nothing where the plugin that keeps the record is not loaded', () => {
    resetPluginServicesForTests()
    expect(contactInteractionHref({ type: 'form', refId: 'sub-1' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'order', refId: 'ord-1' }, context)).toBeNull()
    expect(contactInteractionHref({ type: 'booking' }, context)).toBeNull()
    // The Users page is the platform's own, and needs no plugin.
    expect(contactInteractionHref({ type: 'member' }, context)).toBe('/acme/hosts/shop/users')
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
