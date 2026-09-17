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
 * The products hub's zone (AGL-2916): what a widget there is handed, and the
 * writes it may ask the hub for, each driven through the props the shell's
 * renderer receives.
 */

import { render } from '@testing-library/react'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type { ConsoleProductsHubZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useHostResourceApi: () => mockCreate,
}))

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  limit: (count: number) => ({ limit: count }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  getDocs: async (read: { path: string; constraints: Array<{ field?: string; value?: unknown }> }) => {
    mockReads.push(read)
    const clause = read.constraints.find((constraint) => constraint.field)
    const docs = (mockExisting[read.path] ?? [])
      .filter((data) => !clause || (clause.value as unknown[]).includes(data[clause.field as string]))
      .map((data) => ({ get: (field: string) => data[field] }))
    return { docs }
  },
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  runTransaction: (_db: unknown, update: (transaction: unknown) => Promise<unknown>) =>
    update({
      get: async (ref: { path: string }) => {
        const data = mockStored.get(ref.path)
        return { exists: () => data !== undefined, data: () => data }
      },
      update: (ref: { path: string }, patch: Record<string, unknown>) => mockUpdates.push([ref.path, patch]),
    }),
}))

jest.mock('@aglyn/aglyn/app-utils/create-resource-uid', () => ({
  createResourceUid: () => `uid-${++mockUid}`,
}))

import ProductsHubZone, { PLAN_LOADING_COPY, PRODUCT_GONE_COPY } from './products-hub-zone.component'

/** One double of each for every render, so nothing keys an effect on a fresh object. */
const mockFirestore = {}
const mockCreate = jest.fn()
const mockSetDoc = jest.fn()
const mockStored = new Map<string, Record<string, unknown>>()
const mockUpdates: Array<[string, Record<string, unknown>]> = []
/** What the site already holds, by collection path, and every read of it. */
const mockExisting: Record<string, Array<Record<string, unknown>>> = {}
const mockReads: unknown[] = []
let mockUid = 0

let zone: (ConsoleProductsHubZoneProps & { slot: string }) | null = null
function ShellSlot(props: ConsoleProductsHubZoneProps & { slot: string }) {
  zone = props
  return null
}

const ROWS = [
  {
    $id: 'lamp',
    name: 'Desk lamp',
    slug: 'desk-lamp',
    type: 'physical',
    status: 'active',
    mediaUrls: ['media:host-1/lamp'],
    options: [{ name: 'finish', values: ['Brass'] }],
    variants: [{ id: 'v1', options: { finish: 'Brass' }, priceUsd: 40, inventory: 3 }],
  },
  {
    $id: 'candle',
    name: 'Wild mint soy candle',
    slug: 'wild-mint-soy-candle',
    type: 'physical',
    status: 'draft',
    variants: [{ id: 'default' }],
  },
] as never[]

const ROOM = { allowed: true, limit: 100 }
const LAST_IMPORT = { key: 'k1', productIds: ['lamp'], options: { 'ai.writeCopy': true } }

function renderZone(overrides: Record<string, unknown> = {}) {
  const onCreated = jest.fn()
  const roomFor = jest.fn(() => ROOM as { allowed: boolean; limit: number } | null)
  render(
    <ConsoleWidgetSlotContext.Provider value={ShellSlot as never}>
      <ProductsHubZone
        hostId="host-1"
        products={ROWS}
        roomFor={roomFor}
        lastImport={LAST_IMPORT}
        onCreated={onCreated}
        {...overrides}
      />
    </ConsoleWidgetSlotContext.Provider>,
  )
  return { onCreated, roomFor, props: zone as ConsoleProductsHubZoneProps & { slot: string } }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStored.clear()
  mockUpdates.length = 0
  mockReads.length = 0
  for (const key of Object.keys(mockExisting)) delete mockExisting[key]
  mockUid = 0
  zone = null
})

describe('what the products hub hands its zone (AGL-2916)', () => {
  it('names the zone, the catalog rows with what each still needs, and the last import, reading nothing', () => {
    const { props } = renderZone()
    expect(mockReads).toEqual([])
    expect(props).toMatchObject({
      slot: 'productsHub',
      hostId: 'host-1',
      lastImport: LAST_IMPORT,
      products: [
        { id: 'lamp', name: 'Desk lamp', status: 'active', priceMissing: false, hasPhoto: true },
        { id: 'candle', name: 'Wild mint soy candle', status: 'draft', priceMissing: true, hasPhoto: false },
      ],
    })
  })

  it('renders nothing outside the console shell', () => {
    const { container } = render(
      <ProductsHubZone hostId="host-1" products={ROWS} roomFor={() => ROOM} lastImport={null} onCreated={jest.fn()} />,
    )
    expect(container.textContent).toBe('')
    expect(zone).toBeNull()
  })
})

describe('copy onto a saved product', () => {
  it('writes only the copy onto the product as the store holds it now, renaming options with every variant kept', async () => {
    mockStored.set('hosts/host-1/products/lamp', {
      name: 'Desk lamp',
      status: 'active',
      type: 'physical',
      options: [{ name: 'finish', values: ['Brass'] }],
      // A sale since the table loaded: the store holds 2, the row said 3.
      variants: [{ id: 'v1', options: { finish: 'Brass' }, priceUsd: 40, inventory: 2 }],
      seo: { imageUrl: 'media:host-1/share' },
    })
    const { props } = renderZone()
    await props.applyProductCopy('lamp', { description: 'A brass lamp.', optionNames: ['Finish'], seoTitle: 'Brass lamp' })
    expect(mockUpdates).toHaveLength(1)
    const [path, patch] = mockUpdates[0]
    expect(path).toBe('hosts/host-1/products/lamp')
    expect(patch).toMatchObject({
      description: 'A brass lamp.',
      seo: { imageUrl: 'media:host-1/share', title: 'Brass lamp' },
      options: [{ name: 'Finish', values: ['Brass'] }],
      variants: [{ id: 'v1', options: { Finish: 'Brass' }, priceUsd: 40, inventory: 2 }],
    })
    expect(Object.keys(patch).sort()).toEqual(['description', 'options', 'seo', 'updatedAt', 'updatedAtMs', 'variants'])
  })

  it('refuses a product that is gone, in words a person can act on', async () => {
    mockStored.set('hosts/host-1/products/lamp', { name: 'Desk lamp', deletedAt: 1, variants: [] })
    const { props } = renderZone()
    await expect(props.applyProductCopy('lamp', { description: 'x' })).rejects.toThrow(PRODUCT_GONE_COPY)
    await expect(props.applyProductCopy('missing', { description: 'x' })).rejects.toThrow(PRODUCT_GONE_COPY)
    expect(mockUpdates).toEqual([])
  })
})

describe('proposed products, categories and discounts', () => {
  const PROPOSAL = {
    name: 'Cedar soy candle',
    type: 'physical' as const,
    description: 'A hand-poured candle.',
    tags: ['candle'],
    options: [],
    seoTitle: '',
    seoDescription: '',
  }

  it('creates each product as an unpriced draft through the resources API, under a slug of its own', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'p-new-1' }).mockResolvedValueOnce({ id: 'p-new-2' })
    const { props, onCreated, roomFor } = renderZone()
    // Names of their own, whose slugs the hub's candle already has.
    const ids = await props.createProductDrafts([
      { ...PROPOSAL, name: 'Wild-mint soy candle' },
      { ...PROPOSAL, name: 'Wild mint soy candle!' },
    ])
    expect(ids).toEqual(['p-new-1', 'p-new-2'])
    expect(roomFor).toHaveBeenCalledWith(2)
    expect(onCreated).toHaveBeenCalledTimes(1)
    const created = mockCreate.mock.calls.map(([call]) => call)
    expect(created.map((call) => [call.hostId, call.resource, call.data.slug, call.data.status])).toEqual([
      ['host-1', 'product', 'wild-mint-soy-candle-2', 'draft'],
      ['host-1', 'product', 'wild-mint-soy-candle-3', 'draft'],
    ])
    expect(created.every((call) => call.data.variants.every((variant: object) => !('priceUsd' in variant)))).toBe(true)
  })

  it('passes over a proposal named like a product the hub holds, asking the allowance only for the rest', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'p-new-1' })
    const { props, roomFor } = renderZone()
    const ids = await props.createProductDrafts([
      { ...PROPOSAL, name: ' desk  LAMP ' },
      { ...PROPOSAL, name: 'Linen shade' },
      { ...PROPOSAL, name: 'Linen Shade' },
    ])
    expect(ids).toEqual(['p-new-1'])
    expect(roomFor).toHaveBeenCalledWith(1)
    expect(mockCreate.mock.calls.map(([call]) => call.data.name)).toEqual(['Linen shade'])
    expect(await props.createProductDrafts([{ ...PROPOSAL, name: 'Desk lamp' }])).toEqual([])
  })

  it('creates nothing past the plan’s allowance, or before the plan has loaded', async () => {
    const full = renderZone({ roomFor: () => ({ allowed: false, limit: 25 }) }).props
    await expect(full.createProductDrafts([PROPOSAL])).rejects.toThrow(
      'These products need 1 product slots — your plan allows 25. See Billing to upgrade.',
    )
    const loading = renderZone({ roomFor: () => null }).props
    await expect(loading.createProductDrafts([PROPOSAL])).rejects.toThrow(PLAN_LOADING_COPY)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('still counts the products created before a refusal part way through', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'p-new-1' }).mockRejectedValueOnce(new Error('Your plan includes 25 products'))
    const { props, onCreated } = renderZone()
    await expect(props.createProductDrafts([PROPOSAL, { ...PROPOSAL, name: 'Other' }])).rejects.toThrow('Your plan includes 25 products')
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('creates categories by name, and discounts switched off, skipping one no discount can be made from', async () => {
    const { props } = renderZone()
    expect(await props.createCategories(['Candles', '  ', 'Gift sets', 'candles'])).toBe(2)
    expect(
      await props.createDiscountDrafts([
        { name: 'Welcome', code: 'welcome10', kind: 'percent', valuePct: 10, valueCents: null, minSubtotalCents: null },
        { name: 'Too much', code: null, kind: 'percent', valuePct: 0, valueCents: null, minSubtotalCents: null },
      ]),
    ).toBe(1)
    expect(mockSetDoc.mock.calls.map(([ref, data]) => [ref.path, data])).toEqual([
      ['hosts/host-1/productCategories/uid-1', expect.objectContaining({ name: 'Candles', slug: 'candles', parentId: null })],
      ['hosts/host-1/productCategories/uid-2', expect.objectContaining({ name: 'Gift sets', slug: 'gift-sets', parentId: null })],
      [
        'hosts/host-1/discounts/uid-3',
        { name: 'Welcome', code: 'WELCOME10', kind: 'percent', valuePct: 10, enabled: false, redemptions: 0 },
      ],
    ])
  })

  it('creates no category or discount the site already has, so applying twice creates nothing twice', async () => {
    mockExisting['hosts/host-1/productCategories'] = [{ name: 'Candles' }]
    mockExisting['hosts/host-1/discounts'] = [
      { name: 'Welcome', code: 'WELCOME10' },
      { name: 'Summer sale', code: null },
    ]
    const { props } = renderZone()
    expect(await props.createCategories([' CANDLES', 'Gift sets'])).toBe(1)
    expect(
      await props.createDiscountDrafts([
        { name: 'Welcome back', code: 'welcome10', kind: 'percent', valuePct: 10, valueCents: null, minSubtotalCents: null },
        { name: 'Summer sale', code: null, kind: 'free_shipping', valuePct: null, valueCents: null, minSubtotalCents: null },
        { name: 'Free shipping over $50', code: null, kind: 'free_shipping', valuePct: null, valueCents: null, minSubtotalCents: 5_000 },
      ]),
    ).toBe(1)
    expect(mockSetDoc.mock.calls.map(([ref, data]) => [ref.path, data.name])).toEqual([
      ['hosts/host-1/productCategories/uid-1', 'Gift sets'],
      ['hosts/host-1/discounts/uid-2', 'Free shipping over $50'],
    ])
  })
})
