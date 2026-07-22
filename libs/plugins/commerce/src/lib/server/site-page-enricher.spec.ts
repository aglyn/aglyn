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

jest.mock('./catalog', () => ({
  queryPublicCatalog: jest.fn(),
}))

import { commerceSitePageEnricher } from './site-page-enricher'
import { queryPublicCatalog } from './catalog'

const mockQuery = queryPublicCatalog as jest.MockedFunction<
  typeof queryPublicCatalog
>

/** A composed page holding the given nodes under a container. */
const page = (...nodes: unknown[]) => ({
  $id: 'root',
  componentId: 'container',
  children: [{ $id: 'section', componentId: 'container', children: nodes }],
})

const grid = ($id: string, props: Record<string, unknown> = {}) => ({
  $id,
  componentId: 'product-grid',
  props,
})

const run = (nodes: unknown, path = '/products') =>
  commerceSitePageEnricher({
    hostId: 'host1',
    host: {},
    path,
    slugSegments: path.split('/').filter(Boolean),
    nodes,
  })

describe('commerceSitePageEnricher (AGL-659)', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQuery.mockResolvedValue({ items: [{ id: 'p1' } as never] })
  })

  it('returns nothing when the page has no grid', async () => {
    expect(await run(page({ $id: 'text', componentId: 'mui-typography' })))
      .toBeUndefined()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('seeds a grid keyed by its node id', async () => {
    const result = await run(page(grid('grid-1', { source: 'all' })))
    expect(result).toEqual({
      pageData: { commerce: { grids: { 'grid-1': { items: [{ id: 'p1' }] } } } },
    })
  })

  it('finds grids nested anywhere in the composed tree', async () => {
    const nested = {
      $id: 'root',
      componentId: 'container',
      children: [
        { $id: 'col', componentId: 'container', children: [grid('deep')] },
      ],
    }
    const result = await run(nested)
    expect(Object.keys((result as never as any).pageData.commerce.grids))
      .toEqual(['deep'])
  })

  it('keys two grids separately rather than sharing one seed', async () => {
    mockQuery
      .mockResolvedValueOnce({ items: [{ id: 'all' } as never] })
      .mockResolvedValueOnce({ items: [{ id: 'coffee' } as never] })
    const result = (await run(
      page(
        grid('g-all', { source: 'all' }),
        grid('g-coll', { source: 'collection', collectionId: 'c1' }),
      ),
    )) as any
    expect(result.pageData.commerce.grids['g-all'].items).toEqual([
      { id: 'all' },
    ])
    expect(result.pageData.commerce.grids['g-coll'].items).toEqual([
      { id: 'coffee' },
    ])
  })

  it('prefers the collection id over the legacy slug', async () => {
    await run(
      page(
        grid('g', {
          source: 'collection',
          collectionId: 'c1',
          collectionSlug: 'legacy',
        }),
      ),
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: 'c1' }),
    )
    expect(mockQuery.mock.calls[0][0]).not.toHaveProperty('collectionSlug')
  })

  it('follows the /collections/{slug} URL when nothing is pinned', async () => {
    await run(page(grid('g', { source: 'collection' })), '/collections/beans')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ collectionSlug: 'beans' }),
    )
  })

  it('ignores collection and category props when source is all', async () => {
    await run(page(grid('g', { source: 'all', collectionId: 'c1', tag: 't' })))
    const call = mockQuery.mock.calls[0][0]
    expect(call).not.toHaveProperty('collectionId')
    expect(call).not.toHaveProperty('tag')
  })

  it('uses pageSize as the limit ahead of maxItems', async () => {
    await run(page(grid('g', { pageSize: '12', maxItems: 50 })))
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 12 }),
    )
  })

  it('falls back to maxItems when there is no page size', async () => {
    await run(page(grid('g', { maxItems: 6 })))
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 6 }),
    )
  })

  it('requests facets only when a control needs them', async () => {
    await run(page(grid('g', { showCategories: true })))
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ facets: true }),
    )
    mockQuery.mockClear()
    await run(page(grid('g', {})))
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ facets: false }),
    )
  })

  it('never seeds a visitor filter — those start empty on mount', async () => {
    await run(page(grid('g', { source: 'all', sort: 'newest' })))
    const call = mockQuery.mock.calls[0][0]
    // Seeding any of these would make the server HTML disagree with the
    // grid's own first fetch after hydration.
    expect(call).not.toHaveProperty('query')
    expect(call).not.toHaveProperty('type')
    expect(call).not.toHaveProperty('minPriceCents')
    expect(call).not.toHaveProperty('offset')
    expect(call.sort).toBe('newest')
  })

  it('caps how many grids one page may seed', async () => {
    const many = Array.from({ length: 9 }, (_v, i) => grid(`g${i}`))
    const result = (await run(page(...many))) as any
    expect(Object.keys(result.pageData.commerce.grids)).toHaveLength(4)
  })

  it('keeps the other grids when one query fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockQuery
      .mockRejectedValueOnce(new Error('firestore down'))
      .mockResolvedValueOnce({ items: [{ id: 'ok' } as never] })
    const result = (await run(page(grid('bad'), grid('good')))) as any
    expect(result.pageData.commerce.grids).not.toHaveProperty('bad')
    expect(result.pageData.commerce.grids.good.items).toEqual([{ id: 'ok' }])
  })

  it('returns nothing when every query fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockQuery.mockRejectedValue(new Error('firestore down'))
    expect(await run(page(grid('g')))).toBeUndefined()
  })
})
