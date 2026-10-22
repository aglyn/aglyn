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
 * Every row of the workspace switcher shows its own workspace's logo, not
 * only the workspace the reader is in. The logo comes from the same org-doc
 * read that gives the row its plan badge, so it costs no read of its own.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'

const mockRowReads = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => '/elevated-concepts/hosts',
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    orgs: [
      { $id: 'org_aglyn', slug: 'aglyn-org', orgName: 'Aglyn LLC' },
      { $id: 'org_edr', slug: 'edr-construction', orgName: 'EDR Construction' },
      { $id: 'org_ec', slug: 'elevated-concepts', orgName: 'Elevated Concepts' },
    ],
    currentOrg: {
      $id: 'org_ec',
      slug: 'elevated-concepts',
      orgName: 'Elevated Concepts',
    },
    orgSlug: null,
    hostOrgSlug: null,
    hasMoreOrgs: false,
    loadMoreOrgs: jest.fn(),
  }),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/console/use-pinned-orgs', () => ({
  __esModule: true,
  usePinnedOrgs: () => ({ pinned: [], ready: true, toggle: jest.fn() }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    org: { plan: 'starter', logoUrl: 'https://cdn.example/ec.png' },
    ready: true,
  }),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-org-plans', () => ({
  useOrgPlans: () => ({}),
  useOrgRows: (ids: string[], enabled: boolean) => {
    mockRowReads(ids, enabled)
    return enabled
      ? {
          org_aglyn: {
            plan: 'enterprise',
            logoUrl: 'https://cdn.example/aglyn.png',
            logoDarkUrl: 'https://cdn.example/aglyn-dark.png',
          },
          org_edr: { plan: 'starter' },
        }
      : {}
  },
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
  fireEvent.click(screen.getByLabelText('Workspace: Elevated Concepts'))
  return screen.getByRole('menu')
}

const rowFor = (menu: HTMLElement, name: string) =>
  within(menu)
    .getAllByRole('menuitem')
    .find((row) => row.textContent?.startsWith(name)) as HTMLElement

const imageSources = (row: HTMLElement) =>
  Array.from(row.querySelectorAll('img')).map((img) => img.getAttribute('src'))

beforeEach(() => {
  jest.clearAllMocks()
})

describe('the workspace switcher · logos', () => {
  it("shows another workspace's logo, light and dark, while the reader is elsewhere", async () => {
    const menu = await openMenu()
    expect(imageSources(rowFor(menu, 'Aglyn LLC'))).toEqual([
      'https://cdn.example/aglyn.png',
      'https://cdn.example/aglyn-dark.png',
    ])
  })

  it('still shows the current workspace its own logo', async () => {
    const menu = await openMenu()
    expect(imageSources(rowFor(menu, 'Elevated Concepts'))).toEqual([
      'https://cdn.example/ec.png',
    ])
  })

  it('keeps the workspace glyph for a workspace with no logo', async () => {
    const menu = await openMenu()
    expect(imageSources(rowFor(menu, 'EDR Construction'))).toEqual([])
  })

  it('reads the rows only once the menu opens', async () => {
    const { OrgSwitcherNav } = await import(
      '../components/org-switcher-nav.component'
    )
    render(<OrgSwitcherNav />)
    expect(mockRowReads.mock.calls.every(([, enabled]) => enabled === false)).toBe(
      true,
    )
    fireEvent.click(screen.getByLabelText('Workspace: Elevated Concepts'))
    expect(mockRowReads).toHaveBeenLastCalledWith(
      expect.arrayContaining(['org_aglyn', 'org_edr', 'org_ec']),
      true,
    )
  })
})
