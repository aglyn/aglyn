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
 * The two builders and the parser are one address (AGL-2612): what a form's
 * page or an Inbox row writes into the query string is what the Contacts
 * list reads back, as the filter the list already speaks.
 */

import { contactsListSeed } from './contacts-list-seed'
import { crmRoutes } from './crm-routes'

const paramsOf = (href: string) => new URL(href, 'https://x.test').searchParams

describe('contactsListSeed', () => {
  const routes = crmRoutes('/o/hosts/s/crm')

  it('reads the form link back as the formIds filter and the form source', () => {
    const href = routes.contactsByForm('Fx9_Q-mixedCase')
    expect(href).toBe('/o/hosts/s/crm/contacts?source=form&formId=Fx9_Q-mixedCase')
    expect(contactsListSeed(paramsOf(href))).toEqual({
      filter: { field: 'formIds', op: 'contains', value: 'Fx9_Q-mixedCase' },
      source: 'form',
      formId: 'Fx9_Q-mixedCase',
      openEmail: null,
    })
  })

  it('reads the email link back as an equals filter on the normalized address', () => {
    const href = routes.contactByEmail('Ada@Example.com')
    expect(href).toBe('/o/hosts/s/crm/contacts?email=Ada%40Example.com')
    expect(contactsListSeed(paramsOf(href))).toEqual({
      filter: { field: 'email', op: 'equals', value: 'ada@example.com' },
      source: '',
      formId: null,
      openEmail: 'ada@example.com',
    })
  })

  it('seeds nothing for a bad link rather than a filter that matches nothing', () => {
    expect(contactsListSeed(paramsOf('/x?source=vip&email=not-an-address'))).toEqual({
      filter: null,
      source: '',
      formId: null,
      openEmail: null,
    })
    expect(contactsListSeed(null).filter).toBeNull()
    expect(contactsListSeed(paramsOf('/x?formId=%20%20')).filter).toBeNull()
  })
})
