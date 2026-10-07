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

import { createSecretBoxKey } from '@aglyn/shared-util-tools/secret-box'
import type { CatalogOffer } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { randomBytes } from 'node:crypto'
import { salesChannel } from '../../model/channels'
import { resolveOffer } from '../../model/feed-columns'
import { makeOffer, makeSettings, makeStore } from '../../testing/catalog-fixtures'
import { createMemoryFirestore, type MemoryFirestore } from '../../testing/memory-firestore'
import { createProviderFake, GOOGLE_REFRESH_TOKEN, META_LONG_TOKEN } from '../../testing/provider-fake'
import type { ProviderConfig } from './config'
import { getConnection, sealConnectionToken, type ConnectionDocument } from './connection-store'
import { googlePrice, googleProductInput, googleProductInputSegment } from './google-merchant'
import { connectRuntime } from './http'
import { META_BATCH_SIZE, metaItemData } from './meta-catalog'
import { acquireSyncLease, runSync, SyncBusyError, SYNC_LEASE_MS } from './sync'

/**
 * A sync (AGL-3637, phase 2): the products the feed lists, mapped field by
 * field to Google's product input and Meta's batch item, sent with retries,
 * every refusal counted, earlier-sent products the feed dropped deleted, and
 * one sync per site and provider at a time.
 */

const HOST = 'host-candles'
const NOW = Date.UTC(2026, 9, 7, 15)

let db: MemoryFirestore
let fake: ReturnType<typeof createProviderFake>
let offers: CatalogOffer[] = []
let partial = false

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
}))

jest.mock('../catalog-source', () => ({
  readStore: async () => makeStore(),
  readOffers: async () => ({ offers, partial }),
}))

const key = createSecretBoxKey(randomBytes(32))
const keyring = { current: key, keys: [key] }
const config = (provider: 'google' | 'meta'): ProviderConfig => ({
  provider,
  clientId: `${provider}-client`,
  clientSecret: `${provider}-secret`,
  keyring,
  graphVersion: 'v26.0',
})

const savedRuntime = { ...connectRuntime }
afterAll(() => Object.assign(connectRuntime, savedRuntime))

beforeEach(() => {
  db = createMemoryFirestore()
  fake = createProviderFake()
  offers = [makeOffer({ id: 'prod-1' }), makeOffer({ id: 'prod-2', productId: 'prod-2', groupId: 'prod-2' })]
  partial = false
  connectRuntime.fetch = fake.fetch
  connectRuntime.sleep = async () => undefined
  connectRuntime.now = () => NOW
})

function connected(provider: 'google' | 'meta', overrides: Partial<ConnectionDocument> = {}): ConnectionDocument {
  const connection: ConnectionDocument = {
    provider,
    sealedToken: sealConnectionToken(provider === 'google' ? GOOGLE_REFRESH_TOKEN : META_LONG_TOKEN, keyring, HOST, provider),
    targetId: provider === 'google' ? '111' : '88',
    targetName: 'Target',
    targets: [],
    connectedAtMs: NOW,
    connectedBy: 'uid-admin',
    ...overrides,
  }
  db.docs.set(`hosts/${HOST}/salesChannels/connection-${provider}`, JSON.parse(JSON.stringify(connection)))
  return connection
}

const sync = (provider: 'google' | 'meta', connection = connected(provider)) =>
  runSync({ hostId: HOST, uid: 'uid-editor', config: config(provider), connection })

const googleRow = (offer: CatalogOffer) =>
  resolveOffer(offer, { channel: salesChannel('google')!, store: makeStore(), settings: makeSettings() }).row

describe('the Google product input', () => {
  it('states a price in micros of the store currency, whatever its exponent', () => {
    expect(googlePrice(1800, 'USD')).toEqual({ amountMicros: '18000000', currencyCode: 'USD' })
    expect(googlePrice(1800, 'JPY')).toEqual({ amountMicros: '1800000000', currencyCode: 'JPY' })
    expect(googlePrice(1234, 'KWD')).toEqual({ amountMicros: '1234000', currencyCode: 'KWD' })
  })

  it('maps the feed row to the Merchant API attributes', () => {
    const offer = makeOffer({
      gtin: '036000291452',
      mpn: 'BC-1',
      brand: 'Beehive',
      salePriceMinor: 1500,
      availability: 'backorder',
      condition: 'refurbished',
      productType: 'Home > Candles',
      googleProductCategory: '588',
      hasVariants: true,
      groupId: 'grp-1',
      color: 'Amber',
      size: 'Large',
      dimensionsCm: { length: 10, width: 8, height: 12 },
    })
    const input = googleProductInput(offer, googleRow(offer), { store: makeStore(), feedLabel: 'US' })
    expect(input).toMatchObject({ offerId: 'prod-1', contentLanguage: 'en', feedLabel: 'US' })
    expect(input.productAttributes).toEqual({
      title: 'Beeswax Candle',
      description: 'Hand poured.',
      link: 'https://candles.example.com/products/beeswax-candle',
      imageLink: 'https://cdn.example.com/candle.jpg',
      additionalImageLinks: ['https://cdn.example.com/candle-2.jpg'],
      availability: 'BACKORDER',
      condition: 'REFURBISHED',
      price: { amountMicros: '18000000', currencyCode: 'USD' },
      salePrice: { amountMicros: '15000000', currencyCode: 'USD' },
      brand: 'Beehive',
      gtins: ['036000291452'],
      mpn: 'BC-1',
      googleProductCategory: '588',
      productTypes: ['Home > Candles'],
      itemGroupId: 'grp-1',
      color: 'Amber',
      size: 'Large',
      shippingWeight: { value: 400, unit: 'g' },
      shippingLength: { value: 10, unit: 'cm' },
      shippingWidth: { value: 8, unit: 'cm' },
      shippingHeight: { value: 12, unit: 'cm' },
      shipping: [{ country: 'US', service: 'Standard', price: { amountMicros: '4950000', currencyCode: 'USD' } }],
    })
  })

  it('says a product has no identifiers exactly when the feed does, and sends no GTIN the feed drops', () => {
    const offer = makeOffer({ gtin: '036000291453', mpn: undefined, availability: 'out_of_stock' })
    const attributes = googleProductInput(offer, googleRow(offer), { store: makeStore(), feedLabel: 'US' }).productAttributes
    expect(attributes['identifierExists']).toBe(false)
    expect(attributes['gtins']).toBeUndefined()
    expect(attributes['availability']).toBe('OUT_OF_STOCK')
    expect(attributes['salePrice']).toBeUndefined()
  })

  it('addresses a product input by its base64url name, whatever its id holds', () => {
    expect(Buffer.from(googleProductInputSegment('US', 'sku/1~a'), 'base64url').toString('utf8')).toBe('en~US~sku/1~a')
    expect(googleProductInputSegment('US', 'x')).not.toMatch(/[=+/]/)
  })
})

describe('a Google sync', () => {
  it('creates the data source once, inserts every listed offer and records the result', async () => {
    const result = await sync('google')
    expect(result).toMatchObject({ sent: 2, failed: 0, errors: [], deleted: 0 })
    const create = fake.calls.filter((call) => call.url.pathname.endsWith('/dataSources'))
    expect(create).toHaveLength(1)
    expect(create[0].url.pathname).toBe('/datasources/v1/accounts/111/dataSources')
    expect(create[0].body).toMatchObject({ primaryProductDataSource: { feedLabel: 'US', contentLanguage: 'en', countries: ['US'] } })
    const inserts = fake.calls.filter((call) => call.url.pathname.endsWith('/productInputs:insert'))
    expect(inserts.map((call) => call.url.searchParams.get('dataSource'))).toEqual([
      'accounts/111/dataSources/999',
      'accounts/111/dataSources/999',
    ])
    expect(inserts[0].headers['Authorization']).toBe('Bearer g-access-2')
    const stored = await getConnection(HOST, 'google')
    expect(stored?.scheduledFeedId).toBe('accounts/111/dataSources/999')
    expect(stored?.lastSyncResult).toMatchObject({ sent: 2, failed: 0 })
    expect(stored?.lastSyncAtMs).toBe(NOW)

    fake.calls.length = 0
    await sync('google', (await getConnection(HOST, 'google'))!)
    expect(fake.calls.some((call) => call.url.pathname.endsWith('/dataSources'))).toBe(false)
  })

  it('leaves out what the feed leaves out', async () => {
    offers.push(makeOffer({ id: 'svc-1', kind: 'service' }), makeOffer({ id: 'no-photo', imageUrl: undefined }))
    const result = await sync('google')
    expect(result.sent).toBe(2)
    const sent = fake.calls.filter((call) => call.url.pathname.endsWith(':insert')).map((call) => call.body?.['offerId'])
    expect(sent.sort()).toEqual(['prod-1', 'prod-2'])
  })

  it('retries a throttled insert and counts a refused one, keeping the first errors', async () => {
    fake.options.googleThrottles = 2
    fake.options.googleRefuses.add('prod-2')
    const result = await sync('google')
    expect(result).toMatchObject({ sent: 1, failed: 1, errors: ['prod-2: Invalid GTIN value'] })
    const prod1 = fake.calls.filter((call) => call.body?.['offerId'] === 'prod-1')
    expect(prod1).toHaveLength(3)
  })

  it('keeps at most ten errors', async () => {
    offers = Array.from({ length: 14 }, (_, index) =>
      makeOffer({ id: `p-${index}`, productId: `p-${index}`, groupId: `p-${index}` }),
    )
    for (const offer of offers) fake.options.googleRefuses.add(offer.id)
    const result = await sync('google')
    expect(result.failed).toBe(14)
    expect(result.errors).toHaveLength(10)
  })

  it('deletes an offer sent last time that the feed no longer lists', async () => {
    await sync('google')
    offers = [offers[0]]
    fake.calls.length = 0
    const result = await sync('google', (await getConnection(HOST, 'google'))!)
    expect(result).toMatchObject({ sent: 1, deleted: 1 })
    const deleted = fake.calls.find((call) => call.method === 'DELETE')!
    expect(deleted.url.pathname).toBe(`/products/v1/accounts/111/productInputs/${googleProductInputSegment('US', 'prod-2')}`)
    expect(deleted.url.searchParams.get('dataSource')).toBe('accounts/111/dataSources/999')
    expect(db.docs.get(`hosts/${HOST}/salesChannels/sync-google`)?.['sentIds']).toEqual(['prod-1'])
  })

  it('deletes nothing after a catalog read that stopped short', async () => {
    await sync('google')
    offers = [offers[0]]
    partial = true
    fake.calls.length = 0
    const result = await sync('google', (await getConnection(HOST, 'google'))!)
    expect(result).toMatchObject({ deleted: 0, partial: true })
    expect(fake.calls.some((call) => call.method === 'DELETE')).toBe(false)
    expect((db.docs.get(`hosts/${HOST}/salesChannels/sync-google`)?.['sentIds'] as string[]).sort()).toEqual(['prod-1', 'prod-2'])
  })

  it('records a refused grant as the sync’s error and releases the lease', async () => {
    connectRuntime.fetch = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), {
        status: 400,
      })) as typeof fetch
    const result = await sync('google')
    expect(result).toMatchObject({ sent: 0, failed: 1, errors: ['sync: Token has been expired or revoked.'] })
    expect(db.docs.get(`hosts/${HOST}/salesChannels/sync-google`)?.['leaseUntilMs']).toBe(0)
  })
})

describe('the Meta batch item', () => {
  it('carries the Meta feed row’s values', () => {
    const offer = makeOffer({ gtin: '036000291452', salePriceMinor: 1500, availability: 'backorder' })
    const row = resolveOffer(offer, { channel: salesChannel('meta')!, store: makeStore(), settings: makeSettings() }).row
    expect(metaItemData(row, makeStore())).toEqual({
      id: 'prod-1',
      title: 'Beeswax Candle',
      description: 'Hand poured.',
      availability: 'in stock',
      condition: 'new',
      price: '18.00 USD',
      sale_price: '15.00 USD',
      link: 'https://candles.example.com/products/beeswax-candle',
      image_link: 'https://cdn.example.com/candle.jpg',
      additional_image_link: ['https://cdn.example.com/candle-2.jpg'],
      brand: 'Candle Co',
      gtin: '036000291452',
      shipping_weight: '400 g',
      quantity_to_sell_on_facebook: 12,
      shipping: [{ country: 'US', service: 'Standard', price: '4.95 USD' }],
    })
  })
})

describe('a Meta sync', () => {
  it('upserts in chunks of at most 3,000 with the request shape the edge reads', async () => {
    offers = Array.from({ length: META_BATCH_SIZE + 1 }, (_, index) =>
      makeOffer({ id: `p-${index}`, productId: `p-${index}`, groupId: `p-${index}` }),
    )
    const result = await sync('meta')
    expect(result).toMatchObject({ sent: META_BATCH_SIZE + 1, failed: 0 })
    const batches = fake.calls.filter((call) => call.url.pathname.endsWith('/items_batch'))
    expect(batches.map((call) => call.url.pathname)).toEqual(['/v26.0/88/items_batch', '/v26.0/88/items_batch'])
    const first = batches[0].body as Record<string, string>
    expect(first['item_type']).toBe('PRODUCT_ITEM')
    expect(first['allow_upsert']).toBe('true')
    expect(first['appsecret_proof']).toMatch(/^[0-9a-f]{64}$/)
    expect(batches[0].headers['Authorization']).toBe(`Bearer ${META_LONG_TOKEN}`)
    const requests = JSON.parse(first['requests']) as Array<{ method: string; data: { id: string } }>
    expect(requests).toHaveLength(META_BATCH_SIZE)
    expect(requests[0]).toMatchObject({ method: 'UPDATE', data: { id: 'p-0', price: '18.00 USD' } })
    expect(JSON.parse((batches[1].body as Record<string, string>)['requests'])).toHaveLength(1)
  })

  it('counts each item Meta refuses and deletes what the feed dropped', async () => {
    await sync('meta')
    offers = [offers[0], makeOffer({ id: 'prod-3', productId: 'prod-3', groupId: 'prod-3' })]
    fake.options.metaRefuses.add('prod-3')
    fake.calls.length = 0
    const result = await sync('meta', (await getConnection(HOST, 'meta'))!)
    expect(result).toMatchObject({ sent: 1, failed: 1, deleted: 1, errors: ['prod-3: Missing or invalid field: price'] })
    const requests = JSON.parse(String(fake.calls[0].body?.['requests'])) as Array<{ method: string; data: { id: string } }>
    expect(requests.map((request) => `${request.method}:${request.data.id}`)).toEqual([
      'UPDATE:prod-1',
      'UPDATE:prod-3',
      'DELETE:prod-2',
    ])
  })

  it('counts a whole chunk as failed when the edge is down, after retrying', async () => {
    fake.options.metaDown = true
    const result = await sync('meta')
    expect(result).toMatchObject({ sent: 0, failed: 2 })
    expect(result.errors[0]).toBe('prod-1: Service temporarily unavailable')
    expect(fake.calls.filter((call) => call.url.pathname.endsWith('/items_batch'))).toHaveLength(4)
  })
})

describe('the sync lease', () => {
  it('lets one sync hold it and refuses a second until it expires', async () => {
    await acquireSyncLease({ hostId: HOST, provider: 'google', uid: 'a', nowMs: NOW })
    await expect(acquireSyncLease({ hostId: HOST, provider: 'google', uid: 'b', nowMs: NOW + 1000 })).rejects.toBeInstanceOf(
      SyncBusyError,
    )
    await expect(acquireSyncLease({ hostId: HOST, provider: 'meta', uid: 'b', nowMs: NOW + 1000 })).resolves.toEqual([])
    await expect(
      acquireSyncLease({ hostId: HOST, provider: 'google', uid: 'b', nowMs: NOW + SYNC_LEASE_MS + 1 }),
    ).resolves.toEqual([])
  })

  it('refuses two syncs started together: exactly one runs', async () => {
    const connection = connected('meta')
    const outcomes = await Promise.allSettled([sync('meta', connection), sync('meta', connection)])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({ reason: expect.any(SyncBusyError) })
  })
})
