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
 * Commerce by AI on the products hub (AGL-2916), mounted through the
 * `productsHub` zone's props. It stays absent while the route says the
 * feature does not exist; it starts each kind of `products` job with the
 * inputs its step reads; every proposal is reviewed in a table, and every
 * write is one of the hub's doors — Apply, Apply to all, Create drafts,
 * Create selected — never a write of its own. An import that asked for its
 * copy starts that job once.
 *
 * The grid is replaced by a plain table that draws the same columns, cells
 * and selection, because the data grid's virtualization draws nothing in
 * jsdom.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: (hostId: string | undefined) => (hostId ? 'org-1' : null),
}))

jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => ({
  ListTable: ({
    rows,
    columns,
    selectable,
  }: {
    rows: Array<Record<string, unknown> & { $id: string }>
    columns: Array<{ field: string; renderCell?: (params: { row: unknown }) => ReactNode }>
    selectable?: { selected: string[]; onChange: (ids: string[]) => void }
  }) => (
    <table>
      <tbody>
        {rows.map((row) => (
          <tr key={row.$id}>
            {selectable ? (
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select ${String(row['name'])}`}
                  checked={selectable.selected.includes(row.$id)}
                  onChange={(event) =>
                    selectable.onChange(
                      event.target.checked
                        ? [...selectable.selected, row.$id]
                        : selectable.selected.filter((id) => id !== row.$id),
                    )
                  }
                />
              </td>
            ) : null}
            {columns.map((column) => (
              <td key={column.field}>{column.renderCell ? column.renderCell({ row }) : String(row[column.field] ?? '')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}))

import type { ConsoleProductsHubZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import AiProductsHubCard from './ai-products-hub-card.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const summary = (patch: Record<string, unknown>) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  kind: 'products',
  status: 'done',
  brief: 'A candle studio',
  batch: null,
  steps: [],
  outputs: [],
  creditsReserved: 0,
  creditsSpent: 4,
  createdBy: 'u1',
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:00:05.000Z',
  error: null,
  running: false,
  plan: null,
  review: null,
  ...patch,
})

const output = (id: string, proposal: Record<string, unknown>) => ({ resource: 'product', id, hostId: 'host-1', label: id, proposal })

const copyProposal = (id: string, name: string, patch: Record<string, unknown> = {}) => ({
  kind: 'copy',
  product: { id, name },
  values: {
    description: `${name}, described.`,
    seoTitle: name,
    seoDescription: `${name} for the home.`,
    tags: ['home'],
    categoryIds: [],
    optionNames: [],
  },
  categories: [],
  optionNamesBefore: [],
  gaps: [],
  photo: 'none',
  skipped: null,
  notes: [],
  ...patch,
})

const bulkJob = summary({
  id: 'job-bulk',
  brief: 'Write storefront copy for 3 products',
  outputs: [
    output('copy:lamp', copyProposal('lamp', 'Desk lamp')),
    output('copy:gone', copyProposal('gone', 'gone', { values: null, skipped: 'This product is no longer in the catalog.' })),
    output('copy:shade', copyProposal('shade', 'Linen shade')),
  ],
})

const CANDLE = {
  name: 'Wild mint soy candle',
  type: 'physical',
  description: 'A hand-poured soy candle.\n\nBurn time: [hours].',
  tags: ['candle'],
  options: [{ name: 'Size', values: ['8 oz', '16 oz'] }],
  seoTitle: 'Wild mint soy candle',
  seoDescription: 'A hand-poured soy candle scented with wild mint.',
  photo: 'The candle lit on a wooden table.',
}

const catalogJob = summary({
  id: 'job-catalog',
  outputs: [
    output('catalog', {
      kind: 'catalog',
      products: [CANDLE, { ...CANDLE, name: 'Desk lamp', photo: 'The lamp on a desk.' }],
      notes: [],
    }),
  ],
})

const categoriesJob = summary({
  id: 'job-categories',
  outputs: [
    output('categories', {
      kind: 'categories',
      categories: [
        { name: 'Candles', why: 'Most of the store is candles.' },
        { name: 'Wax melts', why: 'Melts are their own shelf.' },
      ],
      discounts: [
        { name: 'Welcome', code: 'WELCOME10', kind: 'percent', valuePct: 10, valueCents: null, minSubtotalCents: null, why: 'A first order.' },
        { name: 'Free shipping over $50', code: null, kind: 'free_shipping', valuePct: null, valueCents: null, minSubtotalCents: 5_000, why: 'Bigger baskets.' },
      ],
      notes: [],
    }),
  ],
})

let mockFetch: jest.Mock
const applyProductCopy = jest.fn()
const createProductDrafts = jest.fn()
const createCategories = jest.fn()
const createDiscountDrafts = jest.fn()

const PRODUCTS = [
  { id: 'lamp', name: 'Desk lamp', status: 'active' as const, priceMissing: false, hasPhoto: true },
  { id: 'shade', name: 'Linen shade', status: 'draft' as const, priceMissing: true, hasPhoto: false },
]

const props = (patch: Partial<ConsoleProductsHubZoneProps> = {}): ConsoleProductsHubZoneProps => ({
  hostId: 'host-1',
  orgId: undefined,
  products: PRODUCTS,
  lastImport: null,
  applyProductCopy,
  createProductDrafts,
  createCategories,
  createDiscountDrafts,
  ...patch,
})

/** The request bodies the card posted to the jobs route. */
const posted = () =>
  mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body))

beforeEach(() => {
  jest.clearAllMocks()
  mockFetch = jest.fn(async (url: string) =>
    // A started job is followed; the double ends each watch at once.
    String(url).includes('/events') ? { ok: false, status: 404, body: null, json: async () => null } : json({ jobs: [] }),
  )
  global.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  // Every write is the hub's; the card reaches no route but the jobs route.
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/jobs/)
})

describe('whether the card is here', () => {
  it('stays absent while the route says the feature does not exist', async () => {
    mockFetch.mockImplementation(async () => json({ error: 'Not found' }, 404))
    const { container } = render(<AiProductsHubCard {...props()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})

describe('copy for many products', () => {
  it('starts one job for the products picked, with the ids its step reads', async () => {
    render(<AiProductsHubCard {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Write copy for products' }))
    fireEvent.click(screen.getByLabelText('Select Desk lamp'))
    fireEvent.click(screen.getByLabelText('Select Linen shade'))
    mockFetch.mockImplementationOnce(async () => json({ job: summary({ id: 'job-new', status: 'queued', brief: 'Write storefront copy for 2 products' }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Write copy for 2' }))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'products',
      brief: 'Write storefront copy for 2 products',
      inputs: { target: 'bulk', productIds: 'lamp,shade' },
    })
    expect(await screen.findByText('Writing copy: 0 of 2')).toBeTruthy()
  })

  it('applies one row, then every row still waiting, and never a skipped one', async () => {
    mockFetch.mockImplementation(async () => json({ jobs: [bulkJob] }))
    applyProductCopy.mockResolvedValue(undefined)
    render(<AiProductsHubCard {...props()} />)
    expect(await screen.findByText('Product copy · 3 of 3')).toBeTruthy()
    expect(screen.getByText('Skipped')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0])
    await waitFor(() => expect(applyProductCopy).toHaveBeenCalledTimes(1))
    expect(applyProductCopy).toHaveBeenCalledWith('lamp', {
      description: 'Desk lamp, described.',
      tags: ['home'],
      categoryIds: [],
      seoTitle: 'Desk lamp',
      seoDescription: 'Desk lamp for the home.',
    })
    await screen.findByText('Applied')

    fireEvent.click(screen.getByRole('button', { name: 'Apply to all 1' }))
    await waitFor(() => expect(applyProductCopy).toHaveBeenCalledTimes(2))
    expect(applyProductCopy.mock.calls[1][0]).toBe('shade')
    await waitFor(() => expect(screen.getAllByText('Applied')).toHaveLength(2))
  })

  it('names a row the hub refused, and still applies the rest', async () => {
    mockFetch.mockImplementation(async () => json({ jobs: [bulkJob] }))
    applyProductCopy.mockRejectedValueOnce(new Error('This product is no longer in the catalog.')).mockResolvedValueOnce(undefined)
    render(<AiProductsHubCard {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to all 2' }))
    await waitFor(() => expect(applyProductCopy).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Not saved')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('This product is no longer in the catalog.')
    expect(screen.getByText('Applied')).toBeTruthy()
  })

  it('starts one copy job for what an import created when the import asked for it, and only once', async () => {
    const { rerender } = render(<AiProductsHubCard {...props()} />)
    await screen.findByRole('button', { name: 'Write copy for products' })
    const imported = { key: 'import-1', productIds: ['p1', 'p2', 'p3'], options: { 'ai.writeCopy': true } }
    mockFetch.mockImplementationOnce(async () => json({ job: summary({ id: 'job-import', status: 'queued', brief: 'Write storefront copy for 3 products' }) }))
    rerender(<AiProductsHubCard {...props({ lastImport: imported })} />)
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0].inputs).toEqual({ target: 'bulk', productIds: 'p1,p2,p3' })
    rerender(<AiProductsHubCard {...props({ lastImport: { ...imported } })} />)
    rerender(<AiProductsHubCard {...props({ lastImport: { key: 'import-2', productIds: ['p4'], options: {} } })} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(posted()).toHaveLength(1)
  })
})

describe('a first catalog from a brief', () => {
  it('starts a catalog job with the brief, and creates the drafts picked, leaving out what the catalog has', async () => {
    render(<AiProductsHubCard {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Propose products' }))
    fireEvent.change(screen.getByLabelText('What does the store sell?'), { target: { value: 'A candle studio' } })
    mockFetch.mockImplementationOnce(async () => json({ job: catalogJob }))
    fireEvent.click(screen.getByRole('button', { name: 'Propose products' }))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]).toMatchObject({ kind: 'products', brief: 'A candle studio', inputs: { target: 'catalog' } })
    // The brief dialog closes once the job exists, and the card behind it is reachable again.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(await screen.findByText('In your catalog')).toBeTruthy()
    expect(screen.getAllByText('Set a price')).toHaveLength(2)
    expect(screen.getAllByText('Needs a photo')).toHaveLength(2)
    expect(screen.getByText('The candle lit on a wooden table.')).toBeTruthy()
    expect((screen.getByLabelText('Select Desk lamp') as HTMLInputElement).checked).toBe(false)

    createProductDrafts.mockResolvedValueOnce(['p-new'])
    fireEvent.click(screen.getByRole('button', { name: 'Create 1 draft' }))
    await waitFor(() => expect(createProductDrafts).toHaveBeenCalledTimes(1))
    expect(createProductDrafts).toHaveBeenCalledWith([
      {
        name: 'Wild mint soy candle',
        type: 'physical',
        description: 'A hand-poured soy candle.\n\nBurn time: [hours].',
        tags: ['candle'],
        options: [{ name: 'Size', values: ['8 oz', '16 oz'] }],
        seoTitle: 'Wild mint soy candle',
        seoDescription: 'A hand-poured soy candle scented with wild mint.',
      },
    ])
    expect(
      await screen.findByText('Created 1 draft product. Each needs a price and a photo before you activate it.'),
    ).toBeTruthy()
  })
})

describe('categories and discounts from a brief', () => {
  it('creates the categories and switched-off discounts picked, through the hub', async () => {
    mockFetch.mockImplementation(async () => json({ jobs: [categoriesJob] }))
    createCategories.mockResolvedValueOnce(1)
    createDiscountDrafts.mockResolvedValueOnce(2)
    render(<AiProductsHubCard {...props()} />)
    expect(await screen.findByText('10% off')).toBeTruthy()
    expect(screen.getByText('Applies on its own')).toBeTruthy()
    expect(screen.getByText('$50.00')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Select Wax melts'))
    fireEvent.click(screen.getByRole('button', { name: 'Create selected' }))
    await waitFor(() => expect(createDiscountDrafts).toHaveBeenCalledTimes(1))
    expect(createCategories).toHaveBeenCalledWith(['Candles'])
    expect(createDiscountDrafts).toHaveBeenCalledWith([
      { name: 'Welcome', code: 'WELCOME10', kind: 'percent', valuePct: 10, valueCents: null, minSubtotalCents: null },
      { name: 'Free shipping over $50', code: null, kind: 'free_shipping', valuePct: null, valueCents: null, minSubtotalCents: 5_000 },
    ])
    expect((await screen.findByRole('alert')).textContent).toContain('Discounts start switched off')
  })
})
