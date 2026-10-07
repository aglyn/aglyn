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

import {
  registerPluginProductCatalog,
  type CatalogOffer,
  type CatalogPage,
  type PluginProductCatalog,
} from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { makeOffer, makeStore } from '../testing/catalog-fixtures'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { FETCH_STAMP_INTERVAL_MS } from './feed-store'
import { feedRoute, legacyGoogleFeedRoute, parseFeedFile } from './feed-route'

/**
 * The feed a channel fetches (AGL-3637), through its HTTP surface: the token
 * that locks it, the one 404 every refusal answers, the site gates a machine
 * route asks itself, a catalog streamed page by page, a page that fails
 * mid-file, and the pre-channels Google address.
 */

const HOST = 'host-candles'
const TOKEN = 'A'.repeat(43)
let db: MemoryFirestore

/** What the site gates read, per spec. */
const site = {
  exists: true,
  enabledPlugins: ['commerce', 'sales-channels'] as string[],
  disabledPlugins: [] as string[],
  released: ['commerce', 'sales-channels'] as string[],
  entitled: true,
  takenDown: false,
}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles' && site.exists
      ? { orgId: 'org-candles', org: { enabledPlugins: site.enabledPlugins } }
      : null,
  getHostDocAdmin: async (hostId: string) =>
    hostId === 'host-candles' && site.exists ? { disabledPlugins: site.disabledPlugins } : null,
  filterEnabledPluginsByReleaseFlags: async (ids: string[]) => ids.filter((id) => site.released.includes(id)),
  visitorContentRefusal: async () =>
    site.takenDown ? new Response('Site unavailable', { status: 451 }) : null,
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: () => site.entitled,
}))

jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: { read: () => Promise<unknown> }) => options.read(),
}))

/** A catalog whose pages the spec writes, recording each read. */
let pages: Array<CatalogPage | Error>
let pageReads: Array<string | null>
const catalog: PluginProductCatalog = {
  store: async (hostId) => (hostId === HOST ? makeStore() : null),
  page: async ({ cursor }) => {
    pageReads.push(cursor ?? null)
    const index = cursor ? Number(cursor) : 0
    const page = pages[index]
    if (page instanceof Error) throw page
    return page
  },
}

const offer = (n: number, overrides: Partial<CatalogOffer> = {}) =>
  makeOffer({ id: `p${n}`, productId: `p${n}`, groupId: `p${n}`, title: `Candle ${n}`, ...overrides })

const feedRequest = (path: string, init?: RequestInit) =>
  new Request(`https://candles.example.com/api/sales-channels/feed/${path}`, init)

const call = (channel: string, file: string, hostId = HOST, init?: RequestInit) =>
  feedRoute(feedRequest(`${channel}/${file}?hostId=${hostId}`, init), { channel, file })

function seedFeed(channel: string, data: Record<string, unknown> = {}) {
  db.docs.set(`hosts/${HOST}/salesChannels/feed-${channel}`, {
    channel,
    enabled: true,
    token: TOKEN,
    createdAtMs: 1,
    createdBy: 'uid-admin',
    ...data,
  })
}

beforeEach(() => {
  db = createMemoryFirestore()
  resetPluginServicesForTests()
  registerPluginProductCatalog(catalog, { pluginId: 'commerce' })
  pages = [{ offers: [offer(1), offer(2)], nextCursor: null }]
  pageReads = []
  Object.assign(site, {
    exists: true,
    enabledPlugins: ['commerce', 'sales-channels'],
    disabledPlugins: [],
    released: ['commerce', 'sales-channels'],
    entitled: true,
    takenDown: false,
  })
})

describe('parseFeedFile', () => {
  it('reads a token and an extension, and nothing else', () => {
    expect(parseFeedFile(`${TOKEN}.xml`)).toEqual({ token: TOKEN, extension: 'xml' })
    expect(parseFeedFile('short.xml')).toBeNull()
    expect(parseFeedFile(`${TOKEN}.xml.gz`)).toBeNull()
    expect(parseFeedFile(`../${TOKEN}.xml`)).toBeNull()
  })
})

describe('feedRoute', () => {
  it('serves the channel’s file with its content type, never cached by a CDN', async () => {
    seedFeed('google')
    const response = await call('google', `${TOKEN}.xml`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const xml = await response.text()
    expect(xml.match(/<item>/g)).toHaveLength(2)
    expect(xml.trimEnd().endsWith('</rss>')).toBe(true)
  })

  it.each([
    ['a wrong token', 'google', `${'B'.repeat(43)}.xml`],
    ['a wrong extension', 'google', `${TOKEN}.csv`],
    ['an unknown channel', 'amazon', `${TOKEN}.xml`],
    ['a malformed file', 'google', 'feed.xml'],
  ])('answers 404 for %s', async (_label, channel, file) => {
    seedFeed('google')
    const response = await call(channel, file)
    expect(response.status).toBe(404)
    expect(pageReads).toEqual([])
  })

  it('answers 404 for a feed switched off, never set up, or for another site', async () => {
    expect((await call('google', `${TOKEN}.xml`)).status).toBe(404)
    seedFeed('google', { enabled: false })
    expect((await call('google', `${TOKEN}.xml`)).status).toBe(404)
    seedFeed('google')
    expect((await call('google', `${TOKEN}.xml`, 'host-other')).status).toBe(404)
    expect((await call('google', `${TOKEN}.xml`, 'a/b')).status).toBe(404)
  })

  it('does not serve one channel’s token on another channel', async () => {
    seedFeed('meta')
    expect((await call('google', `${TOKEN}.xml`)).status).toBe(404)
    expect((await call('meta', `${TOKEN}.xml`)).status).toBe(200)
  })

  it.each([
    ['commerce switched off', { enabledPlugins: ['sales-channels'] }],
    ['the plugin switched off for the site', { disabledPlugins: ['sales-channels'] }],
    ['the plugin unreleased', { released: ['commerce'] }],
    ['a plan that does not sell', { entitled: false }],
  ])('answers a bare 404 with %s', async (_label, change) => {
    seedFeed('google')
    Object.assign(site, change)
    const response = await call('google', `${TOKEN}.xml`)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not found')
  })

  it('stops a taken-down site’s feed the way it stops its pages', async () => {
    seedFeed('google')
    site.takenDown = true
    expect((await call('google', `${TOKEN}.xml`)).status).toBe(451)
  })

  it('refuses a write method', async () => {
    seedFeed('google')
    const response = await call('google', `${TOKEN}.xml`, HOST, { method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })

  it('answers HEAD with headers and no catalog walk past the first page', async () => {
    seedFeed('tiktok')
    pages = [
      { offers: [offer(1)], nextCursor: '1' },
      { offers: [offer(2)], nextCursor: null },
    ]
    const response = await call('tiktok', `${TOKEN}.csv`, HOST, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(await response.text()).toBe('')
    expect(pageReads).toEqual([null])
  })

  it('streams every page of a large catalog, reading each once', async () => {
    seedFeed('pinterest')
    pages = [
      { offers: [offer(1), offer(2)], nextCursor: '1' },
      { offers: [offer(3), offer(4, { imageUrl: undefined })], nextCursor: '2' },
      { offers: [offer(5)], nextCursor: null },
    ]
    const response = await call('pinterest', `${TOKEN}.tsv`)
    const lines = (await response.text()).trimEnd().split('\n')
    expect(lines[0].startsWith('id\ttitle')).toBe(true)
    expect(lines.slice(1).map((line) => line.split('\t')[0])).toEqual(['p1', 'p2', 'p3', 'p5'])
    expect(pageReads).toEqual([null, '1', '2'])
  })

  it('answers 503 when the first page cannot be read', async () => {
    seedFeed('google')
    pages = [new Error('deadline exceeded')]
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await call('google', `${TOKEN}.xml`)
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('300')
    errors.mockRestore()
  })

  it('errors the stream, rather than ending the file, when a later page fails', async () => {
    seedFeed('google')
    pages = [{ offers: [offer(1)], nextCursor: '1' }, new Error('deadline exceeded')]
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await call('google', `${TOKEN}.xml`)
    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toThrow('deadline exceeded')
    errors.mockRestore()
  })

  it('notes when a channel read the feed, at most once per interval', async () => {
    seedFeed('google')
    const agent = { headers: { 'user-agent': 'Googlebot-Merchant' } }
    await (await call('google', `${TOKEN}.xml`, HOST, agent)).text()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const first = db.docs.get(`hosts/${HOST}/salesChannels/feed-google`)!
    expect(first['lastFetchAgent']).toBe('Googlebot-Merchant')
    const stamped = first['lastFetchAtMs']
    expect(stamped).toBeGreaterThan(0)
    await (await call('google', `${TOKEN}.xml`, HOST, { headers: { 'user-agent': 'other' } })).text()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(db.docs.get(`hosts/${HOST}/salesChannels/feed-google`)!['lastFetchAgent']).toBe('Googlebot-Merchant')
    expect(FETCH_STAMP_INTERVAL_MS).toBeGreaterThanOrEqual(60_000)
  })

  it('answers 404 on a deployment where no plugin keeps a catalog', async () => {
    seedFeed('google')
    resetPluginServicesForTests()
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await call('google', `${TOKEN}.xml`)).status).toBe(404)
    errors.mockRestore()
  })
})

describe('legacyGoogleFeedRoute', () => {
  const legacy = (init?: RequestInit) =>
    legacyGoogleFeedRoute(new Request(`https://candles.example.com/api/commerce/feed?hostId=${HOST}`, init), HOST)

  it('keeps answering with the Google feed for a store that never set up the channel', async () => {
    const response = await legacy()
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<g:id>p1</g:id>')
  })

  it('follows the Google feed’s switch once it is set up', async () => {
    seedFeed('google', { enabled: false })
    expect((await legacy()).status).toBe(404)
    seedFeed('google', { enabled: true })
    expect((await legacy()).status).toBe(200)
  })

  it('stops for good once retired', async () => {
    seedFeed('google', { legacyRetired: true })
    expect((await legacy()).status).toBe(404)
  })

  it('still asks the site gates', async () => {
    site.disabledPlugins = ['sales-channels']
    expect((await legacy()).status).toBe(404)
  })

  it('refuses a malformed site id', async () => {
    const response = await legacyGoogleFeedRoute(new Request('https://x.example.com/api/commerce/feed'), '')
    expect(response.status).toBe(400)
  })
})
