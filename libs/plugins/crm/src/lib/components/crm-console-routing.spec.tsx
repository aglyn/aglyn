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
 *  1. `/crm/contacts/abc` resolves to the `contacts` section with `abc`
 *     beneath it, and the page renders the CONTACT record stub for that id
 *     — not the list, and not a company's page.
 *  2. `/crm/deals` resolves to the `deals` section and the page renders
 *     the Deals section, not the contacts list.
 *
 * The people list and the contact record are stubbed: both open Firestore
 * listens on mount and have specs of their own. What this file asserts is
 * the switch — which body the hub builds, and with which id.
 */

import { registerCrmConsole } from '../plugin'
import { resolveConsolePluginPage } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import CrmConsolePage from './crm-console-page'
import { CRM_CONSOLE_SECTIONS } from './crm-console-sections'
import { crmRoutes } from '../model/crm-routes'

jest.mock('@aglyn/shared-ui-next', () => ({
  HubSections: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('./contacts-section', () => ({
  __esModule: true,
  default: () => <div>{'PEOPLE LIST'}</div>,
}))
jest.mock('./contact-detail-page', () => ({
  __esModule: true,
  default: ({ id, basePath }: { id: string; basePath: string }) => (
    <div>
      {`Contact ${id}`}
      <a href={`${basePath}/contacts`}>{'Back to contacts'}</a>
    </div>
  ),
}))

const BASE_PATH = '/acme/hosts/shop/crm'

const shellSections = () =>
  CRM_CONSOLE_SECTIONS.map((section) => ({
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
  registerCrmConsole()
  const resolved = resolveConsolePluginPage(href, ['crm'])
  expect(resolved).toBeDefined()
  render(
    <CrmConsolePage
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

describe('the CRM hub routes sections and records (AGL-2595)', () => {
  it('reaches the contact record for /crm/contacts/abc, with that id', () => {
    const resolved = mountAt('/crm/contacts/abc')

    expect(resolved?.section?.id).toBe('contacts')
    expect(resolved?.segments).toEqual(['contacts', 'abc'])
    expect(screen.getByText('Contact abc')).toBeTruthy()
    // The record, not the list — and not some other record.
    expect(screen.queryByText('PEOPLE LIST')).toBeNull()
    expect(screen.queryByText(/^Company /)).toBeNull()
    // The record page is handed the hub's own base path, so its way back is
    // the section the one route helper builds.
    expect(
      screen.getByText('Back to contacts').closest('a')?.getAttribute('href'),
    ).toBe(crmRoutes(BASE_PATH).section('contacts'))
  })

  it('reaches the Deals section for /crm/deals', () => {
    const resolved = mountAt('/crm/deals')

    expect(resolved?.section?.id).toBe('deals')
    expect(resolved?.segments).toEqual(['deals'])
    expect(screen.getByText('Deals')).toBeTruthy()
    expect(screen.queryByText('PEOPLE LIST')).toBeNull()
  })

  it('answers the address the surface had before it was the CRM hub', () => {
    // A link kept from `/contacts/deals` resolves to the same page, flagged
    // so the shell can replace the address with `/crm/deals`.
    const resolved = resolveConsolePluginPage('/contacts/deals', ['crm'])
    expect(resolved?.navItem.href).toBe('/crm')
    expect(resolved?.legacy).toBe(true)
    expect(resolved?.section?.id).toBe('deals')
  })

  it('renders the contacts list on the bare contacts section', () => {
    mountAt('/crm/contacts')
    expect(screen.getByText('PEOPLE LIST')).toBeTruthy()
  })

  it('renders nothing until the shell has named a section', () => {
    const { container } = render(
      <CrmConsolePage hostId="host-1" entitled basePath={BASE_PATH} sections={shellSections()} />,
    )
    expect(container.innerHTML).toBe('')
  })
})

describe('crmRoutes', () => {
  it('builds every address under the surface, encoding the id', () => {
    const routes = crmRoutes(BASE_PATH)
    expect(routes.section('tasks')).toBe(`${BASE_PATH}/tasks`)
    expect(routes.contact('abc')).toBe(`${BASE_PATH}/contacts/abc`)
    expect(routes.lead('l1')).toBe(`${BASE_PATH}/leads/l1`)
    expect(routes.company('co 1')).toBe(`${BASE_PATH}/companies/co%201`)
    expect(routes.deal('a/b')).toBe(`${BASE_PATH}/deals/a%2Fb`)
  })
})
