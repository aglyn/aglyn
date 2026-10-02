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
 * A site's Media page loads the organization library only when its tab is
 * opened (AGL-3457).
 *
 * The page used to stack both libraries, so every visit paid for the shared
 * one's folder rail, file query and thumbnails whether or not the reader ever
 * scrolled to it. What is held here is which `MediaLibraryComponent` is
 * MOUNTED — mounting is what starts its queries — under the real
 * `useTabParam`, so the `?tab=` round-trip is the shipped one.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import HostMedia from '../app/(app)/[orgSlug]/hosts/[host]/media/page'

const mockReplace = jest.fn()
let mockSearch = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/acme/hosts/shop/media',
  useSearchParams: () => mockSearch,
}))

let mockScope: { orgId: string | null; ready: boolean }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useOrgDataScope: () => mockScope,
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'shop',
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))

/** Each library mount, by the scope it was given. */
let mockMounted: string[] = []
jest.mock('../components/media/media-library.component', () => ({
  __esModule: true,
  default: (props: { hostId?: string; orgId?: string; forHostId?: string }) => {
    const scope = props.orgId
      ? `org:${props.orgId} for ${props.forHostId}`
      : `site:${props.hostId}`
    mockMounted.push(scope)
    return <div data-testid="library">{scope}</div>
  },
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const libraries = () => screen.queryAllByTestId('library').map((el) => el.textContent)
const orgMounts = () => mockMounted.filter((scope) => scope.startsWith('org:'))

beforeEach(() => {
  mockReplace.mockReset()
  mockSearch = new URLSearchParams()
  mockScope = { orgId: 'org-1', ready: true }
  mockMounted = []
})

describe("a site's Media page (AGL-3457)", () => {
  it('THE REGRESSION: opening the page never mounts the organization library', () => {
    render(<HostMedia />)
    expect(libraries()).toEqual(['site:host-1'])
    expect(orgMounts()).toEqual([])
  })

  it('opening the Organization tab mounts it, narrowed to this site, in place of the site one', () => {
    render(<HostMedia />)
    fireEvent.click(screen.getByRole('tab', { name: 'Organization (shared)' }))
    // `forHostId` is the AGL-1045 boundary: without it the tab would list
    // every workspace asset the viewer can see.
    expect(libraries()).toEqual(['org:org-1 for host-1'])
    expect(mockReplace).toHaveBeenCalledWith('/acme/hosts/shop/media?tab=org', {
      scroll: false,
    })
  })

  it('a ?tab=org link opens straight onto the organization library', () => {
    mockSearch = new URLSearchParams('tab=org')
    render(<HostMedia />)
    expect(libraries()).toEqual(['org:org-1 for host-1'])
    expect(mockMounted).not.toContain('site:host-1')
  })

  it('a ?tab=org link waits for the org rather than flashing the site library', () => {
    mockSearch = new URLSearchParams('tab=org')
    mockScope = { orgId: null, ready: false }
    const { rerender } = render(<HostMedia />)
    expect(screen.getByRole('tab', { name: 'Organization (shared)' })).toBeTruthy()
    expect(mockMounted).toEqual([])

    mockScope = { orgId: 'org-1', ready: true }
    rerender(<HostMedia />)
    expect(libraries()).toEqual(['org:org-1 for host-1'])
    expect(mockMounted).not.toContain('site:host-1')
  })

  it('a site with no owning org draws no rail, and ?tab=org falls back to the site library', () => {
    mockSearch = new URLSearchParams('tab=org')
    mockScope = { orgId: null, ready: true }
    render(<HostMedia />)
    expect(screen.queryAllByRole('tab')).toEqual([])
    expect(libraries()).toEqual(['site:host-1'])
  })

  it('an unknown ?tab= lands on the site library', () => {
    mockSearch = new URLSearchParams('tab=nope')
    render(<HostMedia />)
    expect(libraries()).toEqual(['site:host-1'])
    expect(orgMounts()).toEqual([])
  })
})
