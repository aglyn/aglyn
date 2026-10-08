/**
 * @jest-environment node
 *
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

import { randomBytes } from 'node:crypto'
import { MARKETPLACES_ENV } from '../constants'
import { DEFAULT_SETTINGS } from '../model/marketplaces'
import { ProviderError } from '../providers/http'
import type { MarketplaceProvider } from '../providers/provider'
import { createMemoryMarketplaceStore } from '../testing/memory-store'
import { openGrant, readMarketplacesConfig } from './config'
import { createMarketplaceRoutes, type MarketplaceGateResult } from './routes'
import { emptyConnection, marketplaceOrderDocId } from './store'

const HOST = 'host1'
const T0 = 1_800_000_000_000
const KEY = randomBytes(32).toString('base64')

function setup(env: Record<string, string> = {}) {
  const store = createMemoryMarketplaceStore()
  const clock = { now: T0 }
  const config = readMarketplacesConfig({
    [MARKETPLACES_ENV.tokenKey]: KEY,
    [MARKETPLACES_ENV.ebayClientId]: 'ebay-id',
    [MARKETPLACES_ENV.ebayClientSecret]: 'ebay-secret',
    [MARKETPLACES_ENV.ebayRuName]: 'Aglyn-RuName',
    [MARKETPLACES_ENV.etsyKeystring]: 'etsy-key',
    [MARKETPLACES_ENV.etsySharedSecret]: 'etsy-secret',
    ...env,
  })
  const provider = {
    id: 'ebay',
    authorizeUrl: jest.fn((_app, input) => `https://auth.example.com/consent?state=${input.state}&challenge=${input.codeChallenge}`),
    exchangeCode: jest.fn(async () => ({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAtMs: T0 + 7200_000, refreshExpiresAtMs: T0 + 86_400_000 })),
    refresh: jest.fn(),
    account: jest.fn(async () => ({ accountName: 'pat-sells', account: { sellerId: 'seller-1' } })),
    syncListings: jest.fn(),
    listOrders: jest.fn(),
    confirmShipment: jest.fn(),
  } as unknown as MarketplaceProvider & Record<string, jest.Mock>
  const engine = { runConnection: jest.fn(async () => 'synced' as const), runOrder: jest.fn(async () => 'done' as const) }
  const gateCalls: string[] = []
  const activity: unknown[] = []
  let role = 'admin'
  const routes = createMarketplaceRoutes({
    now: () => clock.now,
    config: () => config,
    store,
    provider: () => provider,
    engine,
    gate: async (request, wanted) => {
      gateCalls.push(wanted)
      const rank: Record<string, number> = { viewer: 1, editor: 2, admin: 3 }
      if (rank[role] < rank[wanted]) return Response.json({ error: 'Not permitted' }, { status: 403 })
      const body = request.method === 'GET' ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>)
      return { orgId: 'org1', hostId: HOST, uid: 'u1', body } satisfies MarketplaceGateResult
    },
    consoleAddress: (path) => `https://console.example.com${path}`,
    logActivity: async (input) => void activity.push(input),
  })
  return { store, clock, config, provider, engine, routes, gateCalls, activity, setRole: (next: string) => (role = next) }
}

const post = (route: string, body: Record<string, unknown>, method = 'POST') =>
  new Request(`https://console.example.com/api/${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostId: HOST, ...body }),
  })
const get = (route: string, query: Record<string, string> = {}) =>
  new Request(`https://console.example.com/api/${route}?${new URLSearchParams({ hostId: HOST, ...query })}`)

async function connect(h: ReturnType<typeof setup>) {
  const started = await h.routes.connect(post('marketplaces/connect', { marketplace: 'ebay', returnTo: '/host1/products/settings' }))
  const { url } = (await started.json()) as { url: string }
  return new URL(url).searchParams.get('state') as string
}

describe('marketplace routes (AGL-3638)', () => {
  it('offers only the marketplaces whose app and the token key are set', async () => {
    const h = setup()
    const answer = await (await h.routes.list(get('marketplaces/connections'))).json()
    expect(answer).toEqual({ offered: [{ id: 'ebay', sandbox: false }, { id: 'etsy', sandbox: false }], connections: [] })
    expect(readMarketplacesConfig({ [MARKETPLACES_ENV.etsyKeystring]: 'k', [MARKETPLACES_ENV.etsySharedSecret]: 's' }).keyring).toBeNull()
  })

  it('starts a connect as an admin only, with a single-use state and a sealed PKCE verifier', async () => {
    const h = setup()
    h.setRole('editor')
    expect((await h.routes.connect(post('marketplaces/connect', { marketplace: 'ebay' }))).status).toBe(403)
    h.setRole('admin')
    expect((await h.routes.connect(post('marketplaces/connect', { marketplace: 'amazon' }))).status).toBe(404)
    const state = await connect(h)
    const stored = h.store.connections.get(`${HOST}_ebay`)!
    expect(state.startsWith(`${HOST}_ebay.`)).toBe(true)
    expect(stored.status).toBe('reconnect')
    expect(stored.connectedAtMs).toBeNull()
    expect(stored.pendingOAuth?.nonceHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(stored)).not.toContain(state.split('.')[1])
    const verifier = openGrant(stored.pendingOAuth!.sealedVerifierSecret, `${HOST}_ebay`, 'verifier', h.config.keyring!).value
    expect(verifier.length).toBeGreaterThanOrEqual(43)
  })

  it('connects on the redirect back, seals the grant, and refuses the same state twice', async () => {
    const h = setup()
    const state = await connect(h)
    const back = await h.routes.oauthCallback(new Request(`https://console.example.com/api/marketplaces/oauth/callback?state=${state}&code=abc`))
    expect(back.status).toBe(303)
    expect(back.headers.get('location')).toBe(
      'https://console.example.com/host1/products/settings?marketplace=ebay&marketplaceConnect=connected',
    )
    expect(h.provider.exchangeCode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'abc', redirectUri: 'https://console.example.com/api/marketplaces/oauth/callback' }),
    )
    const stored = h.store.connections.get(`${HOST}_ebay`)!
    expect(stored).toMatchObject({ status: 'active', accountName: 'pat-sells', account: { sellerId: 'seller-1' }, pendingOAuth: null })
    expect(stored.ordersSinceMs).toBe(T0 - 24 * 60 * 60 * 1000)
    expect(stored.sealedAccessToken).not.toContain('access-1')
    expect(openGrant(stored.sealedRefreshToken!, `${HOST}_ebay`, 'refresh', h.config.keyring!).value).toBe('refresh-1')
    expect(h.activity).toEqual([expect.objectContaining({ action: 'connected', marketplace: 'ebay' })])
    const again = await h.routes.oauthCallback(new Request(`https://console.example.com/api/marketplaces/oauth/callback?state=${state}&code=abc`))
    expect(again.status).toBe(400)
  })

  it('reads the code under each marketplace’s own name for it, and says declined or expired', async () => {
    const h = setup()
    let state = await connect(h)
    await h.routes.oauthCallback(new Request(`https://console.example.com/api/marketplaces/oauth/callback?state=${state}&authorizationCode=faire-code`))
    expect(h.provider.exchangeCode).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ code: 'faire-code' }))
    state = await connect(h)
    const declined = await h.routes.oauthCallback(new Request(`https://console.example.com/api/marketplaces/oauth/callback?state=${state}&error=access_denied`))
    expect(declined.headers.get('location')).toContain('marketplaceConnect=declined')
    state = await connect(h)
    h.clock.now += 11 * 60 * 1000
    const expired = await h.routes.oauthCallback(new Request(`https://console.example.com/api/marketplaces/oauth/callback?state=${state}&code=x`))
    expect(expired.headers.get('location')).toContain('marketplaceConnect=expired')
  })

  it('answers a failed exchange as failed without storing a grant', async () => {
    const h = setup()
    ;(h.provider.exchangeCode as jest.Mock).mockRejectedValueOnce(new ProviderError('invalid', 'bad code'))
    const state = await connect(h)
    const back = await h.routes.oauthCallback(new Request(`https://console.example.com/api/marketplaces/oauth/callback?state=${state}&code=x`))
    expect(back.headers.get('location')).toContain('marketplaceConnect=failed')
    expect(h.store.connections.get(`${HOST}_ebay`)!.sealedAccessToken).toBeNull()
  })

  async function connected() {
    const h = setup()
    await h.store.patchConnection(`${HOST}_ebay`, {
      ...emptyConnection({ orgId: 'org1', hostId: HOST, marketplace: 'ebay', sandbox: false, nowMs: T0 }),
      status: 'active',
      connectedAtMs: T0,
      sealedAccessToken: 'sealed',
    })
    return h
  }

  it('never shows a credential, a cursor or the account’s ids', async () => {
    const h = await connected()
    const answer = await (await h.routes.list(get('marketplaces/connections'))).json()
    expect(answer.connections).toHaveLength(1)
    const text = JSON.stringify(answer)
    for (const word of ['sealed', 'ordersSinceMs', 'pendingOAuth', 'leaseUntilMs', 'account"']) expect(text).not.toContain(word)
  })

  it('saves settings checked field by field, and refuses what the marketplace cannot do', async () => {
    const h = await connected()
    const saved = await h.routes.connection(post('marketplaces/connection', { marketplace: 'ebay', stockBuffer: 2, syncPrices: true, priceAdjustPercent: 12 }, 'PATCH'))
    expect(saved.status).toBe(200)
    expect((await saved.json()).connection.settings).toEqual({ ...DEFAULT_SETTINGS, stockBuffer: 2, syncPrices: true, priceAdjustPercent: 12 })
    expect(h.store.connections.get(`${HOST}_ebay`)!.listingsDueAtMs).toBe(T0)
    const bad = await h.routes.connection(post('marketplaces/connection', { marketplace: 'ebay', priceAdjustPercent: 500 }, 'PATCH'))
    expect(bad.status).toBe(400)
    await h.store.patchConnection(`${HOST}_etsy`, {
      ...emptyConnection({ orgId: 'org1', hostId: HOST, marketplace: 'etsy', sandbox: false, nowMs: T0 }),
      status: 'active',
      connectedAtMs: T0,
    })
    const publish = await h.routes.connection(post('marketplaces/connection', { marketplace: 'etsy', listingMode: 'publish' }, 'PATCH'))
    expect(publish.status).toBe(400)
    const paused = await h.routes.connection(post('marketplaces/connection', { marketplace: 'ebay', paused: true }, 'PATCH'))
    expect((await paused.json()).connection.status).toBe('paused')
  })

  it('disconnects, deleting the grant and keeping imported orders', async () => {
    const h = await connected()
    const orderId = marketplaceOrderDocId(HOST, 'ebay', '1001')
    await h.store.createOrder(orderId, { hostId: HOST, recordId: 'rec-1', status: 'imported' } as never)
    expect((await h.routes.connection(post('marketplaces/connection', { marketplace: 'ebay' }, 'DELETE'))).status).toBe(200)
    expect(h.store.connections.has(`${HOST}_ebay`)).toBe(false)
    expect(h.store.orders.has(orderId)).toBe(true)
    expect(h.activity).toEqual([expect.objectContaining({ action: 'disconnected' })])
  })

  it('syncs now for an admin, not while paused or waiting to reconnect', async () => {
    const h = await connected()
    expect((await h.routes.syncNow(post('marketplaces/sync-now', { marketplace: 'ebay' }))).status).toBe(200)
    expect(h.engine.runConnection).toHaveBeenCalledWith(`${HOST}_ebay`, { force: true })
    await h.store.patchConnection(`${HOST}_ebay`, { status: 'reconnect' })
    expect((await h.routes.syncNow(post('marketplaces/sync-now', { marketplace: 'ebay' }))).status).toBe(409)
  })

  it('lists the listings to look at, refusals first', async () => {
    const h = await connected()
    await h.store.writeListingState(`${HOST}_ebay`, {
      c00: {
        a: { s: 'A', t: 'Alpha', q: 1, p: null, o: 'not_listed', x: null, m: null, at: T0 },
        b: { s: 'B', t: 'Beta', q: 1, p: null, o: 'failed', x: null, m: 'Needs a brand', at: T0 },
        c: { s: 'C', t: 'Gamma', q: 1, p: null, o: 'updated', x: 'x', m: null, at: T0 },
      },
    })
    const answer = await (await h.routes.activity(get('marketplaces/activity', { marketplace: 'ebay' }))).json()
    expect(answer.problems.map((problem: { sku: string }) => problem.sku)).toEqual(['B', 'A'])
    expect(answer.problemsTotal).toBe(2)
  })

  it('shows a viewer where an order stands with its marketplace, and lets an editor send tracking again', async () => {
    const h = await connected()
    const orderId = marketplaceOrderDocId(HOST, 'ebay', '1001')
    await h.store.createOrder(orderId, {
      orgId: 'org1',
      hostId: HOST,
      marketplace: 'ebay',
      connectionId: `${HOST}_ebay`,
      externalOrderId: '1001',
      displayRef: '#1001',
      recordId: 'rec-1',
      status: 'imported',
      note: null,
      lines: [{ lineIndex: 0, externalLineId: 'L1' }],
      acknowledged: true,
      currency: 'USD',
      fees: [{ label: 'eBay fees', amountMinor: 120 }],
      feesFollowUntilMs: 0,
      shipments: { f1: { lines: [{ lineIndex: 0, quantity: 1 }], carrier: 'UPS', trackingNumber: '1Z', trackingUrl: null, atMs: T0, state: 'failed', message: 'Refused', attempts: 1 } },
      sandbox: false,
      active: false,
      nextRunAtMs: T0,
      leaseUntilMs: 0,
      createdAtMs: T0,
      updatedAtMs: T0,
    })
    h.setRole('viewer')
    const view = await (await h.routes.order(get('marketplaces/order', { recordId: 'rec-1' }))).json()
    expect(view.order).toMatchObject({ marketplace: 'ebay', feesTotalMinor: 120, shipments: [{ state: 'failed', message: 'Refused' }] })
    expect((await h.routes.orderRetry(post('marketplaces/order/retry', { recordId: 'rec-1' }))).status).toBe(403)
    h.setRole('editor')
    expect((await h.routes.orderRetry(post('marketplaces/order/retry', { recordId: 'rec-1' }))).status).toBe(200)
    expect(h.store.orders.get(orderId)?.shipments['f1']).toMatchObject({ state: 'pending', attempts: 0 })
    expect(h.engine.runOrder).toHaveBeenCalledWith(orderId, { force: true })
    const none = await (await h.routes.order(get('marketplaces/order', { recordId: 'web-order' }))).json()
    expect(none).toEqual({ order: null })
  })
})
