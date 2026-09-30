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
 * THE GALLERY'S SHELVES ARE QUERIES (AGL-3321), and it is still a gallery.
 *
 * The Saved, Starters and Marketplace shelves each put their scope and the
 * search word on their own Firestore query and page what it answers. So a
 * template on the third page of a library is found by a search typed on the
 * first — which the old gallery, matching its capped windows in memory,
 * could not do. The cards, the shelves and the search box are unchanged.
 */

import { displayNameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import { LIST_QUERY_ID_PATH } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import type { UseListQueryOptions } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  lastListQueryPlan,
  useListQueryDouble,
} from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/** Read by the hook mock at render time, after every import has resolved. */
const mockUseListQueryDouble = useListQueryDouble

/** Every plan a shelf asked, by collection — the newest last. */
const mockPlans = new Map<string, unknown[]>()
/** Whether any plan asked of `path` matches. */
const asked = (path: string, expected: Record<string, unknown>) =>
  expect(mockPlans.get(path) ?? []).toEqual(
    expect.arrayContaining([expect.objectContaining(expected)]),
  )

/** A template or listing as every writer stores it. */
const stored = (doc: Record<string, unknown>) => ({
  ...displayNameSearchFields(doc['displayName']),
  ...doc,
})

let mockTemplates: Array<Record<string, unknown>> = []
let mockListings: Array<Record<string, unknown>> = []

/** ONE Firestore instance, as the real hook hands back. */
const mockDb = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockDb,
  useUser: () => ({ data: { uid: 'user-1' } }),
  useHostResourceApi: () => jest.fn(),
  useHostVersionApi: () => jest.fn(),
  // The bounded read of which code starters this site has materialized.
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => ({
  ...jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
  useListQuery: (options: UseListQueryOptions) => {
    const path = (options.collection as unknown as { path?: string } | null)?.path ?? ''
    const answer = mockUseListQueryDouble(
      () => (path === 'marketplaceListings' ? mockListings : mockTemplates),
      options,
    )
    if (options.collection) mockPlans.set(path, [...(mockPlans.get(path) ?? []), answer.plan])
    return answer
  },
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: unknown) => base,
  where: () => ({}),
  getDocs: async () => ({ docs: [] }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  MdiIcon: () => null,
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('../host-id-provider', () => ({ useHostSubdomain: () => 'site' }))
jest.mock('../../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: {}, ready: true }),
}))
jest.mock('./use-template-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))

import TemplateGalleryDialog from './template-gallery-dialog.component'
import { LIBRARY_TEMPLATE_SOURCE_TYPES } from './template-source-badge'

const open = (kind: 'page' | 'component' = 'page') =>
  render(
    <TemplateGalleryDialog
      hostId="host-1"
      open
      onClose={jest.fn()}
      existingSlugs={[]}
      screenCount={0}
      kind={kind}
    />,
  )

const search = (value: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'search templates' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'search templates' }), {
    target: { value },
  })
}

beforeEach(() => {
  mockPlans.clear()
  // Twenty-five saved page templates, and the one searched for last in the
  // walk: THE CONTROL that a search over the first page would miss it.
  mockTemplates = Array.from({ length: 25 }, (_, index) =>
    stored({
      $id: `tpl-${String(index).padStart(3, '0')}`,
      kind: 'page',
      displayName: index === 24 ? 'Harvest menu' : `Saved page ${index}`,
      source: { type: 'authored' },
      libraryRow: true,
    }),
  )
  mockListings = [
    stored({ $id: 'listing-1', kind: 'template', displayName: 'Bakery site', latestVersion: 1 }),
    stored({ $id: 'listing-2', kind: 'template', displayName: 'Florist site', latestVersion: 1 }),
  ]
})

describe('the template gallery’s shelves are served by their queries (AGL-3321)', () => {
  it('asks the library for its rows of this kind, saved here or installed, walked by name', () => {
    open()
    asked('hosts/host-1/templates', {
      filters: [
        { path: 'libraryRow', op: '==', value: true },
        { path: 'kind', op: '==', value: 'page' },
        { path: 'source.type', op: 'in', value: [...LIBRARY_TEMPLATE_SOURCE_TYPES] },
      ],
      orderBy: { path: LIST_QUERY_ID_PATH, direction: 'asc' },
    })
    expect(screen.queryByText('Harvest menu')).toBeNull()
  })

  it('finds a saved template past the first page, from the first page', async () => {
    open()
    search('harv')
    await waitFor(() => expect(screen.getByText('Harvest menu')).toBeTruthy())
    expect(lastListQueryPlan()?.searched).toBe('harv')
    asked('hosts/host-1/templates', {
      filters: expect.arrayContaining([{ path: 'nameTokens', op: 'array-contains', value: 'harv' }]),
    })
  })

  it('searches the marketplace shelf by the listing’s name', async () => {
    open()
    expect(screen.getByText('Bakery site')).toBeTruthy()
    search('flor')
    await waitFor(() => expect(screen.queryByText('Bakery site')).toBeNull())
    expect(screen.getByText('Florist site')).toBeTruthy()
    asked('marketplaceListings', {
      filters: [
        { path: 'kind', op: '==', value: 'template' },
        { path: 'nameTokens', op: 'array-contains', value: 'flor' },
      ],
    })
  })

  it('asks the code-defined starters the same question: a word of the name', async () => {
    open()
    expect(screen.getByText('Portfolio')).toBeTruthy()
    search('portf')
    await waitFor(() => expect(screen.queryByText('Landing Page')).toBeNull())
    expect(screen.getByText('Portfolio')).toBeTruthy()
  })

  it('says nothing matched when no shelf has a match', async () => {
    open()
    search('zzz')
    await waitFor(() =>
      expect(screen.getByText('Nothing matches — try a different search.')).toBeTruthy(),
    )
  })

  it('offers no whole-site bundles on a component picker', () => {
    open('component')
    expect(mockPlans.has('marketplaceListings')).toBe(false)
    expect(screen.queryByText('Portfolio')).toBeNull()
    asked('hosts/host-1/templates', {
      filters: expect.arrayContaining([{ path: 'kind', op: '==', value: 'component' }]),
    })
  })
})
