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
  type PluginProductCatalog,
} from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { makeOffer, makeStore } from '../testing/catalog-fixtures'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import {
  channelRoute,
  diagnosticsRoute,
  feedUrl,
  legacyFeedActive,
  legacyRoute,
  rotateRoute,
  settingsRoute,
  stateRoute,
} from './console-routes'
import { salesChannel } from '../model/channels'

/**
 * The sales channels card's routes (AGL-3637), through their HTTP surface:
 * the gate each climbs (unauthenticated, unverified, no site, a role too
 * low, a plan that does not sell, a wrong method) and each route's own work
 * against an in-memory Firestore and a recorded catalog.
 */

const HOST = 'host-candles'
let db: MemoryFirestore
let entitled = true
let commerceOn = true

const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-viewer': { uid: 'uid-viewer', email_verified: true },
  'tok-editor': { uid: 'uid-editor', email_verified: true },
  'tok-admin': { uid: 'uid-admin', email_verified: true },
  'tok-staff': { uid: 'uid-staff', email_verified: true, staff: true },
  'tok-outsider': { uid: 'uid-outsider', email_verified: true },
  'tok-unverified': { uid: 'uid-editor', email_verified: false },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => db,
      auth: () => ({
        verifyIdToken: async (token: string) => {
          const decoded = TOKENS[token]
          if (!decoded) throw new Error('auth/argument-error')
          return decoded
        },
      }),
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles'
      ? {
          orgId: 'org-candles',
          org: { enabledPlugins: commerceOn ? ['commerce'] : [] },
        }
      : null,
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: () => entitled,
}))

let offers = [makeOffer(), makeOffer({ id: 'p2', productId: 'p2', productName: 'No Photo', imageUrl: undefined })]
const catalog: PluginProductCatalog = {
  store: async (hostId) => (hostId === HOST ? makeStore() : null),
  page: async () => ({ offers, nextCursor: null }),
}

const get = (route: (request: Request) => Promise<Response>, token: string, query = `hostId=${HOST}`) =>
  route(
    new Request(`https://console.example.com/api/x?${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

const post = (route: (request: Request) => Promise<Response>, token: string, body: Record<string, unknown>) =>
  route(
    new Request('https://console.example.com/api/x', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ hostId: HOST, ...body }),
    }),
  )

const feedDoc = (channel: string) => db.docs.get(`hosts/${HOST}/salesChannels/feed-${channel}`)

beforeEach(() => {
  db = createMemoryFirestore()
  db.docs.set(`hosts/${HOST}`, {
    memberRoles: { 'uid-viewer': 'viewer', 'uid-editor': 'editor', 'uid-admin': 'admin' },
  })
  entitled = true
  commerceOn = true
  offers = [makeOffer(), makeOffer({ id: 'p2', productId: 'p2', productName: 'No Photo', imageUrl: undefined })]
  resetPluginServicesForTests()
  registerPluginProductCatalog(catalog, { pluginId: 'commerce' })
})

describe('the gate', () => {
  it.each([
    ['no token', '', 401],
    ['a refused token', 'tok-nobody', 401],
    ['an unverified address', 'tok-unverified', 403],
    ['an outsider', 'tok-outsider', 403],
  ])('refuses %s', async (_label, token, status) => {
    expect((await get(stateRoute, token)).status).toBe(status)
  })

  it('refuses a missing or unknown site', async () => {
    expect((await get(stateRoute, 'tok-viewer', '')).status).toBe(400)
    expect((await get(stateRoute, 'tok-viewer', 'hostId=host-other')).status).toBe(404)
  })

  it('refuses a plan that does not sell', async () => {
    entitled = false
    const response = await get(stateRoute, 'tok-admin')
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatch(/commerce/)
  })

  it('lets staff in without a site role', async () => {
    expect((await get(stateRoute, 'tok-staff')).status).toBe(200)
  })

  it.each([
    ['switching a feed', channelRoute, 'tok-viewer', { channel: 'google', enabled: true }],
    ['replacing an address', rotateRoute, 'tok-editor', { channel: 'google' }],
    ['retiring the old address', legacyRoute, 'tok-editor', {}],
    ['saving the defaults', settingsRoute, 'tok-viewer', { settings: {} }],
  ])('needs the right role for %s', async (_label, route, token, body) => {
    expect((await post(route, token, body)).status).toBe(403)
  })

  it('refuses the wrong method', async () => {
    expect((await post(stateRoute, 'tok-admin', {})).status).toBe(405)
    expect((await get(channelRoute, 'tok-admin')).status).toBe(405)
  })
})

describe('state', () => {
  it('lists every channel off, the legacy address live, and no API connections when none is configured', async () => {
    const response = await get(stateRoute, 'tok-viewer')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body.sells).toBe(true)
    expect(body.channels.map((channel: { id: string }) => channel.id)).toEqual([
      'google',
      'meta',
      'tiktok',
      'pinterest',
      'snapchat',
      'microsoft',
    ])
    expect(body.channels.every((channel: { enabled: boolean; url: unknown }) => !channel.enabled && !channel.url)).toBe(true)
    expect(body.legacy).toEqual({
      url: `https://candles.example.com/api/commerce/feed?hostId=${HOST}`,
      active: true,
    })
    expect(body.settings).toEqual({ defaultBrand: '', defaultCondition: 'new', defaultGoogleCategory: '' })
    expect(body.connect).toBeUndefined()
  })

  it('says the site does not sell when commerce is off for it', async () => {
    commerceOn = false
    expect((await (await get(stateRoute, 'tok-viewer')).json()).sells).toBe(false)
  })
})

describe('switching a feed', () => {
  it('mints a token the first time and keeps it after, so a channel’s address survives off and on', async () => {
    const on = await (await post(channelRoute, 'tok-editor', { channel: 'meta', enabled: true })).json()
    const token = feedDoc('meta')!['token']
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(on.channel).toMatchObject({ id: 'meta', enabled: true })
    expect(on.channel.url).toBe(`https://candles.example.com/api/sales-channels/feed/meta/${token}.xml?hostId=${HOST}`)
    await post(channelRoute, 'tok-editor', { channel: 'meta', enabled: false })
    expect(feedDoc('meta')).toMatchObject({ enabled: false, token })
    await post(channelRoute, 'tok-editor', { channel: 'meta', enabled: true })
    expect(feedDoc('meta')).toMatchObject({ enabled: true, token })
  })

  it('gives each channel its own token', async () => {
    await post(channelRoute, 'tok-editor', { channel: 'google', enabled: true })
    await post(channelRoute, 'tok-editor', { channel: 'tiktok', enabled: true })
    expect(feedDoc('google')!['token']).not.toBe(feedDoc('tiktok')!['token'])
  })

  it('refuses an unknown channel, a missing switch, and switching on where commerce is off', async () => {
    expect((await post(channelRoute, 'tok-editor', { channel: 'amazon', enabled: true })).status).toBe(400)
    expect((await post(channelRoute, 'tok-editor', { channel: 'google' })).status).toBe(400)
    commerceOn = false
    expect((await post(channelRoute, 'tok-editor', { channel: 'google', enabled: true })).status).toBe(409)
    // Switching off is always allowed.
    expect((await post(channelRoute, 'tok-editor', { channel: 'google', enabled: false })).status).toBe(200)
  })
})

describe('replacing an address', () => {
  it('replaces the token at once and forgets when the old one was read', async () => {
    await post(channelRoute, 'tok-editor', { channel: 'pinterest', enabled: true })
    const before = feedDoc('pinterest')!['token']
    db.docs.set(`hosts/${HOST}/salesChannels/feed-pinterest`, { ...feedDoc('pinterest'), lastFetchAtMs: 5 })
    const answer = await (await post(rotateRoute, 'tok-admin', { channel: 'pinterest' })).json()
    const after = feedDoc('pinterest')!
    expect(after['token']).not.toBe(before)
    expect(after['lastFetchAtMs']).toBeUndefined()
    expect(after).toMatchObject({ rotatedBy: 'uid-admin', enabled: true })
    expect(answer.channel.url).toContain(`${after['token']}.tsv`)
  })

  it('retires the pre-channels Google address along with Google’s', async () => {
    await post(channelRoute, 'tok-editor', { channel: 'google', enabled: true })
    await post(rotateRoute, 'tok-admin', { channel: 'google' })
    expect(feedDoc('google')!['legacyRetired']).toBe(true)
    const state = await (await get(stateRoute, 'tok-viewer')).json()
    expect(state.legacy.active).toBe(false)
  })

  it('refuses a feed that was never switched on', async () => {
    expect((await post(rotateRoute, 'tok-admin', { channel: 'google' })).status).toBe(409)
  })
})

describe('the pre-channels address', () => {
  it('is retired without touching the channel’s own feed', async () => {
    await post(channelRoute, 'tok-editor', { channel: 'google', enabled: true })
    const token = feedDoc('google')!['token']
    const answer = await (await post(legacyRoute, 'tok-admin', {})).json()
    expect(answer.legacy.active).toBe(false)
    expect(feedDoc('google')).toMatchObject({ enabled: true, token, legacyRetired: true })
  })

  it('can be retired before the Google channel is set up, leaving it off', async () => {
    await post(legacyRoute, 'tok-admin', {})
    expect(feedDoc('google')).toMatchObject({ enabled: false, legacyRetired: true })
  })

  it('answers when the channel was never set up, and follows its switch after', () => {
    expect(legacyFeedActive(null)).toBe(true)
    expect(legacyFeedActive({ enabled: true } as never)).toBe(true)
    expect(legacyFeedActive({ enabled: false } as never)).toBe(false)
    expect(legacyFeedActive({ enabled: true, legacyRetired: true } as never)).toBe(false)
  })
})

describe('the defaults', () => {
  it('are saved normalized and read back', async () => {
    const answer = await (
      await post(settingsRoute, 'tok-editor', {
        settings: { defaultBrand: '  Wick  Co ', defaultCondition: 'refurbished', defaultGoogleCategory: '2271' },
      })
    ).json()
    expect(answer.settings).toEqual({ defaultBrand: 'Wick Co', defaultCondition: 'refurbished', defaultGoogleCategory: '2271' })
    const state = await (await get(stateRoute, 'tok-viewer')).json()
    expect(state.settings.defaultBrand).toBe('Wick Co')
    expect(db.docs.get(`hosts/${HOST}/salesChannels/settings`)).toMatchObject({ updatedBy: 'uid-editor' })
  })

  it('refuse a body with no settings', async () => {
    expect((await post(settingsRoute, 'tok-editor', {})).status).toBe(400)
  })
})

describe('diagnostics', () => {
  it('reads the catalog and says what each feed leaves out', async () => {
    const body = await (await get(diagnosticsRoute, 'tok-viewer')).json()
    expect(body.offers).toBe(2)
    const google = body.channels.find((channel: { channel: string }) => channel.channel === 'google')
    expect(google).toMatchObject({ listed: 1, excluded: 1 })
    expect(google.products[0].productName).toBe('No Photo')
  })

  it('answers 409 where no plugin keeps a catalog', async () => {
    resetPluginServicesForTests()
    expect((await get(diagnosticsRoute, 'tok-viewer')).status).toBe(409)
  })
})

describe('feedUrl', () => {
  it('is on the store origin, names the file by token and extension, and needs an address', () => {
    expect(feedUrl({ origin: 'https://shop.example.com' }, 'h1', salesChannel('microsoft')!, 'T'.repeat(43))).toBe(
      `https://shop.example.com/api/sales-channels/feed/microsoft/${'T'.repeat(43)}.txt?hostId=h1`,
    )
    expect(feedUrl({ origin: null }, 'h1', salesChannel('google')!, 'T')).toBeNull()
  })
})
