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
 * The Contacts hub routes a URL to a section, and a section to a record
 * (AGL-2595).
 *
 * Two halves, both driven through the REAL resolver rather than by handing
 * the page a `section` prop it would trust:
 *
 *  1. `/contacts/people/abc` resolves to the `people` section with `abc`
 *     beneath it, and the page renders the CONTACT record stub for that id
 *     — not the list, and not a company's page.
 *  2. `/contacts/deals` resolves to the `deals` section and the page renders
 *     the Deals section, not the people list.
 *
 * The people list is stubbed: it opens Firestore listens on mount and has
 * four specs of its own. What this file asserts is the switch.
 */

import { registerContactsConsole } from '../plugin'
import { resolveConsolePluginPage } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import ContactsConsolePage from './contacts-console-page'
import { CONTACTS_CONSOLE_SECTIONS } from './contacts-console-sections'
import { crmRoutes } from '../model/crm-routes'

jest.mock('@aglyn/shared-ui-next', () => ({
  HubSections: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('./people-section', () => ({
  __esModule: true,
  default: () => <div>{'PEOPLE LIST'}</div>,
}))

const BASE_PATH = '/acme/hosts/shop/contacts'

const shellSections = () =>
  CONTACTS_CONSOLE_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    href: `${BASE_PATH}/${section.id}`,
    visible: true,
  }))

/**
 * What the shell does with a URL: resolve it against the registry, then
 * mount the page with the section id and the segments it found.
 */
function mountAt(href: string) {
  registerContactsConsole()
  const resolved = resolveConsolePluginPage(href, ['contacts'])
  expect(resolved).toBeDefined()
  render(
    <ContactsConsolePage
      hostId="host-1"
      entitled
      basePath={BASE_PATH}
      sections={shellSections()}
      section={resolved?.section?.id}
      segments={resolved?.segments}
    />,
  )
  return resolved
}

describe('the Contacts hub routes sections and records (AGL-2595)', () => {
  it('reaches the contact record stub for /contacts/people/abc, with that id', () => {
    const resolved = mountAt('/contacts/people/abc')

    expect(resolved?.section?.id).toBe('people')
    expect(resolved?.segments).toEqual(['people', 'abc'])
    expect(screen.getByText('Contact abc')).toBeTruthy()
    expect(screen.getByText("This contact's page is not built yet.")).toBeTruthy()
    // The record, not the list — and not some other record.
    expect(screen.queryByText('PEOPLE LIST')).toBeNull()
    expect(screen.queryByText(/^Company /)).toBeNull()
    // The way back is the section, built by the one route helper.
    expect(
      screen.getByText('Back to contacts').closest('a')?.getAttribute('href'),
    ).toBe(crmRoutes(BASE_PATH).section('people'))
  })

  it('reaches the Deals section for /contacts/deals', () => {
    const resolved = mountAt('/contacts/deals')

    expect(resolved?.section?.id).toBe('deals')
    expect(resolved?.segments).toEqual(['deals'])
    expect(screen.getByText('Deals')).toBeTruthy()
    expect(screen.queryByText('PEOPLE LIST')).toBeNull()
  })

  it('renders the people list on the bare people section', () => {
    mountAt('/contacts/people')
    expect(screen.getByText('PEOPLE LIST')).toBeTruthy()
  })

  it('renders nothing until the shell has named a section', () => {
    const { container } = render(
      <ContactsConsolePage hostId="host-1" entitled basePath={BASE_PATH} sections={shellSections()} />,
    )
    expect(container.innerHTML).toBe('')
  })
})

describe('crmRoutes', () => {
  it('builds every address under the surface, encoding the id', () => {
    const routes = crmRoutes(BASE_PATH)
    expect(routes.section('tasks')).toBe(`${BASE_PATH}/tasks`)
    expect(routes.contact('abc')).toBe(`${BASE_PATH}/people/abc`)
    expect(routes.company('co 1')).toBe(`${BASE_PATH}/companies/co%201`)
    expect(routes.deal('a/b')).toBe(`${BASE_PATH}/deals/a%2Fb`)
  })
})
