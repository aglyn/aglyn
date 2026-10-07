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

import type { ProviderFetch } from './http'
import { createPrintfulProvider, PRINTFUL_WEBHOOK_TYPES } from './printful'
import { createPrintifyProvider, printifyStatus, PRINTIFY_WEBHOOK_TOPICS } from './printify'

/**
 * Every call each adapter makes, against a recorded service (AGL-3641): the
 * method, the path, the headers that authenticate it and the body it sends,
 * and how each answer — refusals included — reads in the store's words.
 */

interface Call {
  method: string
  url: string
  path: string
  search: string
  headers: Record<string, string>
  body: any
}

let calls: Call[] = []
let reply: (call: Call) => { status: number; body?: unknown }

const recorded: ProviderFetch = async (url, init = {}) => {
  const parsed = new URL(String(url))
  const call: Call = {
    method: String(init.method ?? 'GET'),
    url: String(url),
    path: parsed.pathname,
    search: parsed.search,
    headers: (init.headers ?? {}) as Record<string, string>,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  }
  calls.push(call)
  const answer = reply(call)
  return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), { status: answer.status })
}

beforeEach(() => {
  calls = []
  reply = () => ({ status: 500 })
})

const CREDENTIALS = { token: 'pf-token', storeId: '42' }

describe('Printful', () => {
  const printful = createPrintfulProvider(recorded)

  it('lists the stores a token reaches, authenticated by the token alone', async () => {
    reply = () => ({ status: 200, body: { code: 200, result: [{ id: 42, name: 'Ocean Goods', currency: 'usd' }] } })
    expect(await printful.listStores('pf-token')).toEqual([{ id: '42', name: 'Ocean Goods', currency: 'USD' }])
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/stores' })
    expect(calls[0].headers['Authorization']).toBe('Bearer pf-token')
    expect(calls[0].headers['X-PF-Store-Id']).toBeUndefined()
  })

  it('says a refused token in words, never repeating it', async () => {
    reply = () => ({ status: 401, body: { code: 401, result: 'Malformed token', error: { reason: 'Unauthorized', message: 'Malformed token' } } })
    const error = await printful.listStores('pf-token').catch((caught) => caught)
    expect(error.message).toBe('Printful refused the token. Make a new private token and connect again.')
    expect(error.unauthorized).toBe(true)
    expect(error.transient).toBe(false)
    expect(error.message).not.toContain('pf-token')
  })

  it('pages the store’s products, leaving out the ignored ones', async () => {
    reply = () => ({
      status: 200,
      body: {
        code: 200,
        result: [
          { id: 501, name: 'Ocean Tee', variants: 3, thumbnail_url: 'https://files.cdn.printful.com/t.png' },
          { id: 502, name: 'Hidden', variants: 1, is_ignored: true },
        ],
        paging: { total: 150, offset: 0, limit: 100 },
      },
    })
    const page = await printful.listProducts(CREDENTIALS, null)
    expect(calls[0]).toMatchObject({ path: '/store/products', search: '?offset=0&limit=100' })
    expect(calls[0].headers['X-PF-Store-Id']).toBe('42')
    expect(page).toEqual({
      products: [{ id: '501', name: 'Ocean Tee', thumbnailUrl: 'https://files.cdn.printful.com/t.png', variantCount: 3 }],
      nextCursor: '2',
      total: 150,
    })
  })

  it('reads a product with its variants, options, prices and each catalog variant’s cost', async () => {
    reply = (call) => {
      if (call.path === '/store/products/501') {
        return {
          status: 200,
          body: {
            code: 200,
            result: {
              sync_product: { id: 501, name: 'Ocean Tee', thumbnail_url: 'https://files.cdn.printful.com/t.png' },
              sync_variants: [
                {
                  id: 9001,
                  name: 'Ocean Tee / Black / S',
                  variant_id: 4011,
                  retail_price: '24.99',
                  currency: 'USD',
                  sku: 'TEE-BK-S',
                  color: 'Black',
                  size: 'S',
                  availability_status: 'active',
                  files: [{ type: 'preview', preview_url: 'https://files.cdn.printful.com/bk.png' }],
                },
                {
                  id: 9002,
                  name: 'Ocean Tee / Black / M',
                  variant_id: 4012,
                  retail_price: '24.99',
                  currency: 'USD',
                  color: 'Black',
                  size: 'M',
                  availability_status: 'temporary_out_of_stock',
                  files: [],
                },
                { id: 9003, name: 'Ignored', variant_id: 4013, retail_price: '1', is_ignored: true },
              ],
            },
          },
        }
      }
      if (call.path === '/products/variant/4011') {
        return { status: 200, body: { result: { variant: { price: '12.95' }, product: { description: 'Soft ring-spun cotton.' } } } }
      }
      if (call.path === '/products/variant/4012') return { status: 404, body: { result: 'Not found' } }
      return { status: 500 }
    }
    const product = await printful.getProduct(CREDENTIALS, '501')
    expect(calls.map((call) => call.path).sort()).toEqual(['/products/variant/4011', '/products/variant/4012', '/store/products/501'])
    expect(product).toEqual({
      id: '501',
      name: 'Ocean Tee',
      description: 'Soft ring-spun cotton.',
      tags: [],
      currency: 'USD',
      imageUrls: ['https://files.cdn.printful.com/t.png', 'https://files.cdn.printful.com/bk.png'],
      options: [
        { name: 'Color', values: ['Black'] },
        { name: 'Size', values: ['S', 'M'] },
      ],
      variants: [
        {
          id: '9001',
          name: 'Ocean Tee / Black / S',
          sku: 'TEE-BK-S',
          options: { Color: 'Black', Size: 'S' },
          retailMinor: 2499,
          costMinor: 1295,
          available: true,
          imageUrl: 'https://files.cdn.printful.com/bk.png',
          weightGrams: null,
        },
        {
          id: '9002',
          name: 'Ocean Tee / Black / M',
          sku: null,
          options: { Color: 'Black', Size: 'M' },
          retailMinor: 2499,
          costMinor: null,
          available: false,
          imageUrl: null,
          weightGrams: null,
        },
      ],
    })
  })

  it('names each variant as one option when color and size do not tell them apart', async () => {
    reply = (call) =>
      call.path === '/store/products/7'
        ? {
            status: 200,
            body: {
              result: {
                sync_product: { id: 7, name: 'Poster' },
                sync_variants: [
                  { id: 1, name: 'Poster / 12×18', variant_id: 1, retail_price: '20.00', currency: 'USD' },
                  { id: 2, name: 'Poster / 18×24', variant_id: 2, retail_price: '30.00', currency: 'USD' },
                ],
              },
            },
          }
        : { status: 404 }
    const product = await printful.getProduct(CREDENTIALS, '7')
    expect(product.options).toEqual([{ name: 'Style', values: ['12×18', '18×24'] }])
    expect(product.variants.map((variant) => variant.options)).toEqual([{ Style: '12×18' }, { Style: '18×24' }])
  })

  const ORDER = {
    id: 77,
    external_id: 'ag123',
    status: 'partial',
    dashboard_url: 'https://www.printful.com/dashboard?order_id=77',
    items: [
      { id: 1001, external_id: '0', sync_variant_id: 9001, quantity: 2 },
      { id: 1002, external_id: '2', sync_variant_id: 9002, quantity: 1 },
    ],
    costs: { currency: 'USD', subtotal: '25.90', discount: '0.00', shipping: '4.99', tax: '1.10', vat: '0.00', total: '31.99' },
    shipments: [
      {
        id: 555,
        carrier: 'USPS',
        service: 'First Class',
        tracking_number: '9400111',
        tracking_url: 'https://tools.usps.com/x',
        shipped_at: 1_700_000_000,
        items: [{ item_id: 1001, quantity: 2 }],
      },
      { id: 556, carrier: 'USPS', tracking_number: '' },
    ],
  }

  it('finds an order by the store’s key, and answers null when there is none', async () => {
    reply = (call) => (call.path === '/orders/@ag123' ? { status: 200, body: { result: ORDER } } : { status: 404, body: { result: 'Not found' } })
    const found = await printful.findOrder(CREDENTIALS, 'ag123')
    expect(found).toEqual({
      id: '77',
      externalId: 'ag123',
      status: 'partially_shipped',
      rawStatus: 'partial',
      costs: { currency: 'USD', itemsMinor: 2590, shippingMinor: 499, taxMinor: 110, totalMinor: 3199 },
      shipments: [
        {
          id: '555',
          carrier: 'USPS',
          service: 'First Class',
          trackingNumber: '9400111',
          trackingUrl: 'https://tools.usps.com/x',
          lines: [{ lineIndex: 0, quantity: 2 }],
          shippedAtMs: 1_700_000_000_000,
          deliveredAtMs: null,
        },
      ],
      fulfilledVariantIds: [],
      dashboardUrl: 'https://www.printful.com/dashboard?order_id=77',
    })
    expect(await printful.findOrder(CREDENTIALS, 'nope')).toBeNull()
  })

  it('creates an order with the recipient, each line keyed by its index, confirmed or as a draft', async () => {
    reply = () => ({ status: 200, body: { result: { ...ORDER, status: 'pending', shipments: [] } } })
    const order = await printful.createOrder(CREDENTIALS, {
      externalId: 'ag123',
      label: '#1042',
      recipient: { name: 'Ada Lovelace', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', email: 'ada@example.com' },
      lines: [{ lineIndex: 0, sourceProductId: '501', sourceVariantId: '9001', quantity: 2, retailMinor: 2499, name: 'Ocean Tee — Black / S' }],
      retailCurrency: 'USD',
      confirm: true,
    })
    expect(order.status).toBe('submitted')
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/orders', search: '?confirm=true' })
    expect(calls[0].body).toEqual({
      external_id: 'ag123',
      shipping: 'STANDARD',
      recipient: {
        name: 'Ada Lovelace',
        address1: '1 Main St',
        city: 'Austin',
        state_code: 'TX',
        country_code: 'US',
        zip: '78701',
        email: 'ada@example.com',
      },
      items: [{ external_id: '0', sync_variant_id: 9001, quantity: 2, retail_price: '24.99', name: 'Ocean Tee — Black / S' }],
    })
    await printful.createOrder(CREDENTIALS, {
      externalId: 'ag124',
      label: '#1043',
      recipient: { name: 'A', line1: '1', city: 'B', postalCode: '1', country: 'GB' },
      lines: [],
      retailCurrency: 'GBP',
      confirm: false,
    })
    expect(calls[1].search).toBe('?confirm=false')
  })

  it('confirms, reads and cancels an order by its id', async () => {
    reply = () => ({ status: 200, body: { result: { ...ORDER, status: 'draft', shipments: [] } } })
    expect((await printful.confirmOrder(CREDENTIALS, '77')).status).toBe('draft')
    await printful.getOrder(CREDENTIALS, '77')
    await printful.cancelOrder(CREDENTIALS, '77')
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /orders/77/confirm', 'GET /orders/77', 'DELETE /orders/77'])
  })

  it('a refusal to cancel an order in production is not worth retrying; an outage is', async () => {
    reply = () => ({ status: 400, body: { code: 400, result: 'Order cannot be canceled', error: { message: 'Order cannot be canceled' } } })
    const refused = await printful.cancelOrder(CREDENTIALS, '77').catch((caught) => caught)
    expect(refused.message).toBe('Printful: Order cannot be canceled')
    expect(refused.transient).toBe(false)
    reply = () => ({ status: 503 })
    expect((await printful.getOrder(CREDENTIALS, '77').catch((caught) => caught)).transient).toBe(true)
  })

  it('sets the notice address only when no other app holds the store’s one address', async () => {
    reply = (call) => (call.method === 'GET' ? { status: 200, body: { result: { url: null, types: [] } } } : { status: 200, body: { result: {} } })
    expect(await printful.registerWebhooks(CREDENTIALS, 'https://console.example/hook', 's')).toEqual({ registered: true, detail: null })
    expect(calls[1]).toMatchObject({ method: 'POST', path: '/webhooks', body: { url: 'https://console.example/hook', types: [...PRINTFUL_WEBHOOK_TYPES] } })

    calls = []
    reply = () => ({ status: 200, body: { result: { url: 'https://other-app.example/hook', types: ['package_shipped'] } } })
    const taken = await printful.registerWebhooks(CREDENTIALS, 'https://console.example/hook', 's')
    expect(taken.registered).toBe(false)
    expect(taken.detail).toContain('another app')
    expect(calls.map((call) => call.method)).toEqual(['GET'])
  })

  it('removes the notice address only when it is the store’s own', async () => {
    reply = () => ({ status: 200, body: { result: { url: 'https://other-app.example/hook' } } })
    await printful.removeWebhooks(CREDENTIALS, 'https://console.example/hook')
    expect(calls.map((call) => call.method)).toEqual(['GET'])
    calls = []
    reply = () => ({ status: 200, body: { result: { url: 'https://console.example/hook' } } })
    await printful.removeWebhooks(CREDENTIALS, 'https://console.example/hook')
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /webhooks', 'DELETE /webhooks'])
  })

  it('reads the order a notice is about', () => {
    expect(printful.webhookOrderId({ type: 'package_shipped', data: { order: { id: 77 } } })).toBe('77')
    expect(printful.webhookOrderId({ type: 'product_updated', data: { sync_product: { id: 1 } } })).toBeNull()
  })

  it('turns a network failure and a timeout into a retryable error', async () => {
    const offline = createPrintfulProvider(async () => {
      throw new TypeError('fetch failed')
    })
    const error = await offline.getOrder(CREDENTIALS, '1').catch((caught) => caught)
    expect(error).toMatchObject({ status: 0, code: 'network' })
    expect(error.transient).toBe(true)
  })
})

describe('Printify', () => {
  const printify = createPrintifyProvider(recorded)
  const SHOP = { token: 'pfy-token', storeId: '9' }

  it('lists shops, naming itself to the API', async () => {
    reply = () => ({ status: 200, body: [{ id: 9, title: 'Wave Shop', sales_channel: 'custom_integration' }] })
    expect(await printify.listStores('pfy-token')).toEqual([{ id: '9', name: 'Wave Shop', currency: 'USD' }])
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/v1/shops.json' })
    expect(calls[0].headers['Authorization']).toBe('Bearer pfy-token')
    expect(calls[0].headers['User-Agent']).toBeTruthy()
  })

  it('pages a shop’s products', async () => {
    reply = () => ({
      status: 200,
      body: {
        current_page: 1,
        last_page: 3,
        total: 120,
        data: [
          {
            id: 'p1',
            title: 'Wave Mug',
            images: [{ src: 'https://images-api.printify.com/a.png', is_default: true }],
            variants: [{ is_enabled: true }, { is_enabled: false }],
          },
        ],
      },
    })
    expect(await printify.listProducts(SHOP, null)).toEqual({
      products: [{ id: 'p1', name: 'Wave Mug', thumbnailUrl: 'https://images-api.printify.com/a.png', variantCount: 1 }],
      nextCursor: '2',
      total: 120,
    })
    expect(calls[0]).toMatchObject({ path: '/v1/shops/9/products.json', search: '?limit=50&page=1' })
  })

  it('refuses to read a shop it was not told', async () => {
    await expect(printify.listProducts({ token: 't', storeId: null }, null)).rejects.toThrow('Choose the Printify shop to connect.')
    expect(calls).toHaveLength(0)
  })

  it('reads a product: enabled variants only, options by name, cents as given, words as text', async () => {
    reply = () => ({
      status: 200,
      body: {
        id: 'p1',
        title: 'Wave Mug',
        description: '<p>A <b>sturdy</b> mug.</p><ul><li>11 oz</li></ul>',
        tags: ['Mugs', 'Home'],
        options: [
          { name: 'Colors', type: 'color', values: [{ id: 1, title: 'White' }, { id: 2, title: 'Black' }] },
          { name: 'Sizes', type: 'size', values: [{ id: 10, title: '11oz' }, { id: 11, title: '15oz' }] },
        ],
        variants: [
          { id: 100, sku: 'MUG-W-11', cost: 450, price: 1500, title: 'White / 11oz', grams: 340, is_enabled: true, is_available: true, options: [1, 10] },
          { id: 101, sku: 'MUG-W-15', cost: 550, price: 1800, title: 'White / 15oz', grams: 420, is_enabled: true, is_available: false, options: [1, 11] },
          { id: 102, sku: 'MUG-B-11', cost: 450, price: 1500, title: 'Black / 11oz', is_enabled: false, options: [2, 10] },
        ],
        images: [
          { src: 'https://images-api.printify.com/w11.png', variant_ids: [100], is_default: true },
          { src: 'https://images-api.printify.com/w15.png', variant_ids: [101], is_default: false },
        ],
      },
    })
    const product = await printify.getProduct(SHOP, 'p1')
    expect(calls[0].path).toBe('/v1/shops/9/products/p1.json')
    expect(product).toEqual({
      id: 'p1',
      name: 'Wave Mug',
      description: 'A sturdy mug.\n\n• 11 oz',
      tags: ['Mugs', 'Home'],
      currency: 'USD',
      imageUrls: ['https://images-api.printify.com/w11.png', 'https://images-api.printify.com/w15.png'],
      options: [
        { name: 'Colors', values: ['White'] },
        { name: 'Sizes', values: ['11oz', '15oz'] },
      ],
      variants: [
        {
          id: '100',
          name: 'White / 11oz',
          sku: 'MUG-W-11',
          options: { Colors: 'White', Sizes: '11oz' },
          retailMinor: 1500,
          costMinor: 450,
          available: true,
          imageUrl: 'https://images-api.printify.com/w11.png',
          weightGrams: 340,
        },
        {
          id: '101',
          name: 'White / 15oz',
          sku: 'MUG-W-15',
          options: { Colors: 'White', Sizes: '15oz' },
          retailMinor: 1800,
          costMinor: 550,
          available: false,
          imageUrl: 'https://images-api.printify.com/w15.png',
          weightGrams: 420,
        },
      ],
    })
  })

  const ORDER = {
    id: 'o1',
    external_id: 'ag555',
    status: 'partially-fulfilled',
    sent_to_production_at: '2026-10-07 10:00:00+00:00',
    total_price: 900,
    total_shipping: 450,
    total_tax: 0,
    line_items: [
      { product_id: 'p1', variant_id: 100, quantity: 2, status: 'fulfilled' },
      { product_id: 'p1', variant_id: 101, quantity: 1, status: 'in-production' },
    ],
    shipments: [{ carrier: 'usps', number: '9400222', url: 'https://track.example/9400222', delivered_at: '2026-10-09 12:00:00+00:00' }],
  }

  it('creates an order, sends it to production, and reads it back', async () => {
    reply = (call) => {
      if (call.method === 'POST' && call.path === '/v1/shops/9/orders.json') return { status: 200, body: { id: 'o1' } }
      if (call.path === '/v1/shops/9/orders/o1/send_to_production.json') return { status: 200, body: { id: 'o1' } }
      if (call.path === '/v1/shops/9/orders/o1.json') return { status: 200, body: ORDER }
      return { status: 500 }
    }
    const order = await printify.createOrder(SHOP, {
      externalId: 'ag555',
      label: '#1042',
      recipient: { name: 'Ada King Lovelace', line1: '1 Main St', line2: 'Apt 2', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', phone: '555', email: 'ada@example.com' },
      lines: [{ lineIndex: 0, sourceProductId: 'p1', sourceVariantId: '100', quantity: 2, retailMinor: 1500, name: 'Mug' }],
      retailCurrency: 'USD',
      confirm: true,
    })
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /v1/shops/9/orders.json',
      'POST /v1/shops/9/orders/o1/send_to_production.json',
      'GET /v1/shops/9/orders/o1.json',
    ])
    expect(calls[0].body).toEqual({
      external_id: 'ag555',
      label: '#1042',
      line_items: [{ product_id: 'p1', variant_id: 100, quantity: 2 }],
      shipping_method: 1,
      send_shipping_notification: false,
      address_to: {
        first_name: 'Ada King',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        phone: '555',
        country: 'US',
        region: 'TX',
        address1: '1 Main St',
        address2: 'Apt 2',
        city: 'Austin',
        zip: '78701',
      },
    })
    expect(order).toEqual({
      id: 'o1',
      externalId: 'ag555',
      status: 'partially_shipped',
      rawStatus: 'partially-fulfilled',
      costs: { currency: 'USD', itemsMinor: 900, shippingMinor: 450, taxMinor: 0, totalMinor: 1350 },
      shipments: [
        {
          id: 'usps:9400222',
          carrier: 'usps',
          service: null,
          trackingNumber: '9400222',
          trackingUrl: 'https://track.example/9400222',
          lines: null,
          shippedAtMs: null,
          deliveredAtMs: Date.parse('2026-10-09T12:00:00+00:00'),
        },
      ],
      fulfilledVariantIds: ['100'],
      dashboardUrl: null,
    })
  })

  it('leaves a draft unsent when not confirmed', async () => {
    reply = (call) =>
      call.method === 'POST'
        ? { status: 200, body: { id: 'o2' } }
        : { status: 200, body: { id: 'o2', status: 'on-hold', line_items: [{ variant_id: 100 }] } }
    const order = await printify.createOrder(SHOP, {
      externalId: 'ag1',
      label: '#1',
      recipient: { name: 'A', line1: '1', city: 'B', postalCode: '1', country: 'US' },
      lines: [],
      retailCurrency: 'USD',
      confirm: false,
    })
    expect(order.status).toBe('draft')
    expect(calls.some((call) => call.path.endsWith('send_to_production.json'))).toBe(false)
  })

  it('finds an order by the store’s key among the shop’s recent orders', async () => {
    reply = (call) =>
      call.search === '?limit=50&page=1'
        ? { status: 200, body: { last_page: 2, data: [{ id: 'x', metadata: { shop_order_id: 'other' } }] } }
        : { status: 200, body: { last_page: 2, data: [{ ...ORDER, external_id: undefined, metadata: { shop_order_id: 'ag555' } }] } }
    expect((await printify.findOrder(SHOP, 'ag555'))?.id).toBe('o1')
    expect(calls).toHaveLength(2)
    calls = []
    reply = () => ({ status: 200, body: { last_page: 1, data: [] } })
    expect(await printify.findOrder(SHOP, 'ag555')).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('cancels an order and reads it back', async () => {
    reply = (call) => (call.method === 'POST' ? { status: 200, body: {} } : { status: 200, body: { ...ORDER, status: 'canceled' } })
    expect((await printify.cancelOrder(SHOP, 'o1')).status).toBe('canceled')
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /v1/shops/9/orders/o1/cancel.json', 'GET /v1/shops/9/orders/o1.json'])
  })

  it('registers each topic once, signed with the connection’s secret', async () => {
    reply = (call) =>
      call.method === 'GET'
        ? { status: 200, body: [{ id: 'w1', topic: 'order:updated', url: 'https://console.example/hook' }] }
        : { status: 200, body: { id: 'w2' } }
    expect(await printify.registerWebhooks(SHOP, 'https://console.example/hook', 'sekret')).toEqual({ registered: true, detail: null })
    const posted = calls.filter((call) => call.method === 'POST')
    expect(posted.map((call) => call.body)).toEqual(
      PRINTIFY_WEBHOOK_TOPICS.filter((topic) => topic !== 'order:updated').map((topic) => ({
        topic,
        url: 'https://console.example/hook',
        secret: 'sekret',
      })),
    )
  })

  it('removes only its own hooks, naming the host as the API asks', async () => {
    reply = (call) =>
      call.method === 'GET'
        ? {
            status: 200,
            body: [
              { id: 'w1', topic: 'order:updated', url: 'https://console.example/hook' },
              { id: 'w9', topic: 'order:updated', url: 'https://someone.example/else' },
            ],
          }
        : { status: 200, body: {} }
    await printify.removeWebhooks(SHOP, 'https://console.example/hook')
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => `${call.path}${call.search}`)).toEqual([
      '/v1/shops/9/webhooks/w1.json?host=console.example',
    ])
  })

  it('reads the order a notice is about', () => {
    expect(printify.webhookOrderId({ type: 'order:shipment:created', resource: { id: 'o1', type: 'order' } })).toBe('o1')
    expect(printify.webhookOrderId({ type: 'product:publish:started', resource: { id: 'p1', type: 'product' } })).toBeNull()
  })

  it('says each status in the store’s words', () => {
    expect(printifyStatus('on-hold', false)).toBe('draft')
    expect(printifyStatus('on-hold', true)).toBe('on_hold')
    expect(printifyStatus('payment-not-received', true)).toBe('on_hold')
    expect(printifyStatus('in-production', true)).toBe('in_production')
    expect(printifyStatus('fulfilled', true)).toBe('shipped')
    expect(printifyStatus('canceled', false)).toBe('canceled')
  })

  it('says a refused token in words', async () => {
    reply = () => ({ status: 401, body: { message: 'Unauthenticated.' } })
    await expect(printify.listStores('bad')).rejects.toThrow('Printify refused the token.')
  })
})
