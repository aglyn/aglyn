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

import { mockHttp, sentJson } from '../testing/mock-http'
import { createBrightpearlProvider, safeApiDomain, searchRows } from './brightpearl'
import { createCin7CoreProvider } from './cin7-core'
import { ProviderError, providerRequest } from './http'
import { nameUuid, orderReference } from './ids'
import { createInflowProvider } from './inflow'
import type { InventoryCredential, SystemOrderRequest } from './provider'

const CIN7: InventoryCredential = { provider: 'cin7-core', accountId: 'acct-1234', apiKey: 'key-secret-1' }
const INFLOW: InventoryCredential = { provider: 'inflow', companyId: 'company-1', apiKey: 'inflow-secret' }
const BP: InventoryCredential = {
  provider: 'brightpearl',
  accountCode: 'shop',
  apiDomain: 'use1.brightpearlconnect.com',
  accessToken: 'bp-token',
}

const ORDER: SystemOrderRequest = {
  reference: 'AG1042-3fa9c2d1',
  displayRef: '#1042',
  orderedAtMs: Date.UTC(2026, 9, 7),
  currency: 'USD',
  customer: 'Web Sales',
  locationId: 'Main Warehouse',
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
    phone: null,
  },
  lines: [{ sku: 'TEE-M', productId: 'p-1', name: 'Tee — M', quantity: 2, unitAmountCents: 1999 }],
  shippingCents: 500,
  discountCents: 0,
  taxCents: 330,
  totalCents: 4828,
}

describe('the HTTP door (AGL-3642)', () => {
  it('reads Brightpearl’s 503 throttle header as a rate limit with its wait', async () => {
    const { http } = mockHttp([
      { match: 'x', status: 503, headers: { 'brightpearl-next-throttle-period': '42000' }, body: {} },
    ])
    await expect(providerRequest(http, { provider: 'Brightpearl', method: 'GET', url: 'https://x' })).rejects.toMatchObject({
      kind: 'rate-limit',
      retryAfterMs: 42000,
    })
  })

  it('waits out a short 429 in the call and then succeeds', async () => {
    const { http, waits } = mockHttp([
      { match: 'x', status: 429, headers: { 'retry-after': '1' }, times: 1 },
      { match: 'x', body: { ok: true } },
    ])
    await expect(providerRequest(http, { provider: 'Cin7 Core', method: 'GET', url: 'https://x' })).resolves.toEqual({ ok: true })
    expect(waits).toEqual([1000])
  })

  it('never retries a create in the call', async () => {
    const { http, calls } = mockHttp([{ match: 'x', status: 502 }])
    await expect(
      providerRequest(http, { provider: 'inFlow', method: 'PUT', url: 'https://x', retry: false }),
    ).rejects.toBeInstanceOf(ProviderError)
    expect(calls).toHaveLength(1)
  })

  it('reads Cin7 Core’s array of exceptions as the refusal’s words', async () => {
    const { http } = mockHttp([{ match: 'x', status: 400, body: [{ ErrorCode: 400, Exception: 'Customer not found' }] }])
    await expect(providerRequest(http, { provider: 'Cin7 Core', method: 'POST', url: 'https://x' })).rejects.toMatchObject({
      kind: 'invalid',
      message: 'Customer not found',
    })
  })
})

describe('ids (AGL-3642)', () => {
  it('derives the same RFC 4122 v5-shaped id from the same name', () => {
    const id = nameUuid('order:AG1-x')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(nameUuid('order:AG1-x')).toBe(id)
    expect(nameUuid('order:AG2-x')).not.toBe(id)
  })

  it('names an order by its number and a site-and-order digest', () => {
    expect(orderReference('host-1', 'order-1', 1042)).toMatch(/^AG1042-[0-9a-f]{8}$/)
    expect(orderReference('host-2', 'order-1', 1042)).not.toBe(orderReference('host-1', 'order-1', 1042))
    expect(orderReference('host-1', 'order-1', null)).toMatch(/^AG-[0-9a-f]{8}$/)
  })
})

describe('Cin7 Core (AGL-3642)', () => {
  it('authenticates every call with the merchant’s account id and application key', async () => {
    const { http, calls } = mockHttp([{ match: '/me', body: { Company: 'Acme Goods' } }])
    await expect(createCin7CoreProvider({ http }).account(CIN7)).resolves.toEqual({ accountName: 'Acme Goods' })
    expect(calls[0].headers).toMatchObject({ 'api-auth-accountid': 'acct-1234', 'api-auth-applicationkey': 'key-secret-1' })
    expect(calls[0].url).toBe('https://inventory.dearsystems.com/ExternalApi/v2/me')
  })

  it('sums a SKU’s availability rows at the chosen location, across pages', async () => {
    const { http, calls } = mockHttp([
      {
        match: 'Page=1',
        body: {
          Total: 1001,
          ProductAvailabilityList: [
            { ID: 'p-1', SKU: 'TEE-M', Location: 'Main Warehouse', Available: 3, OnHand: 4 },
            { ID: 'p-1', SKU: 'TEE-M', Location: 'Main Warehouse', Available: 2, OnHand: 2 },
            { ID: 'p-2', SKU: 'MUG', Location: 'Other', Available: 9, OnHand: 9 },
          ],
        },
      },
      { match: 'Page=2', body: { Total: 1001, ProductAvailabilityList: [{ ID: 'p-3', SKU: 'CAP', Location: 'Main Warehouse', Available: -1, OnHand: 0 }] } },
    ])
    const stock = await createCin7CoreProvider({ http }).stock(CIN7, { locationId: 'Main Warehouse', max: 100 })
    expect(stock).toEqual([
      { sku: 'TEE-M', productId: 'p-1', available: 5, onHand: 6 },
      { sku: 'CAP', productId: 'p-3', available: 0, onHand: 0 },
    ])
    expect(calls[0].url).toContain('Location=Main+Warehouse')
  })

  it('finishes a sale whose lines an earlier attempt did not write, rather than making a second', async () => {
    const { http, calls } = mockHttp([
      {
        match: 'saleList',
        body: { SaleList: [{ SaleID: 's-1', OrderNumber: 'SO-77', CustomerReference: ORDER.reference, OrderStatus: 'NOT AVAILABLE' }] },
      },
      { method: 'POST', match: 'sale/order', body: { SaleID: 's-1' } },
    ])
    await expect(createCin7CoreProvider({ http }).createOrder(CIN7, ORDER)).resolves.toEqual({ id: 's-1', number: 'SO-77' })
    expect(calls.map((call) => `${call.method} ${call.url.split('/v2/')[1].split('?')[0]}`)).toEqual(['GET saleList', 'POST sale/order'])
    const body = sentJson(calls[1])
    expect(body.Status).toBe('AUTHORISED')
    expect(body.Lines).toEqual([
      expect.objectContaining({ ProductID: 'p-1', SKU: 'TEE-M', Quantity: 2, Price: 19.99, Total: 39.98 }),
    ])
    expect(body.AdditionalCharges.map((charge: any) => [charge.Description, charge.Price])).toEqual([
      ['Shipping', 5],
      ['Sales tax collected by the store', 3.3],
    ])
  })

  it('makes a sale under our reference, then its authorised lines', async () => {
    const { http, calls } = mockHttp([
      { match: 'saleList', body: { SaleList: [] } },
      { method: 'POST', match: /\/sale$/, body: { ID: 's-2' } },
      { method: 'POST', match: 'sale/order', body: {} },
    ])
    await expect(createCin7CoreProvider({ http }).createOrder(CIN7, ORDER)).resolves.toEqual({ id: 's-2', number: null })
    const sale = sentJson(calls[1])
    expect(sale).toMatchObject({ Customer: 'Web Sales', CustomerReference: ORDER.reference, Location: 'Main Warehouse', SkipQuote: true })
    expect(sale.ShippingAddress).toMatchObject({ Line1: '1 Main St', City: 'Austin', Postcode: '78701', Country: 'US' })
  })

  it('adopts a finished sale by its reference', async () => {
    const { http } = mockHttp([
      { match: 'saleList', body: { SaleList: [{ SaleID: 's-3', OrderNumber: 'SO-9', CustomerReference: ORDER.reference, OrderStatus: 'AUTHORISED' }] } },
    ])
    await expect(createCin7CoreProvider({ http }).findOrder(CIN7, ORDER.reference)).resolves.toEqual({ id: 's-3', number: 'SO-9' })
  })

  it('voids a canceled sale, and reads a refusal as too late', async () => {
    const ok = mockHttp([{ method: 'DELETE', match: 'sale?ID=s-1&Void=true', body: {} }])
    await expect(createCin7CoreProvider({ http: ok.http }).cancelOrder(CIN7, { id: 's-1', number: null, reference: 'r' })).resolves.toBe('canceled')
    const late = mockHttp([{ method: 'DELETE', match: 'sale', status: 400, body: [{ Exception: 'Sale is shipped' }] }])
    await expect(createCin7CoreProvider({ http: late.http }).cancelOrder(CIN7, { id: 's-1', number: null, reference: 'r' })).resolves.toBe('too_late')
  })

  it('states the new count for stock the location holds and receives new stock for the rest', async () => {
    const { http, calls } = mockHttp([{ method: 'POST', match: 'stockadjustment', body: {} }])
    await createCin7CoreProvider({ http }).adjustStock(CIN7, {
      locationId: 'Main Warehouse',
      reference: 'AGS-1',
      currency: 'USD',
      changes: [
        { sku: 'TEE-M', productId: 'p-1', delta: -2, onHand: 6 },
        { sku: 'CAP', productId: 'p-3', delta: 4, onHand: 0 },
      ],
    })
    const body = sentJson(calls[0])
    expect(body.ExistingStockLines).toEqual([{ ProductID: 'p-1', SKU: 'TEE-M', Location: 'Main Warehouse', Quantity: 4 }])
    expect(body.NewStockLines).toEqual([{ ProductID: 'p-3', SKU: 'CAP', Location: 'Main Warehouse', Quantity: 4, UnitCost: 0 }])
  })

  it('lists products changed since a time, with prices in minor units and a page cursor', async () => {
    const { http, calls } = mockHttp([
      {
        match: 'product?',
        body: {
          Total: 150,
          Products: [{ ID: 'p-1', SKU: 'TEE-M', Name: 'Tee', PriceTier1: 19.99, Weight: 0.2, WeightUnits: 'kg', Status: 'Active', LastModifiedOn: '2026-10-01T00:00:00Z' }],
        },
      },
    ])
    const page = await createCin7CoreProvider({ http }).products(CIN7, { sinceMs: Date.UTC(2026, 9, 1), cursor: null, limit: 100, currency: 'USD' })
    expect(page.products[0]).toMatchObject({ id: 'p-1', sku: 'TEE-M', priceMinor: 1999, weightGrams: 200, version: '2026-10-01T00:00:00Z', active: true })
    expect(page.nextCursor).toBe('2')
    expect(calls[0].url).toContain('ModifiedSince=2026-10-01')
  })

  it('finds a customer by its exact name', async () => {
    const { http } = mockHttp([{ match: 'customer?', body: { CustomerList: [{ Name: 'web sales' }] } }])
    await expect(createCin7CoreProvider({ http }).customerExists(CIN7, 'Web Sales')).resolves.toBe(true)
  })
})

describe('inFlow (AGL-3642)', () => {
  it('sends the key as a bearer token and asks for the API version', async () => {
    const { http, calls } = mockHttp([{ match: '/locations', body: [{ locationId: 'loc-1', name: 'Main' }] }])
    await expect(createInflowProvider({ http }).locations(INFLOW)).resolves.toEqual([{ id: 'loc-1', name: 'Main' }])
    expect(calls[0].url.startsWith('https://cloudapi.inflowinventory.com/company-1/locations')).toBe(true)
    expect(calls[0].headers).toMatchObject({ authorization: 'Bearer inflow-secret', accept: 'application/json;version=2026-09-29' })
  })

  it('records an order under an id derived from our reference, so a resend is the same order', async () => {
    const { http, calls } = mockHttp([
      { match: 'customers?', body: [{ customerId: 'c-1', name: 'Web Sales' }] },
      { method: 'PUT', match: 'sales-orders', body: { orderNumber: 'SO-000123' } },
    ])
    const first = await createInflowProvider({ http }).createOrder(INFLOW, ORDER)
    await createInflowProvider({ http }).createOrder(INFLOW, ORDER)
    const puts = calls.filter((call) => call.method === 'PUT').map(sentJson)
    expect(puts[0].salesOrderId).toBe(nameUuid(`order:${ORDER.reference}`))
    expect(puts[1].salesOrderId).toBe(puts[0].salesOrderId)
    expect(puts[0].lines[0].salesOrderLineId).toBe(puts[1].lines[0].salesOrderLineId)
    expect(puts[0]).toMatchObject({ customerId: 'c-1', source: 'Aglyn', orderFreight: '5.00', poNumber: ORDER.reference, locationId: 'Main Warehouse' })
    expect(puts[0].lines[0]).toMatchObject({ productId: 'p-1', unitPrice: '19.99', quantity: { standardQuantity: '2' } })
    expect(first).toEqual({ id: nameUuid(`order:${ORDER.reference}`), number: 'SO-000123' })
  })

  it('refuses an order whose customer does not exist, with a sentence to fix it', async () => {
    const { http } = mockHttp([{ match: 'customers?', body: [] }])
    await expect(createInflowProvider({ http }).createOrder(INFLOW, ORDER)).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('finds an order by its derived id and reads a 404 as none', async () => {
    const none = mockHttp([{ match: 'sales-orders/', status: 404, body: { message: 'not found' } }])
    await expect(createInflowProvider({ http: none.http }).findOrder(INFLOW, ORDER.reference)).resolves.toBeNull()
    const found = mockHttp([{ match: 'sales-orders/', body: { salesOrderId: 'so-1', orderNumber: 'SO-1' } }])
    await expect(createInflowProvider({ http: found.http }).findOrder(INFLOW, ORDER.reference)).resolves.toEqual({ id: 'so-1', number: 'SO-1' })
  })

  it('reads available counts at a location from product summaries, a page at a time', async () => {
    const page1 = Array.from({ length: 100 }, (_, index) => ({ productId: `p-${index}`, sku: index === 0 ? 'TEE-M' : '' }))
    const { http, calls } = mockHttp([
      { match: /products\?.*after=p-99/, body: [{ productId: 'p-100', sku: 'CAP' }] },
      { match: 'products?', body: page1 },
      {
        method: 'POST',
        match: 'products/summary',
        body: [
          { productId: 'p-0', quantityAvailable: 7, quantityOnHand: 9 },
          { productId: 'p-100', quantityAvailable: 2, quantityOnHand: 2 },
        ],
      },
    ])
    const stock = await createInflowProvider({ http }).stock(INFLOW, { locationId: 'loc-1', max: 100 })
    expect(stock).toEqual([
      { sku: 'TEE-M', productId: 'p-0', available: 7, onHand: 9 },
      { sku: 'CAP', productId: 'p-100', available: 2, onHand: 2 },
    ])
    expect(sentJson(calls.find((call) => call.method === 'POST'))).toEqual([{ productId: 'p-0', locationId: 'loc-1' }])
  })

  it('adjusts by the difference, under ids derived from the run’s reference', async () => {
    const { http, calls } = mockHttp([{ method: 'PUT', match: 'stock-adjustments', body: {} }])
    await createInflowProvider({ http }).adjustStock(INFLOW, {
      locationId: 'loc-1',
      reference: 'AGS-1',
      currency: 'USD',
      changes: [{ sku: 'TEE-M', productId: 'p-0', delta: -3, onHand: 9 }],
    })
    const body = sentJson(calls[0])
    expect(body.stockAdjustmentId).toBe(nameUuid('adjustment:AGS-1'))
    expect(body.lines).toEqual([
      { stockAdjustmentLineId: nameUuid('adjustment:AGS-1:TEE-M'), productId: 'p-0', quantity: { standardQuantity: '-3' } },
    ])
  })

  it('quick-cancels a canceled order', async () => {
    const { http, calls } = mockHttp([{ method: 'POST', match: 'quick-cancel', body: {} }])
    await expect(createInflowProvider({ http }).cancelOrder(INFLOW, { id: 'so-1', number: null, reference: 'r' })).resolves.toBe('canceled')
    expect(calls[0].url).toContain('/sales-orders/so-1/quick-cancel')
  })
})

describe('Brightpearl (AGL-3642)', () => {
  const app = { appRef: 'aglyn-app', devRef: 'aglyn-dev' }

  it('calls the account’s own datacenter with the token and both app references', async () => {
    const { http, calls } = mockHttp([{ match: 'warehouse-service/warehouse', body: { response: [{ id: 2, name: 'Main' }] } }])
    await expect(createBrightpearlProvider({ http, app }).locations(BP)).resolves.toEqual([{ id: '2', name: 'Main' }])
    expect(calls[0].url).toBe('https://use1.brightpearlconnect.com/public-api/shop/warehouse-service/warehouse')
    expect(calls[0].headers).toMatchObject({
      authorization: 'Bearer bp-token',
      'brightpearl-app-ref': 'aglyn-app',
      'brightpearl-dev-ref': 'aglyn-dev',
    })
  })

  it('refuses a datacenter that is not Brightpearl’s', async () => {
    expect(safeApiDomain('evil.example.com')).toBeNull()
    expect(safeApiDomain('ws-eu1.brightpearl.com')).toBe('ws-eu1.brightpearl.com')
    const { http, calls } = mockHttp([])
    await expect(
      createBrightpearlProvider({ http, app }).locations({ ...BP, apiDomain: 'attacker.net' } as InventoryCredential),
    ).rejects.toMatchObject({ kind: 'auth' })
    expect(calls).toHaveLength(0)
  })

  it('reads search columns by name', () => {
    expect(
      searchRows({ metaData: { columns: [{ name: 'productId' }, { name: 'SKU' }], morePagesAvailable: true }, results: [[1, 'A']] }),
    ).toEqual({ rows: [{ productId: 1, SKU: 'A' }], more: true })
  })

  it('reads onHand (free to sell) as available, at the chosen warehouse', async () => {
    const { http } = mockHttp([
      {
        match: 'product-search',
        body: { response: { metaData: { columns: [{ name: 'productId' }, { name: 'SKU' }], morePagesAvailable: false }, results: [[11, 'TEE-M']] } },
      },
      {
        match: 'product-availability/11',
        body: { response: { '11': { total: { inStock: 9, onHand: 7 }, warehouses: { '2': { inStock: 5, onHand: 4 } } } } },
      },
    ])
    await expect(createBrightpearlProvider({ http, app }).stock(BP, { locationId: '2', max: 100 })).resolves.toEqual([
      { sku: 'TEE-M', productId: '11', available: 4, onHand: 5 },
    ])
  })

  it('writes only the rows a failed attempt did not, on an order found by its reference', async () => {
    const { http, calls } = mockHttp([
      {
        match: 'order-search',
        body: { response: { metaData: { columns: [{ name: 'orderId' }, { name: 'customerRef' }] }, results: [[501, ORDER.reference]] } },
      },
      { method: 'GET', match: 'order-service/order/501', body: { response: [{ orderRows: { '1': { productId: 'p-1' } } }] } },
      { method: 'POST', match: '/row', body: { response: 9 } },
    ])
    await expect(
      createBrightpearlProvider({ http, app }).createOrder(BP, { ...ORDER, customer: '207' }),
    ).resolves.toEqual({ id: '501', number: '501' })
    const rows = calls.filter((call) => call.method === 'POST').map(sentJson)
    expect(rows.map((row) => row.productName ?? row.productId)).toEqual(['Shipping', 'Sales tax collected by the store'])
  })

  it('makes a sales order for the customer contact, under our reference', async () => {
    const { http, calls } = mockHttp([
      { match: 'order-search', body: { response: { metaData: { columns: [] }, results: [] } } },
      { method: 'POST', match: /order-service\/order$/, body: { response: 777 } },
      { method: 'POST', match: '/row', body: { response: 1 } },
    ])
    await createBrightpearlProvider({ http, app }).createOrder(BP, { ...ORDER, customer: '207', locationId: '2' })
    const order = sentJson(calls[1])
    expect(order).toMatchObject({
      orderTypeCode: 'SO',
      reference: ORDER.reference,
      warehouseId: 2,
      currency: { orderCurrencyCode: 'USD' },
      parties: { customer: { contactId: 207 }, delivery: { addressLine1: '1 Main St', postalCode: '78701', countryIsoCode: 'US' } },
    })
    expect(sentJson(calls[2])).toMatchObject({ quantity: { magnitude: 2 }, rowValue: { rowNet: { value: 39.98 } } })
  })

  it('cancels nothing through the API and makes no products', async () => {
    const { http } = mockHttp([])
    const provider = createBrightpearlProvider({ http, app })
    await expect(provider.cancelOrder(BP, { id: '1', number: null, reference: 'r' })).resolves.toBe('unsupported')
    await expect(
      provider.createProduct(BP, { sku: 'A', name: 'A', description: '', priceMinor: 1, currency: 'USD', weightGrams: null, barcode: null }),
    ).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('prices imported products from the price list in the store’s currency', async () => {
    const { http } = mockHttp([
      {
        match: 'product-search',
        body: {
          response: {
            metaData: { columns: [{ name: 'productId' }, { name: 'SKU' }, { name: 'productName' }, { name: 'updatedOn' }], morePagesAvailable: true },
            results: [[11, 'TEE-M', 'Tee', '2026-10-01T00:00:00Z']],
          },
        },
      },
      {
        match: 'product-price/11',
        body: {
          response: [
            { productId: 11, priceLists: [{ priceListId: 1, currencyCode: 'GBP', quantityPrice: { '1': '9.00' } }, { priceListId: 2, currencyCode: 'USD', quantityPrice: { '1': '12.50' } }] },
          ],
        },
      },
    ])
    const page = await createBrightpearlProvider({ http, app }).products(BP, { sinceMs: null, cursor: null, limit: 100, currency: 'USD' })
    expect(page.products).toEqual([expect.objectContaining({ id: '11', sku: 'TEE-M', priceMinor: 1250, version: '2026-10-01T00:00:00Z' })])
    expect(page.nextCursor).toBe('2')
  })
})
