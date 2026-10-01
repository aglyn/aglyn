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
 * The marketplace's shelf of the template gallery (AGL-137, AGL-3080).
 *
 * The gallery used to read this plugin's listings itself. It hands the
 * `templateGallery` zone the kind and the search word now, and this shelf
 * holds what the gallery held: site templates only, found by a word of the
 * name ON the query (AGL-3321), unpublished listings dropped, whole-site
 * bundles offered only to the page picker, an install through this plugin's
 * own route — and a report of how the shelf stands, so the gallery's
 * "nothing matches" line is true.
 */

import { displayNameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import type { UseListQueryOptions } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { useListQueryDouble } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/** Read by the hook mock at render time, after every import has resolved. */
const mockUseListQueryDouble = useListQueryDouble

/** Every plan the shelf asked, by collection. */
const mockPlans = new Map<string, any[]>()
let mockListings: Array<Record<string, unknown>> = []
const mockFetch = jest.fn()
const mockSnack = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  parseLockdownRefusal: (status: number, payload: any) =>
    status === 423 ? payload : null,
  lockdownRefusalText: () => 'Installs are paused on this workspace',
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'user-1' } }),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => ({
  ...jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
  useListQuery: (options: UseListQueryOptions) => {
    const path = (options.collection as unknown as { path?: string } | null)?.path ?? ''
    const answer = mockUseListQueryDouble(() => mockListings, options)
    if (options.collection) mockPlans.set(path, [...(mockPlans.get(path) ?? []), answer.plan])
    return answer
  },
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnack }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import { TemplateGalleryShelf } from './template-gallery-shelf.component'

const listing = (doc: Record<string, unknown>) => ({
  ...displayNameSearchFields(doc['displayName']),
  kind: 'template',
  latestVersion: 1,
  ...doc,
})

function draw(props: Partial<Parameters<typeof TemplateGalleryShelf>[0]> = {}) {
  const reportShelf = jest.fn()
  const onInstalled = jest.fn()
  const view = render(
    <TemplateGalleryShelf
      hostId="host-1"
      kind="page"
      search=""
      onInstalled={onInstalled}
      reportShelf={reportShelf}
      {...props}
    />,
  )
  return { ...view, reportShelf, onInstalled }
}

beforeEach(() => {
  mockPlans.clear()
  mockFetch.mockReset()
  mockSnack.mockReset()
  mockListings = [
    listing({ $id: 'listing-1', displayName: 'Bakery site', priceUsd: 0 }),
    listing({ $id: 'listing-2', displayName: 'Florist site', priceUsd: 12 }),
    listing({ $id: 'listing-3', displayName: 'Retired site', deletedAt: 1 }),
    listing({ $id: 'listing-4', kind: 'plugin', displayName: 'A plugin' }),
  ]
})

describe('the marketplace shelf of the template gallery', () => {
  it('asks for site templates by a word of the name, and says it is showing them', () => {
    const { reportShelf } = draw({ search: 'flor' })
    expect(mockPlans.get('marketplaceListings')?.at(-1)).toEqual(
      expect.objectContaining({
        filters: [
          { path: 'kind', op: '==', value: 'template' },
          { path: 'nameTokens', op: 'array-contains', value: 'flor' },
        ],
      }),
    )
    expect(screen.getByText('Florist site')).toBeTruthy()
    expect(screen.queryByText('Bakery site')).toBeNull()
    expect(screen.getByText('? pages · v1 · $12')).toBeTruthy()
    expect(reportShelf).toHaveBeenLastCalledWith('marketplace-site-templates', 'shown')
  })

  it('drops an unpublished listing from the page it falls in', () => {
    draw()
    expect(screen.getByText('Bakery site')).toBeTruthy()
    expect(screen.queryByText('Retired site')).toBeNull()
    expect(screen.queryByText('A plugin')).toBeNull()
  })

  it('reports an empty shelf and draws nothing when nothing matches', () => {
    const { container, reportShelf } = draw({ search: 'zzz' })
    expect(container.textContent).toBe('')
    expect(reportShelf).toHaveBeenLastCalledWith('marketplace-site-templates', 'empty')
  })

  it('offers no whole-site bundle to a component picker, and asks nothing', () => {
    const { container, reportShelf } = draw({ kind: 'component' })
    expect(container.textContent).toBe('')
    expect(mockPlans.has('marketplaceListings')).toBe(false)
    expect(reportShelf).toHaveBeenLastCalledWith('marketplace-site-templates', 'empty')
  })

  it('installs through its own route, into the site, and lets the gallery close', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ templates: 3 }) })
    const { onInstalled } = draw({ search: 'bak' })
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    await waitFor(() => expect(onInstalled).toHaveBeenCalled())
    const [, url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/marketplace/install-template')
    expect(JSON.parse(init.body)).toEqual({ listingId: 'listing-1', hostId: 'host-1' })
    expect(mockSnack.mock.calls[0][0]).toContain('Saved 3 templates from "Bakery site"')
  })

  it('says an installs lock is a lock, and keeps the gallery open', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 423, json: async () => ({ lockdown: true }) })
    const { onInstalled } = draw({ search: 'bak' })
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    await waitFor(() =>
      expect(mockSnack).toHaveBeenCalledWith('Installs are paused on this workspace', {
        variant: 'warning',
        persist: true,
      }),
    )
    expect(onInstalled).not.toHaveBeenCalled()
  })
})
