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
 *
 * @jest-environment jsdom
 */

/**
 * The Marketplace hub's sections are ROUTES (AGL-693).
 *
 * Three things follow from that and none of them followed from `?tab=`:
 * a section is reachable by typing its URL, the back button walks sections
 * because each one is a navigation, and the breadcrumb can name the section
 * the reader is on because the URL says which that is.
 *
 * The fourth is the one that bites if it is got wrong. As panels, the four
 * seller sections were simply not rendered for a member without
 * `publishToMarketplace`; as routes each has a URL that can be typed, so the
 * rail no longer decides what is reachable and the refusal has to sit above
 * the pages. Payouts and Sales render the organization's revenue.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

/** The URL under the component. Reassigned to stand for a navigation. */
let mockPathname = '/acme/marketplace/browse'
/** What `useOrgPermissions` answers, and whether it has settled. */
let mockPermissions: Record<string, boolean> = { publishToMarketplace: true }
let mockPermissionsLoaded = true

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
  useParams: () => ({ orgSlug: 'acme' }),
}))

/**
 * The chrome, reduced to the two things this spec reads: the breadcrumb trail
 * and the body. Rendering the real dashboard would drag in the session, the
 * nav strip and their reads, none of which is what is under test.
 */
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({
    breadcrumbItems,
    children,
  }: {
    breadcrumbItems: Array<{ children: ReactNode }>
    children: ReactNode
  }) => (
    <div>
      <nav data-testid="breadcrumb">
        {breadcrumbItems.map((item, index) => (
          <span key={index} data-testid="crumb">
            {item.children}
          </span>
        ))}
      </nav>
      {children}
    </div>
  ),
}))

// Passes its children through: the release flag is not what this spec varies.
jest.mock('../components/feature-gate.component', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const mockOrg = { $id: 'org1', slug: 'acme' }
const mockHosts = [{ $id: 'host1', subdomain: 'shop', displayName: 'Shop' }]

jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
  useOrgScope: () => ({ currentOrg: mockOrg, loading: false }),
}))
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: mockHosts, ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({
    permissions: mockPermissions,
    loaded: mockPermissionsLoaded,
  }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
}))

import MarketplaceSectionsLayout from '../app/(app)/[orgSlug]/marketplace/(sections)/layout'

/** The rail's links, in order. */
function railHrefs(): string[] {
  return screen
    .getAllByRole('tab')
    .map((tab) => tab.getAttribute('href') ?? '')
}

/** The breadcrumb's text, in order. */
function crumbs(): string[] {
  return screen
    .getAllByTestId('crumb')
    .map((crumb) => crumb.textContent ?? '')
}

function renderAt(pathname: string) {
  mockPathname = pathname
  return render(
    <MarketplaceSectionsLayout>
      <div data-testid="section-body">{'section body'}</div>
    </MarketplaceSectionsLayout>,
  )
}

describe('Marketplace sections are routes (AGL-693)', () => {
  beforeEach(() => {
    mockPathname = '/acme/marketplace/browse'
    mockPermissions = { publishToMarketplace: true }
    mockPermissionsLoaded = true
  })

  /*
   * The CONTROL for the rail assertions below.
   *
   * Several of them are of the form "the rail does NOT offer X", and a rail
   * that rendered nothing at all would satisfy every one. This is the reading
   * that proves the rail is drawn and drawn completely, so that an absence
   * measured later is a real absence.
   */
  it('CONTROL: the rail offers every section, as links', () => {
    renderAt('/acme/marketplace/browse')
    const hrefs = railHrefs()
    expect(hrefs).toEqual([
      '/acme/marketplace/browse',
      '/acme/marketplace/installed',
      '/acme/marketplace/licences',
      '/acme/marketplace/upload',
      '/acme/marketplace/profile',
      '/acme/marketplace/listings',
      '/acme/marketplace/payouts',
      '/acme/marketplace/sales',
    ])
  })

  it('a section is reachable by URL, and the rail follows it', () => {
    for (const [pathname, label] of [
      ['/acme/marketplace/browse', 'Browse All'],
      ['/acme/marketplace/installed', 'Installed'],
      ['/acme/marketplace/licences', 'Licences'],
      ['/acme/marketplace/payouts', 'Payouts'],
      ['/acme/marketplace/sales', 'Sales'],
    ] as const) {
      const { unmount } = renderAt(pathname)
      // `aria-current="page"` is what the rail marks the active section with,
      // so this reads the selection rather than inferring it from order.
      const current = screen
        .getAllByRole('tab')
        .filter((tab) => tab.getAttribute('aria-current') === 'page')
      expect(current).toHaveLength(1)
      expect(current[0].textContent).toContain(label)
      unmount()
    }
  })

  it('the breadcrumb names the section the reader is on', () => {
    renderAt('/acme/marketplace/payouts')
    // The hub, then the section. A trail ending at "Marketplace" names every
    // level except the reader's, which is the one that says where they are —
    // the drift the four earlier hubs had to be corrected for.
    expect(crumbs()).toEqual(['Marketplace', 'Payouts'])
  })

  it('back and forward walk sections', () => {
    const { rerender } = renderAt('/acme/marketplace/licences')
    expect(crumbs()).toEqual(['Marketplace', 'Licences'])

    /*
     * A navigation, NOT a remount. Back and forward move between two states of
     * one mounted layout, which is precisely what the `?tab=` rail got wrong
     * before AGL-2486: it read the incoming id into `useState`, so the
     * selection froze at whatever it was on first paint. Moving the pathname
     * under a live tree is the only way to catch that.
     */
    mockPathname = '/acme/marketplace/installed'
    rerender(
      <MarketplaceSectionsLayout>
        <div data-testid="section-body">{'section body'}</div>
      </MarketplaceSectionsLayout>,
    )
    expect(crumbs()).toEqual(['Marketplace', 'Installed'])
    const current = screen
      .getAllByRole('tab')
      .filter((tab) => tab.getAttribute('aria-current') === 'page')
    expect(current[0].textContent).toContain('Installed')
  })

  describe('the seller sections are gated above the pages', () => {
    it('a member without publish permission is not offered them', () => {
      mockPermissions = { publishToMarketplace: false }
      renderAt('/acme/marketplace/browse')
      expect(railHrefs()).toEqual([
        '/acme/marketplace/browse',
        '/acme/marketplace/installed',
        '/acme/marketplace/licences',
      ])
    })

    it('and typing a seller URL is refused, not rendered', () => {
      mockPermissions = { publishToMarketplace: false }
      renderAt('/acme/marketplace/payouts')
      // The page body must not reach the screen. The rail hiding the entry is
      // not a gate: a route is reachable whether or not a tab was offered.
      expect(screen.queryByTestId('section-body')).toBeNull()
      expect(
        screen.getByText(/limited to members with permission to publish/i),
      ).not.toBeNull()
    })

    it('and the fail-open permission window draws no rail at all', () => {
      /*
       * `useOrgPermissions` answers as an ADMIN until the member read lands.
       * Drawing the rail during that window offers Payouts and Sales — which
       * render the org's revenue — to a member about to be refused them.
       */
      mockPermissionsLoaded = false
      mockPermissions = { publishToMarketplace: true }
      renderAt('/acme/marketplace/browse')
      expect(screen.queryAllByRole('tab')).toHaveLength(0)
      expect(screen.queryByTestId('section-body')).toBeNull()
    })
  })
})
