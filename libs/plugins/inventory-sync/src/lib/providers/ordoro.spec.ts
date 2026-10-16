/**
 * @jest-environment node
 */
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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { mockHttp, sentJson } from '../testing/mock-http'
import { ProviderError } from './http'
import { createOrdoroProvider, ordoroAuthorization, ORDORO_API_BASE } from './ordoro'
import type { InventoryCredential, SystemOrderRequest } from './provider'

/**
 * Every answer below is shaped like the OpenAPI document docs.ordoro.com
 * embeds: list endpoints answer `{ count, limit, offset, <model> }`, refusals
 * `{ error_message, param }`.
 */

const ORDORO: InventoryCredential = { provider: 'ordoro', clientId: 'client-1234', clientSecret: 'secret-5678' }

const ORDER: SystemOrderRequest = {
  reference: 'AG1042-3fa9c2d1',
  displayRef: '#1042',
  orderedAtMs: Date.UTC(2026, 9, 7),
  currency: 'USD',
  customer: 'Web Sales',
  locationId: '12',
  taxRule: '',
  buyerName: 'Ada Buyer',
  buyerEmail: 'ada@example.com',
  shippingAddress: {
    name: 'Ada Buyer',
    line1: '1 Main St',
    line2: null,
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    country: 'US',
    phone: '5125550100',
  },
  lines: [
    { sku: 'TEE-M', productId: '501', name: 'Tee — M', quantity: 2, unitAmountCents: 1999 },
    { sku: 'CAP', productId: '502', name: 'Cap', quantity: 1, unitAmountCents: 1500 },
  ],
  shippingCents: 500,
  discountCents: 250,
  taxCents: 330,
  totalCents: 6078,
}

const CARTS = {
  count: 2,
  limit: 100,
  offset: 0,
  cart: [
    { id: 3, index: 2, name: 'Shopify Store', vendor: 'shopify', archived_date: null },
    { id: 7, index: 3, name: 'Web Sales', vendor: 'custom_integration', archived_date: null },
  ],
}

const product = (id: number, sku: string, warehouses: Array<{ id: number; available: number; physical_on_hand: number }>) => ({
  id,
  sku,
  name: `Product ${sku}`,
  price: 19.99,
  upc: null,
  updated: '2026-10-07T12:00:00.000000-05:00',
  archive_date: null,
  warehouses,
})

describe('Ordoro (AGL-3823)', () => {
  const ordoro = (routes: Parameters<typeof mockHttp>[0]) => {
    const mock = mockHttp(routes)
    return { ...mock, provider: createOrdoroProvider({ http: mock.http }) }
  }

  it('calls api.ordoro.com with the API key’s client id and secret as basic credentials', async () => {
    const { provider, calls } = ordoro([{ method: 'GET', match: '/company/', body: { id: 9, name: 'Acme Goods' } }])
    await expect(provider.account(ORDORO)).resolves.toEqual({ accountName: 'Acme Goods' })
    expect(calls[0].url).toBe(`${ORDORO_API_BASE}company/`)
    expect(calls[0].headers['authorization']).toBe(`Basic ${Buffer.from('client-1234:secret-5678').toString('base64')}`)
    expect(ordoroAuthorization('a', 'b')).toBe('Basic YTpi')
  })

  it('reads a refused key as auth, and Ordoro’s error_message as a refusal’s words', async () => {
    const refused = ordoro([{ match: '/company/', status: 401, body: { error_message: 'Invalid credentials', param: null } }])
    await expect(refused.provider.account(ORDORO)).rejects.toMatchObject({ kind: 'auth' })
    const { provider } = ordoro([
      { method: 'GET', match: '/cart/', body: CARTS },
      { method: 'POST', match: '/v3/order', status: 400, body: { error_message: 'Order already exists', param: 'order_id' } },
    ])
    await expect(provider.createOrder(ORDORO, ORDER)).rejects.toMatchObject({ kind: 'invalid', message: 'Order already exists' })
  })

  it('lists warehouses by their name, else their address, across pages', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, warehouse_name: `W${index + 1}`, address: {} }))
    const { provider, calls } = ordoro([
      { method: 'GET', match: 'offset=0', body: { count: 101, limit: 100, offset: 0, warehouse: first } },
      {
        method: 'GET',
        match: 'offset=100',
        body: { count: 101, limit: 100, offset: 100, warehouse: [{ id: 101, warehouse_name: null, address: { company: 'Back Room', name: 'Ann' } }] },
      },
    ])
    const locations = await provider.locations(ORDORO)
    expect(locations).toHaveLength(101)
    expect(locations[0]).toEqual({ id: '1', name: 'W1' })
    expect(locations[100]).toEqual({ id: '101', name: 'Back Room' })
    expect(calls.map((call) => call.url.split('?')[0])).toEqual([`${ORDORO_API_BASE}warehouse/`, `${ORDORO_API_BASE}warehouse/`])
  })

  it('reads available and physical counts at the chosen warehouse, or summed across all', async () => {
    const page = {
      count: 2,
      limit: 100,
      offset: 0,
      products: [
        product(501, 'TEE-M', [
          { id: 12, available: 7, physical_on_hand: 9 },
          { id: 13, available: 3, physical_on_hand: 3 },
        ]),
        product(502, ' ', [{ id: 12, available: 1, physical_on_hand: 1 }]),
      ],
    }
    const { provider, calls } = ordoro([{ method: 'GET', match: '/product/', body: page }])
    await expect(provider.stock(ORDORO, { locationId: '12', max: 10 })).resolves.toEqual([
      { sku: 'TEE-M', productId: '501', available: 7, onHand: 9 },
    ])
    await expect(provider.stock(ORDORO, { locationId: null, max: 10 })).resolves.toEqual([
      { sku: 'TEE-M', productId: '501', available: 10, onHand: 12 },
    ])
    expect(calls[0].url).toContain('active=true')
    expect(calls[0].url).toContain('limit=100')
  })

  it('adjusts each SKU by the difference at the warehouse, never retried in the call', async () => {
    const { provider, calls } = ordoro([
      { method: 'PUT', match: '/product/TEE-M/warehouse/12/', body: {} },
      { method: 'PUT', match: '/product/CAP%2FRED/warehouse/12/', status: 502, body: {} },
    ])
    await expect(
      provider.adjustStock(ORDORO, {
        locationId: '12',
        reference: 'AGS-1',
        currency: 'USD',
        changes: [
          { sku: 'TEE-M', productId: '501', delta: -2, onHand: 9 },
          { sku: 'SAME', productId: '503', delta: 0, onHand: 4 },
          { sku: 'CAP/RED', productId: '502', delta: 5, onHand: 0 },
        ],
      }),
    ).rejects.toMatchObject({ kind: 'transient' })
    expect(calls.map((call) => `${call.method} ${call.url.replace(ORDORO_API_BASE, '')}`)).toEqual([
      'PUT product/TEE-M/warehouse/12/',
      'PUT product/CAP%2FRED/warehouse/12/',
    ])
    expect(sentJson(calls[0])).toEqual({ adjustment: -2 })
  })

  it('carries on past a SKU Ordoro refuses, then names it', async () => {
    const { provider, calls } = ordoro([
      { method: 'PUT', match: '/product/GONE/', status: 404, body: { error_message: 'Not found', param: null } },
      { method: 'PUT', match: '/product/TEE-M/', body: {} },
    ])
    await expect(
      provider.adjustStock(ORDORO, {
        locationId: '12',
        reference: 'AGS-1',
        currency: 'USD',
        changes: [
          { sku: 'GONE', productId: '9', delta: 1, onHand: 0 },
          { sku: 'TEE-M', productId: '501', delta: 1, onHand: 0 },
        ],
      }),
    ).rejects.toThrow('Ordoro would not adjust GONE')
    expect(calls).toHaveLength(2)
  })

  it('pages products changed since a time by offset, with prices in minor units', async () => {
    const list = Array.from({ length: 2 }, (_, index) => product(600 + index, `SKU-${index}`, []))
    const { provider, calls } = ordoro([{ method: 'GET', match: '/product/', body: { count: 5, limit: 2, offset: 2, products: list } }])
    const page = await provider.products(ORDORO, { sinceMs: Date.UTC(2026, 9, 1), cursor: '2', limit: 2, currency: 'USD' })
    expect(page.nextCursor).toBe('4')
    expect(page.products[0]).toEqual({
      id: '600',
      sku: 'SKU-0',
      name: 'Product SKU-0',
      description: '',
      priceMinor: 1999,
      weightGrams: null,
      barcode: null,
      version: '2026-10-07T12:00:00.000000-05:00',
      active: true,
    })
    const url = new URL(calls[0].url)
    expect(url.searchParams.get('offset')).toBe('2')
    expect(url.searchParams.get('updated_after')).toBe('2026-10-01T00:00:00.000Z')
  })

  it('ends the product pages at the last one', async () => {
    const { provider } = ordoro([{ method: 'GET', match: '/product/', body: { count: 1, limit: 10, offset: 0, products: [product(1, 'A', [])] } }])
    await expect(provider.products(ORDORO, { sinceMs: null, cursor: null, limit: 10, currency: 'USD' })).resolves.toMatchObject({
      nextCursor: null,
    })
  })

  it('looks SKUs up one at a time and reads a 404 as absent', async () => {
    const { provider } = ordoro([
      { method: 'GET', match: '/product/TEE-M/', body: product(501, 'TEE-M', []) },
      { method: 'GET', match: '/product/NOPE/', status: 404, body: { error_message: 'Not found', param: null } },
    ])
    const found = await provider.productIdsBySku(ORDORO, ['TEE-M', 'NOPE'])
    expect([...found]).toEqual([['TEE-M', '501']])
  })

  it('makes a product once, with its price in major units and its barcode as the UPC', async () => {
    const { provider, calls } = ordoro([{ method: 'POST', match: '/product/', status: 201, body: { id: 777, sku: 'NEW' } }])
    await expect(
      provider.createProduct(ORDORO, {
        sku: 'NEW',
        name: 'New thing',
        description: 'Ignored',
        priceMinor: 2500,
        currency: 'USD',
        weightGrams: 300,
        barcode: '012345678905',
      }),
    ).resolves.toEqual({ id: '777' })
    expect(sentJson(calls[0])).toEqual({ sku: 'NEW', name: 'New thing', price: 25, upc: '012345678905' })
  })

  it('finds the sales channel orders are recorded under by its exact name', async () => {
    const { provider, calls } = ordoro([{ method: 'GET', match: '/cart/', body: CARTS }])
    await expect(provider.customerExists(ORDORO, 'web sales')).resolves.toBe(true)
    await expect(provider.customerExists(ORDORO, 'Web')).resolves.toBe(false)
    expect(new URL(calls[0].url).searchParams.get('search')).toBe('web sales')
  })

  it('records an order under the channel with our reference as its order id and cart order id', async () => {
    const { provider, calls } = ordoro([
      { method: 'GET', match: '/cart/', body: CARTS },
      { method: 'POST', match: /\/v3\/order$/, status: 201, body: { id: 88, order_number: '3-AG1042-3fa9c2d1', status: 'awaiting_fulfillment' } },
    ])
    await expect(provider.createOrder(ORDORO, ORDER)).resolves.toEqual({ id: '3-AG1042-3fa9c2d1', number: '3-AG1042-3fa9c2d1' })
    const post = calls[1]
    expect(post.url).toBe(`${ORDORO_API_BASE}v3/order`)
    const body = sentJson(post)
    expect(body).toMatchObject({
      order_id: 'AG1042-3fa9c2d1',
      cart: 7,
      cart_order_id: 'AG1042-3fa9c2d1',
      order_date: '2026-10-07T00:00:00.000Z',
      warehouse_id: 12,
      product_amount: 54.98,
      shipping_amount: 5,
      discount_amount: 2.5,
      tax_amount: 3.3,
      grand_total: 60.78,
    })
    expect(body.shipping_address).toEqual({
      name: 'Ada Buyer',
      street1: '1 Main St',
      street2: null,
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      country: 'US',
      phone: '5125550100',
      email: 'ada@example.com',
    })
    expect(body.billing_address).toEqual(body.shipping_address)
    expect(body.internal_notes).toBe(`${PLATFORM_BRAND_NAME} order #1042 (AG1042-3fa9c2d1). Amounts in USD.`)
    expect(body.lines).toEqual([
      { cart_orderitem_id: 'AG1042-3fa9c2d1-1', quantity: 2, item_price: 19.99, total_price: 39.98, product: { sku: 'TEE-M', name: 'Tee — M' } },
      { cart_orderitem_id: 'AG1042-3fa9c2d1-2', quantity: 1, item_price: 15, total_price: 15, product: { sku: 'CAP', name: 'Cap' } },
    ])
    // Never retried in the call: a timeout after Ordoro accepted it would send it twice.
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('refuses an order whose sales channel does not exist, with a sentence to fix it', async () => {
    const { provider, calls } = ordoro([{ method: 'GET', match: '/cart/', body: { count: 0, limit: 100, offset: 0, cart: [] } }])
    await expect(provider.createOrder(ORDORO, ORDER)).rejects.toMatchObject({ kind: 'invalid' })
    await expect(provider.createOrder(ORDORO, ORDER)).rejects.toThrow('no sales channel named “Web Sales”')
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('finds an order sent earlier by its cart order id, and none when Ordoro has none', async () => {
    const found = ordoro([
      {
        method: 'GET',
        match: '/v3/order?',
        body: { count: 1, limit: 10, offset: 0, order: [{ order_number: '3-AG1042-3fa9c2d1', lines: [] }] },
      },
    ])
    await expect(found.provider.findOrder(ORDORO, 'AG1042-3fa9c2d1')).resolves.toEqual({
      id: '3-AG1042-3fa9c2d1',
      number: '3-AG1042-3fa9c2d1',
    })
    const url = new URL(found.calls[0].url)
    expect(url.pathname).toBe('/v3/order')
    expect(url.searchParams.get('cart_order_id')).toBe('AG1042-3fa9c2d1')
    expect(url.searchParams.get('status')).toBe('all')

    const none = ordoro([
      { method: 'GET', match: '/v3/order?', body: { count: 1, limit: 10, offset: 0, order: [{ order_number: '3-AG9-other', lines: [] }] } },
    ])
    await expect(none.provider.findOrder(ORDORO, 'AG1042-3fa9c2d1')).resolves.toBeNull()
  })

  it('cancels an order by its number, and reads a refusal as too late', async () => {
    const ok = ordoro([{ method: 'POST', match: '/v3/order/3-AG1042-3fa9c2d1/cancel', body: { order_number: '3-AG1042-3fa9c2d1', status: 'cancelled' } }])
    await expect(
      ok.provider.cancelOrder(ORDORO, { id: '3-AG1042-3fa9c2d1', number: '3-AG1042-3fa9c2d1', reference: 'AG1042-3fa9c2d1' }),
    ).resolves.toBe('canceled')
    expect(ok.calls[0].url).toBe(`${ORDORO_API_BASE}v3/order/3-AG1042-3fa9c2d1/cancel`)

    const late = ordoro([{ method: 'POST', match: '/cancel', status: 400, body: { error_message: 'Order has shipped', param: null } }])
    await expect(late.provider.cancelOrder(ORDORO, { id: '3-X', number: '3-X', reference: 'X' })).resolves.toBe('too_late')
  })

  it('refuses a credential for another system', async () => {
    const { provider } = ordoro([])
    await expect(provider.account({ provider: 'inflow', companyId: 'c', apiKey: 'k' })).rejects.toBeInstanceOf(ProviderError)
  })
})
