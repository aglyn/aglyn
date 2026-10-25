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
 * The app bar's workspace switcher lists the chooser's order: pinned first,
 * then by name (AGL-3762). Its own search box keeps working over that order,
 * and the pins are read only while the menu is open.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'

const mockPinnedReads = jest.fn()
let mockPinned: string[] = []
let mockHasMore = false
const mockLoadMore = jest.fn()

// The switcher never needs a plugin's declarations, and their lazy imports
// would otherwise resolve after the suite tears down and crash the worker.
jest.mock('../constants/plugins.declarations.generated', () => ({
  registerPluginDeclarations: () => Promise.resolve(),
}))
jest.mock('next/navigation', () => ({
  usePathname: () => '/aglyn-org/hosts',
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    orgs: [
      { $id: 'org_tst', slug: 'test-org', orgName: 'Test Org' },
      { $id: 'org_ewd', slug: 'eastwood', orgName: 'Eastwood Plumbing' },
      { $id: 'org_aglyn', slug: 'aglyn-org', orgName: 'Aglyn LLC' },
      { $id: 'org_nwc', slug: 'northwind-coffee', orgName: 'Northwind Coffee' },
    ],
    currentOrg: { $id: 'org_aglyn', slug: 'aglyn-org', orgName: 'Aglyn LLC' },
    orgSlug: null,
    hostOrgSlug: null,
    hasMoreOrgs: mockHasMore,
    loadMoreOrgs: mockLoadMore,
  }),
}))
jest.mock('../hooks/use-pinned-orgs', () => ({
  __esModule: true,
  usePinnedOrgs: (enabled: boolean) => {
    mockPinnedReads(enabled)
    return { pinned: enabled ? mockPinned : [], ready: true, toggle: jest.fn() }
  },
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'free' }, ready: true }),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-org-plans', () => ({
  useOrgPlans: () => ({}),
  useOrgRows: () => ({}),
}))
jest.mock('../components/create-org-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))

async function openMenu() {
  const { OrgSwitcherNav } = await import(
    '../components/org-switcher-nav.component'
  )
  render(<OrgSwitcherNav />)
  fireEvent.click(screen.getByLabelText('Workspace: Aglyn LLC'))
  return screen.getByRole('menu')
}

const rowNames = (menu: HTMLElement) =>
  within(menu)
    .queryAllByRole('menuitem')
    .map((row) => row.textContent ?? '')
    .filter((text) => !/create/i.test(text))
    .map((text) => text.replace(/\.aglyn\.com.*$/, ''))

beforeEach(() => {
  jest.clearAllMocks()
  mockPinned = []
  mockHasMore = false
})

describe('AGL-3762 · the workspace switcher', () => {
  it('lists the workspaces by name', async () => {
    const menu = await openMenu()
    expect(rowNames(menu)).toEqual([
      expect.stringMatching(/^Aglyn LLC/),
      expect.stringMatching(/^Eastwood Plumbing/),
      expect.stringMatching(/^Northwind Coffee/),
      expect.stringMatching(/^Test Org/),
    ])
  })

  it('puts the pinned workspaces first', async () => {
    mockPinned = ['org_tst']
    const menu = await openMenu()
    expect(rowNames(menu)[0]).toMatch(/^Test Org/)
    expect(rowNames(menu)[1]).toMatch(/^Aglyn LLC/)
    expect(within(menu).getAllByLabelText('Pinned')).toHaveLength(1)
  })

  it('reads the pins only once the menu opens', async () => {
    const { OrgSwitcherNav } = await import(
      '../components/org-switcher-nav.component'
    )
    render(<OrgSwitcherNav />)
    expect(mockPinnedReads.mock.calls.every(([enabled]) => enabled === false)).toBe(
      true,
    )
    fireEvent.click(screen.getByLabelText('Workspace: Aglyn LLC'))
    expect(mockPinnedReads).toHaveBeenLastCalledWith(true)
  })

  it('grows a truncated membership window while open, so the order is whole', async () => {
    mockHasMore = true
    await openMenu()
    expect(mockLoadMore).toHaveBeenCalled()
  })
})
