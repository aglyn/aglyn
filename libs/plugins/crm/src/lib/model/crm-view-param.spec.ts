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
 * A view's address composes with a section's other keys (AGL-2617): the
 * Contacts seeds survive a view being chosen, and a view survives a seed.
 */

import { contactsListSeed } from './contacts-list-seed'
import { crmRoutes } from './crm-routes'
import { crmViewHref, crmViewIdFromParams } from './crm-view-param'

const paramsOf = (href: string) => new URL(href, 'https://x.test').searchParams

describe('a view in the address', () => {
  const routes = crmRoutes('/o/hosts/s/crm')

  it('is written by the route and read back by the parser', () => {
    const href = routes.sectionView('contacts', 'view Q-1')
    expect(href).toBe('/o/hosts/s/crm/contacts?view=view+Q-1')
    expect(crmViewIdFromParams(paramsOf(href))).toBe('view Q-1')
    expect(crmViewIdFromParams(paramsOf('/x?view=%20'))).toBeNull()
    expect(crmViewIdFromParams(paramsOf('/x'))).toBeNull()
    expect(crmViewIdFromParams(null)).toBeNull()
  })

  it('composes with the Contacts seeds rather than replacing them', () => {
    const seeded = routes.contactsByForm('Fx9')
    const withView = crmViewHref('/o/hosts/s/crm/contacts', paramsOf(seeded), 'v1')
    expect(withView).toBe('/o/hosts/s/crm/contacts?source=form&formId=Fx9&view=v1')
    // Both readers still find their key.
    expect(crmViewIdFromParams(paramsOf(withView))).toBe('v1')
    expect(contactsListSeed(paramsOf(withView)).formId).toBe('Fx9')
    // Clearing the view leaves the seed alone.
    expect(crmViewHref('/o/hosts/s/crm/contacts', paramsOf(withView), null)).toBe(
      '/o/hosts/s/crm/contacts?source=form&formId=Fx9',
    )
    expect(crmViewHref('/o/hosts/s/crm/contacts', null, null)).toBe(
      '/o/hosts/s/crm/contacts',
    )
  })
})
