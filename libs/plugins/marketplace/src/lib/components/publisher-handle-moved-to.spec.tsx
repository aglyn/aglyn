/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * A RENAMED PUBLISHER HANDLE STILL RESOLVES (AGL-2312).
 *
 * `claimPublisherHandle` leaves `{ orgId, movedTo, renamedAt }` on the old
 * handle and says why: *"so old marketplace links can still resolve"*. Nothing
 * read it. A publisher who renamed silently broke every existing link to their
 * storefront — SEO and referral traffic to PAID listings — and the page
 * rendered the bare title `'Publisher'`.
 *
 * The contrast that proves it is an omission: the ORG-SLUG tombstone written
 * identically in `organizations.ts` IS read, through
 * `/api/orgs/slug-verdict` → `middleware.ts`.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - THE TARGET COMES FROM THE TOMBSTONE. `rename A→B, request A, land on B`
 *    is run twice with DIFFERENT new handles, so a redirect wired to a
 *    constant — or to the requested segment — dies on the second pass. A test
 *    that asserted "a redirect happened" would pass with either bug.
 *  - IT DOES NOT FIRE ON A LIVE HANDLE. This runs on every publisher page
 *    view; a false positive bounces working storefronts, which is strictly
 *    worse than the defect being fixed.
 *  - IT DOES NOT FIRE WHILE LOADING. A redirect issued off a half-resolved
 *    page is a redirect nobody can reproduce.
 */

import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockReplace = jest.fn()

/** What each of the three lookups answers this render. */
const mockState: {
  segment: string
  byHandle: { data: any[] | undefined; status: string }
  byId: { data: any; status: string }
  tombstone: { data: any; status: string }
} = {
  segment: 'old-handle',
  byHandle: { data: [], status: 'success' },
  byId: { data: undefined, status: 'success' },
  tombstone: { data: undefined, status: 'success' },
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}))

/**
 * The three reads keyed by the COLLECTION the page asked for, not by call
 * order.
 *
 * Order-keyed doubles are how a spec starts passing for the wrong reason the
 * moment a hook is added above the ones under test — and this page has two
 * `useFirestoreDoc` calls that differ only in their collection.
 */
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useFirestoreCollection: () => mockState.byHandle,
  useFirestoreDoc: (build: () => unknown) =>
    String(build()) === 'publisherHandles' ? mockState.tombstone : mockState.byId,
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: () => 'publisherProfiles',
  query: (name: string) => name,
  where: () => undefined,
  limit: () => undefined,
  doc: (_db: unknown, name: string) => name,
}))

/*
 * The chrome the shell used to own is published upward now (AGL-3080), and
 * the org, the site and the reader's permissions arrive as props — so the
 * console-hook doubles this spec carried are gone with the hooks. What is
 * left is the grid, which mounts its own listener stack and is not what this
 * spec is about.
 */
jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  PageHeaderRecord: () => null,
  PageHeaderHelp: () => null,
  pluginDocsHelp: () => ({ title: '', excerpt: '', href: '' }),
}))
jest.mock('./marketplace-browse.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
}))

import PublisherPage from './publisher-profile-page.component'

beforeEach(() => {
  jest.clearAllMocks()
  mockState.segment = 'old-handle'
  mockState.byHandle = { data: [], status: 'success' }
  mockState.byId = { data: undefined, status: 'success' }
  mockState.tombstone = { data: undefined, status: 'success' }
})

describe('THE TARGET COMES FROM THE TOMBSTONE', () => {
  it('lands on whatever handle the tombstone names', async () => {
    // Two renames of the SAME old handle to DIFFERENT new ones. A redirect
    // that hardcoded a destination, or reused the requested segment, passes
    // exactly one of these.
    for (const newHandle of ['brightforge', 'lumenworks']) {
      jest.clearAllMocks()
      mockState.tombstone = {
        data: { orgId: 'org-1', movedTo: newHandle },
        status: 'success',
      }
      const view = render(<PublisherPage
        segment={mockState.segment}
        basePath="/acme/marketplace"
        actingHost="h1"
        orgSlug="acme"
      />)
      await waitFor(() => expect(mockReplace).toHaveBeenCalled())
      expect(String(mockReplace.mock.calls[0][0])).toContain(newHandle)
      // …and to the publisher route, not some other page that happens to
      // contain the handle.
      expect(String(mockReplace.mock.calls[0][0])).toContain('marketplace')
      view.unmount()
    }
  })

  it('replaces rather than pushes — the old URL is not somewhere to go back to', async () => {
    mockState.tombstone = {
      data: { orgId: 'org-1', movedTo: 'brightforge' },
      status: 'success',
    }
    render(<PublisherPage
        segment={mockState.segment}
        basePath="/acme/marketplace"
        actingHost="h1"
        orgSlug="acme"
      />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))
  })
})

describe('it does NOT fire when it must not', () => {
  it('leaves a LIVE handle alone', async () => {
    // The control that matters most: this code runs on every publisher page
    // view, and a false positive bounces working storefronts.
    mockState.byHandle = {
      data: [{ $id: 'prof-1', handle: 'old-handle', displayName: 'Acme' }],
      status: 'success',
    }
    // A stale tombstone alongside a live profile is exactly the one-render
    // overlap the guard has to survive.
    mockState.tombstone = {
      data: { orgId: 'org-1', movedTo: 'brightforge' },
      status: 'success',
    }
    render(<PublisherPage
        segment={mockState.segment}
        basePath="/acme/marketplace"
        actingHost="h1"
        orgSlug="acme"
      />)
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled())
  })

  it('leaves a handle whose reservation carries no movedTo alone', async () => {
    // A live reservation for a handle whose profile has not been created yet.
    // There is nowhere to send anyone.
    mockState.tombstone = { data: { orgId: 'org-1' }, status: 'success' }
    render(<PublisherPage
        segment={mockState.segment}
        basePath="/acme/marketplace"
        actingHost="h1"
        orgSlug="acme"
      />)
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled())
  })

  it('does not bounce a page whose profile lookup is still loading', async () => {
    mockState.byHandle = { data: undefined, status: 'loading' }
    mockState.tombstone = {
      data: { orgId: 'org-1', movedTo: 'brightforge' },
      status: 'success',
    }
    render(<PublisherPage
        segment={mockState.segment}
        basePath="/acme/marketplace"
        actingHost="h1"
        orgSlug="acme"
      />)
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled())
  })

  it('does not bounce while the tombstone read is still loading', async () => {
    mockState.tombstone = { data: undefined, status: 'loading' }
    render(<PublisherPage
        segment={mockState.segment}
        basePath="/acme/marketplace"
        actingHost="h1"
        orgSlug="acme"
      />)
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled())
  })

  it('never redirects a handle to itself', async () => {
    // A tombstone naming its own handle is corrupt data, and following it is
    // an infinite bounce rather than a broken link.
    mockState.tombstone = {
      data: { orgId: 'org-1', movedTo: 'old-handle' },
      status: 'success',
    }
    render(<PublisherPage
        segment={mockState.segment}
        basePath="/acme/marketplace"
        actingHost="h1"
        orgSlug="acme"
      />)
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled())
  })
})
