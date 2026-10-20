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
 * The app bar's site switcher leads with the sites the reader pinned in
 * this workspace, in the order they were pinned, as the Sites list does. A
 * pinned site outside the recent-first window is read on its own and still
 * leads; under a search the pins lead only the matches; and nothing about
 * the pins is read until the menu opens.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'

const mockPinnedReads = jest.fn()
const mockPinnedRowReads = jest.fn()
let mockPinned: string[] = []
let mockHits: Array<Record<string, unknown>> = []
let mockHasQuery = false
const mockSite = (id: string, name: string, orgId = 'org-1') => ({
  $id: id,
  displayName: name,
  subdomain: id,
  orgId,
})
const mockWindow = [mockSite('h1', 'Alpha'), mockSite('h2', 'Bravo'), mockSite('h3', 'Charlie')]
const mockOutside = mockSite('h9', 'Zulu Dental')

jest.mock('next/navigation', () => ({
  usePathname: () => '/acme/hosts',
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
  useSwitcherCollection: () => ({
    items: mockHits,
    loading: false,
    hasQuery: mockHasQuery,
    error: undefined,
  }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  documentId: () => '__name__',
  query: (ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }),
  where: (field: unknown, op: unknown, value: unknown) => ({ field, op, value }),
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => null,
  useHostSubdomain: () => null,
}))
jest.mock('../hooks/use-org-reach', () => ({
  useOrgReach: () => ({ orgWide: true, ready: true }),
  useReachableSites: () => ({ sites: [], ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: { $id: 'org-1', slug: 'acme' } }),
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: undefined, status: 'success' }),
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: (build: () => unknown) => {
    const query = build()
    mockPinnedRowReads(query)
    // The pinned rows the window does not hold, as the server answers them.
    return { data: query ? [mockOutside] : [], status: 'success' }
  },
}))
jest.mock('../hooks/use-pinned-hosts', () => ({
  usePinnedHosts: (orgId: unknown, enabled: boolean) => {
    mockPinnedReads(orgId, enabled)
    return {
      pinned: enabled ? mockPinned : [],
      full: false,
      ready: true,
      toggle: jest.fn(),
      replace: jest.fn(),
    }
  },
}))
jest.mock('../components/create-host-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/host-icon.component', () => ({
  __esModule: true,
  default: () => null,
}))

import HostSwitcherNavComponent from '../components/host-switcher-nav.component'

function openMenu() {
  render(<HostSwitcherNavComponent />)
  fireEvent.click(screen.getByLabelText('Site: All sites'))
  return screen.getByRole('menu')
}

const rowNames = (menu: HTMLElement) =>
  within(menu)
    .queryAllByRole('menuitem')
    .map((row) => row.textContent ?? '')
    .filter((text) => !/Create site|View all sites/.test(text))
    .map((text) => text.replace(/acme.*$|h\d.*$/, ''))

beforeEach(() => {
  jest.clearAllMocks()
  mockPinned = []
  mockHits = mockWindow
  mockHasQuery = false
})

describe('AGL-4005 · the site switcher leads with pinned sites', () => {
  it('lists the window as it comes when nothing is pinned', () => {
    const menu = openMenu()
    expect(rowNames(menu)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(within(menu).queryAllByLabelText('Pinned')).toHaveLength(0)
  })

  it('puts the pinned sites first, in pin order, reading one the window lacks', () => {
    mockPinned = ['h9', 'h3']
    const menu = openMenu()
    expect(rowNames(menu)).toEqual(['Zulu Dental', 'Charlie', 'Alpha', 'Bravo'])
    expect(within(menu).getAllByLabelText('Pinned')).toHaveLength(2)
    expect(mockPinnedRowReads).toHaveBeenLastCalledWith({
      ref: { path: 'users/u1/hostMemberships' },
      constraints: [{ field: '__name__', op: 'in', value: ['h9', 'h3'] }],
    })
  })

  it('leads only the matches under a search', () => {
    mockPinned = ['h9', 'h2']
    mockHasQuery = true
    mockHits = [mockSite('h1', 'Alpha'), mockSite('h2', 'Bravo')]
    const menu = openMenu()
    expect(rowNames(menu)).toEqual(['Bravo', 'Alpha'])
  })

  it('reads the pins only once the menu opens', () => {
    render(<HostSwitcherNavComponent />)
    expect(mockPinnedReads.mock.calls.every(([, enabled]) => enabled === false)).toBe(true)
    expect(mockPinnedRowReads.mock.calls.every(([query]) => query === null)).toBe(true)
    fireEvent.click(screen.getByLabelText('Site: All sites'))
    expect(mockPinnedReads).toHaveBeenLastCalledWith('org-1', true)
  })
})
