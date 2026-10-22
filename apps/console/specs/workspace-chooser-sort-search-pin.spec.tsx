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
 * The workspace chooser is in name order, pinnable, searchable and filterable
 * (AGL-3762).
 *
 * It listed memberships in the order the listen returned them — Eastwood
 * Plumbing, Northwind Coffee, Ember Studio, Test Org, Aglyn LLC — with
 * no way to find one or keep the one you use first. The ordering rules
 * themselves are `utils/workspace-list.spec.ts`; this is the page wearing
 * them: the cards, the pin in each card's header, the search box, and the
 * rule that nothing is arranged until the membership set is complete.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const mockFirestore = {}
const mockToggle = jest.fn()
const mockReplace = jest.fn()
let mockFull = false
const mockLoadMore = jest.fn()
let mockPinned: string[] = []
let mockPlans: Record<string, string> = {}
const mockPlanReads = jest.fn()

jest.mock('../hooks/use-pinned-orgs', () => ({
  __esModule: true,
  usePinnedOrgs: () => ({
    pinned: mockPinned,
    ready: true,
    full: mockFull,
    toggle: mockToggle,
    replace: mockReplace,
  }),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-org-plans', () => ({
  __esModule: true,
  useOrgPlans: (ids: string[]) => {
    mockPlanReads(ids)
    return mockPlans
  },
}))
jest.mock('next/navigation', () => {
  const router = { push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }
  return {
    ...jest.requireActual('next/navigation'),
    useRouter: () => router,
    useParams: () => ({}),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
  }
})

let mockScope: {
  orgs: Array<{ $id: string; slug: string; orgName?: string; role?: string }>
  loading: boolean
  confirmed: boolean
  hasMoreOrgs: boolean
  loadMoreOrgs: () => void
}

jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => mockScope,
  useOrgSlug: () => '',
}))
jest.mock('../hooks/use-pending-invites', () => ({
  usePendingInvites: () => ({ invites: [], loading: false }),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: async () => ({ data: () => ({}) }),
  setDoc: async () => undefined,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: { uid: 'u-1' } }),
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/create-host-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/create-org-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/org-invites-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/marketing-consent-prompt.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: jest.fn(),
  trackEventBeforeNavigation: jest.fn(async () => undefined),
}))

const OrgJump = require('../app/(app)/(home)/page').default

/** The five workspaces from the report, in the order the listen gave them. */
const REPORTED = [
  { $id: 'org-ewd', slug: 'eastwood', orgName: 'Eastwood Plumbing', role: 'owner' },
  { $id: 'org-nwc', slug: 'northwind-coffee', orgName: 'Northwind Coffee', role: 'admin' },
  { $id: 'org-emb', slug: 'ember', orgName: 'Ember Studio', role: 'editor' },
  { $id: 'org-tst', slug: 'test-org', orgName: 'Test Org', role: 'viewer' },
  { $id: 'org-agl', slug: 'aglyn', orgName: 'Aglyn LLC', role: 'owner' },
]

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** The cards on screen, by the link each one opens. */
const cardSlugs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('a[href]')).map((node) =>
    (node.getAttribute('href') ?? '').split('/')[1],
  )

beforeEach(() => {
  jest.clearAllMocks()
  jest.useRealTimers()
  mockPinned = []
  mockFull = false
  mockPlans = {}
  mockScope = {
    orgs: REPORTED,
    loading: false,
    confirmed: true,
    hasMoreOrgs: false,
    loadMoreOrgs: mockLoadMore,
  }
})

describe('AGL-3762 · the workspace chooser', () => {
  it('lists the workspaces by name, A to Z', async () => {
    const { container } = render(<OrgJump />)
    await flush()
    // Red before: eastwood, northwind-coffee, ember, test-org, aglyn.
    expect(cardSlugs(container)).toEqual([
      'aglyn',
      'eastwood',
      'ember',
      'northwind-coffee',
      'test-org',
    ])
  })

  it('leads with the pinned workspaces, and marks their pins pressed', async () => {
    mockPinned = ['org-tst', 'org-gone']
    const { container } = render(<OrgJump />)
    await flush()
    expect(cardSlugs(container)).toEqual([
      'test-org',
      'aglyn',
      'eastwood',
      'ember',
      'northwind-coffee',
    ])
    expect(
      screen.getByRole('button', { name: 'Unpin Test Org' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Pin Aglyn LLC' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('pins from the card header', async () => {
    render(<OrgJump />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Pin Northwind Coffee' }))
    expect(mockToggle).toHaveBeenCalledWith('org-nwc')
  })

  it('asks which pin a sixth replaces, and replaces the one picked (AGL-3943)', async () => {
    mockPinned = ['org-ewd', 'org-emb', 'org-tst', 'org-agl', 'org-x']
    mockFull = true
    mockToggle.mockReturnValueOnce('full')
    render(<OrgJump />)
    await flush()
    const pin = screen.getByRole('button', { name: 'Pin Northwind Coffee' })
    // Shown, never hidden: the pin stays enabled and opens the question.
    expect((pin as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(pin)
    expect(mockToggle).toHaveBeenCalledWith('org-nwc')
    expect(screen.getByText('Pinned is full. Replace one?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Replace Test Org' }))
    expect(mockReplace).toHaveBeenCalledWith('org-tst', 'org-nwc')
  })

  it('keeps each page the same five workspaces, in order across pages', async () => {
    mockScope.orgs = [
      ...REPORTED,
      { $id: 'org-bkr', slug: 'bakery', orgName: 'Bakery' },
      { $id: 'org-zed', slug: 'zed', orgName: 'Zed' },
    ]
    const { container } = render(<OrgJump />)
    await flush()
    expect(cardSlugs(container)).toEqual([
      'aglyn',
      'bakery',
      'eastwood',
      'ember',
      'northwind-coffee',
    ])
    fireEvent.click(screen.getByRole('button', { name: /go to next page/i }))
    expect(cardSlugs(container)).toEqual(['test-org', 'zed'])
    expect(screen.getByText('6–7 of 7 workspaces')).toBeTruthy()
  })

  it('searches by name or slug', async () => {
    jest.useFakeTimers()
    const { container } = render(<OrgJump />)
    await flush()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search by name or slug' }), {
      target: { value: 'coffee' },
    })
    await act(async () => {
      jest.advanceTimersByTime(400)
    })
    expect(cardSlugs(container)).toEqual(['northwind-coffee'])

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search by name or slug' }), {
      target: { value: 'nothing-like-it' },
    })
    await act(async () => {
      jest.advanceTimersByTime(400)
    })
    expect(cardSlugs(container)).toEqual([])
    expect(
      screen.getByText('No workspaces match this search and these filters.'),
    ).toBeTruthy()
  })

  it('offers the shared Filters panel', async () => {
    render(<OrgJump />)
    await flush()
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy()
  })

  it('arranges nothing until the membership set is complete', async () => {
    // A sorted WINDOW would put a workspace last on one page and move it when
    // the window grew; the chooser grows the window to the end first.
    mockScope.hasMoreOrgs = true
    const { container } = render(<OrgJump />)
    await flush()
    expect(mockLoadMore).toHaveBeenCalled()
    expect(cardSlugs(container)).toEqual([])
    expect(screen.getByLabelText('Loading workspaces')).toBeTruthy()
  })

  it('reads no plans until the Plan filter asks for them', async () => {
    render(<OrgJump />)
    await flush()
    // One read per workspace is paid only by a reader who filters by plan.
    expect(mockPlanReads).not.toHaveBeenCalled()
  })
})
