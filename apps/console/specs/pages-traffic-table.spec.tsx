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
 * The Analytics Pages table names WHICH product, post and collection was
 * visited (AGL-4253), not the template screen behind them.
 *
 * Before: the table grouped `screenAnalytics` by screen id, and every product
 * renders through one template screen, so a store's whole catalog was one row
 * named `cr-product`. These tests seed exactly that site — three products, a
 * store collection, a blog post and two plain pages — and assert each visited
 * record is its own named row, the template never appears, and the columns the
 * data cannot split per page say so.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const NOW = Date.parse('2026-11-25T12:00:00Z')

type Data = Record<string, unknown>
/** path → document data. */
let mockDocs: Record<string, Data> = {}
let mockFailDays: Set<string> = new Set()
let mockQueries: any[] = []

const DOC_ID = '__name__'

function mockRun(request: any): Array<{ id: string; data: () => Data }> {
  mockQueries.push(request)
  const prefix = `${request.path}/`
  let rows = Object.entries(mockDocs)
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map(([path, data]) => ({ id: path.slice(prefix.length), data }))
  for (const clause of request.constraints) {
    if (clause.type !== 'where') continue
    const value = (row: { id: string; data: Data }) =>
      clause.field === DOC_ID ? row.id : row.data[clause.field]
    if (clause.op === 'in') rows = rows.filter((row) => clause.value.includes(value(row)))
    if (clause.op === '>=') rows = rows.filter((row) => String(value(row)) >= clause.value)
  }
  return rows.map((row) => ({ id: row.id, data: () => row.data }))
}

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [] as unknown[],
  }),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  documentId: () => DOC_ID,
  orderBy: (field: string, direction = 'asc') => ({ type: 'orderBy', field, direction }),
  limit: (value: number) => ({ type: 'limit', value }),
  where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }),
  query: (source: any, ...constraints: unknown[]) => ({
    ...source,
    constraints: [...source.constraints, ...constraints],
  }),
  getDoc: async (path: string) => {
    const day = path.split('/').pop() as string
    if (path.includes('/analytics/') && mockFailDays.has(day)) {
      throw new Error('permission-denied')
    }
    const data = mockDocs[path]
    return { exists: () => Boolean(data), data: () => data, get: (field: string) => data?.[field] }
  },
  getDocs: async (request: any) => ({ docs: mockRun(request) }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children, href }: { children: ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({
    children,
    HeaderProps,
  }: {
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'pro' }, ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({ __esModule: true, useOrgSlug: () => 'acme' }))
jest.mock('../components/host-id-provider', () => ({
  __esModule: true,
  useHostSubdomain: () => 'shop',
}))

import { registerSitePathKind } from '@aglyn/aglyn/plugin-manager/site-path-kinds'
import PagesTrafficTable, {
  resetPagesTrafficCache,
} from '../components/analytics/pages-traffic-table.component'
import { recentDayIds, resetAnalyticsDayCache } from '../utils/analytics-day-cache'
import { resetSitePageLabelCache } from '../utils/site-page-labels'

const HOST = 'host-1'
const H = `hosts/${HOST}`

// What a store plugin declares; the core never names it.
registerSitePathKind(
  {
    segment: 'products',
    groupLabel: 'Products',
    noun: 'product',
    collection: 'products',
    editHref: (context, id) => `/${context.orgSlug}/hosts/${context.host}/products/catalog?product=${id}`,
  },
  { pluginId: 'test-store' },
)
registerSitePathKind(
  {
    segment: 'collections',
    groupLabel: 'Collections',
    noun: 'collection',
    collection: 'collections',
    accepts: (data) => data['kind'] === 'catalog',
  },
  { pluginId: 'test-store' },
)

const days = recentDayIds(NOW, 14)

function seed() {
  mockDocs = {
    [H]: {
      subdomain: 'shop',
      screens: {
        'screen-home': '/',
        'screen-about': 'about',
        // A published product template keeps a routing entry; the loader
        // drops it, and so must the table.
        'tpl-entry': 'blog-entry-template',
      },
    },
    [`${H}/screens/screen-home`]: { displayName: 'Home', versionId: 'v1' },
    [`${H}/screens/screen-about`]: { displayName: 'About us', versionId: 'v2' },
    [`${H}/collections/col-blog`]: {
      kind: 'content',
      slug: 'blog',
      displayName: 'Journal',
      entryScreenId: 'tpl-entry',
    },
    [`${H}/collections/col-helmets`]: { kind: 'catalog', slug: 'helmets', name: 'Helmets' },
    [`${H}/collections/col-blog/entries/e1`]: { slug: 'race-recap', title: 'Race weekend recap' },
    [`${H}/products/p1`]: { slug: 'nova-jersey', name: 'Nova Jersey' },
    [`${H}/products/p2`]: { slug: 'apex-pant', name: 'Apex Pant' },
    // Never visited: must not be read for a label, nor listed.
    [`${H}/products/p3`]: { slug: 'quiet-glove', name: 'Quiet Glove' },
    [`${H}/analytics/${days[0]}`]: {
      paths: {
        '/': 10,
        '/about': 4,
        '/products/nova-jersey': 23,
        '/products/apex-pant': 5,
        '/products/gone-hoodie': 2,
        '/collections/helmets': 7,
        '/blog/race-recap': 6,
        '/wp-login_php': 1,
        '/signin': 3,
      },
    },
    [`${H}/analytics/${days[1]}`]: {
      // The same page with a trailing slash is the same row.
      paths: { '/products/nova-jersey/': 2, '/about': 1 },
    },
    [`${H}/screenAnalytics/screen-about:${days[0]}`]: {
      screenId: 'screen-about',
      day: days[0],
      total: 5,
      devices: { mobile: 4, desktop: 1 },
      referrers: { 'news_example_test': 3 },
    },
    [`${H}/screenAnalytics/tpl-product:${days[0]}`]: {
      screenId: 'tpl-product',
      day: days[0],
      total: 30,
      devices: { desktop: 30 },
      referrers: {},
    },
  }
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  resetAnalyticsDayCache()
  resetSitePageLabelCache()
  resetPagesTrafficCache()
  mockFailDays = new Set()
  mockQueries = []
  seed()
})
afterEach(() => jest.restoreAllMocks())

const pageCells = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelectorAll('td')[0]?.textContent ?? '')

async function mount() {
  render(<PagesTrafficTable hostId={HOST} />)
  await waitFor(() => expect(screen.getByText('Nova Jersey')).toBeTruthy())
}

describe('the Pages table names each visited record (AGL-4253)', () => {
  it('lists every product, post and collection by its own name', async () => {
    await mount()
    for (const name of [
      'Nova Jersey',
      'Apex Pant',
      'Helmets',
      'Race weekend recap',
      'About us',
      'Home',
    ]) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    // The template screens never appear as a page.
    expect(screen.queryByText(/tpl-|cr-product|blog-entry-template/)).toBeNull()
  })

  it('counts a path with and without its trailing slash as one row', async () => {
    await mount()
    const nova = screen.getByText('Nova Jersey').closest('tr') as HTMLElement
    expect(within(nova).getByText('25')).toBeTruthy()
    expect(pageCells().filter((cell) => cell.includes('Nova Jersey'))).toHaveLength(1)
  })

  it('links a record to its editor and its live page', async () => {
    await mount()
    expect(screen.getByText('Nova Jersey').closest('a')?.getAttribute('href')).toBe(
      '/acme/hosts/shop/products/catalog?product=p1',
    )
    expect(screen.getByText('Race weekend recap').closest('a')?.getAttribute('href')).toBe(
      '/acme/hosts/shop/content/blog/entries/e1',
    )
    expect(
      screen.getByLabelText('Open Nova Jersey on the live site').getAttribute('href'),
    ).toMatch(/^https:\/\/shop\..+\/products\/nova-jersey$/)
  })

  it('never lists an unvisited product, and reads only visited slugs', async () => {
    await mount()
    expect(screen.queryByText('Quiet Glove')).toBeNull()
    const productQuery = mockQueries.find((one) => one.path === `${H}/products`)
    const asked = productQuery.constraints.find((c: any) => c.op === 'in').value
    expect([...asked].sort()).toEqual(['apex-pant', 'gone-hoodie', 'nova-jersey'])
  })

  it('says a removed record is gone, and files a dead address under Other', async () => {
    await mount()
    expect(screen.getByText(/gone-hoodie · Not a product on this site now/)).toBeTruthy()
    expect(screen.getByText(/wp-login_php · Not a page, product or post of this site now/)).toBeTruthy()
    const dead = screen.getByText('/wp-login_php', { selector: 'p' }).closest('tr') as HTMLElement
    expect(within(dead).getByText('Other addresses')).toBeTruthy()
  })

  it('names a built-in page rather than calling it an address nothing answers', async () => {
    await mount()
    const signIn = screen.getByText('Sign in').closest('tr') as HTMLElement
    expect(within(signIn).getByText('Built-in pages')).toBeTruthy()
    expect(within(signIn).queryByText(/Not a page/)).toBeNull()
  })

  it('filters to one kind: Products answers "which products are looked at"', async () => {
    await mount()
    fireEvent.click(screen.getByText(/^Products · 3/))
    const cells = pageCells()
    expect(cells).toHaveLength(3)
    expect(cells[0]).toContain('Nova Jersey')
    expect(cells[1]).toContain('Apex Pant')
    expect(cells[2]).toContain('/products/gone-hoodie')
    expect(screen.queryByText('About us')).toBeNull()
  })

  it('shows device and referrer only where they were counted per page', async () => {
    await mount()
    const about = screen.getByText('About us').closest('tr') as HTMLElement
    expect(within(about).getByText('mobile')).toBeTruthy()
    // A product row shares its template's counts: it says so, never "desktop".
    const nova = screen.getByText('Nova Jersey').closest('tr') as HTMLElement
    expect(within(nova).getAllByText('Site-wide')).toHaveLength(2)
    expect(within(nova).queryByText(/desktop/i)).toBeNull()
  })

  it('the screen query still reads the NEWEST end of its window (AGL-2501)', async () => {
    await mount()
    const screenQuery = mockQueries.find((one) => one.path === `${H}/screenAnalytics`)
    expect(screenQuery.constraints).toEqual(
      expect.arrayContaining([
        { type: 'orderBy', field: 'day', direction: 'desc' },
        { type: 'limit', value: 1000 },
      ]),
    )
  })

  it('says which days could not be read instead of counting them as zero', async () => {
    mockFailDays = new Set([days[3], days[4]])
    await mount()
    expect(screen.getByText(/2 of the 14 days in this range could not be read/)).toBeTruthy()
  })
})
