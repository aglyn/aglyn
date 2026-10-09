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

import { createHmac, randomBytes } from 'node:crypto'
import { FULFILLMENT_NETWORKS_ENV } from '../constants'
import { networkConnectionId, networkOrderId } from '../model/networks'
import { ProviderError } from '../providers/http'
import type { FulfillmentNetworkProvider } from '../providers/provider'
import { createMemoryNetworkStore } from '../testing/memory-store'
import { mockHttp } from '../testing/mock-http'
import { openGrant, readFulfillmentNetworksConfig } from './config'
import type { Engine } from './engine'
import { readOAuthState, sha256 } from './oauth'
import { createNetworkRoutes, fail, type NetworkGateResult, type NetworkRole } from './routes'
import { emptyConnection, type StoredRouting } from './store'

const HOST = 'host-1'
const CONSOLE = 'https://console.example'
const KEY = randomBytes(32).toString('base64')

const ENV = {
  [FULFILLMENT_NETWORKS_ENV.tokenKey]: KEY,
  [FULFILLMENT_NETWORKS_ENV.shipbobClientId]: 'sb-client',
  [FULFILLMENT_NETWORKS_ENV.shipbobClientSecret]: 'sb-secret',
  [FULFILLMENT_NETWORKS_ENV.amazonApplicationId]: 'amzn1.sp.solution.app',
  [FULFILLMENT_NETWORKS_ENV.amazonClientId]: 'amzn1.application-oa2-client.x',
  [FULFILLMENT_NETWORKS_ENV.amazonClientSecret]: 'lwa-secret',
}

function harness(options: { env?: Record<string, string>; role?: NetworkRole } = {}) {
  const store = createMemoryNetworkStore()
  const env = options.env ?? ENV
  const { http, calls } = mockHttp([
    {
      method: 'POST',
      match: 'auth.shipbob.com/connect/token',
      body: { access_token: 'sb-access', refresh_token: 'sb-refresh', expires_in: 3600 },
    },
    {
      method: 'POST',
      match: 'api.amazon.com/auth/o2/token',
      body: { access_token: 'Atza|access', refresh_token: 'Atzr|refresh', expires_in: 3600 },
    },
  ])
  const webhookTargets: Array<{ prefix: string; url: string | null }> = []
  const accountCalls: unknown[] = []
  const provider = (id: 'shipbob' | 'amazon-mcf' | 'shipmonk'): FulfillmentNetworkProvider =>
    ({
      id,
      account: jest.fn(async (credential: { accessToken: string; storeId?: string | null }) => {
        accountCalls.push(credential)
        if (id === 'shipmonk') {
          if (credential.accessToken === 'sm-refused') throw new ProviderError('auth', 'ShipMonk refused the connection: Invalid API key')
          if (credential.accessToken === 'sm-down-key') throw new ProviderError('transient', 'ShipMonk could not be reached')
          return { accountName: `Store ${credential.storeId}` }
        }
        return id === 'shipbob'
          ? { accountName: 'Aglyn channel', channelId: 'ch-5' }
          : { accountName: 'Candles', marketplaces: [{ id: 'ATVPDKIKX0DER', name: 'Amazon.com', countryCode: 'US' }] }
      }),
      ...(id === 'shipbob'
        ? {
            syncWebhooks: jest.fn(async (_credential: unknown, target: { prefix: string; url: string | null }) => {
              webhookTargets.push(target)
            }),
          }
        : {}),
    }) as unknown as FulfillmentNetworkProvider
  const engine = {
    runRouting: jest.fn(async () => 'sent'),
    runDue: jest.fn(),
    runInventory: jest.fn(async () => 'counted'),
    applyShipbobEvent: jest.fn(async () => 'applied'),
    applyOrderWebhook: jest.fn(async () => 'applied'),
  } as unknown as Engine & {
    runRouting: jest.Mock
    runInventory: jest.Mock
    applyShipbobEvent: jest.Mock
    applyOrderWebhook: jest.Mock
  }
  let gateRole: NetworkRole = options.role ?? 'admin'
  const activity: unknown[] = []
  const routes = createNetworkRoutes({
    now: () => 1_000_000,
    config: () => readFulfillmentNetworksConfig(env),
    store,
    provider,
    http,
    engine,
    credential: async () => ({ accessToken: 'opened', channelId: 'ch-5' }),
    gate: async (request: Request, role: NetworkRole): Promise<NetworkGateResult | Response> => {
      const rank = { viewer: 1, editor: 2, admin: 3 }
      if (rank[gateRole] < rank[role]) return fail(403, 'Not permitted')
      const body = request.method === 'GET' ? {} : ((await request.clone().json().catch(() => ({}))) as Record<string, unknown>)
      return { orgId: 'org-1', hostId: HOST, uid: 'uid-1', body }
    },
    consoleAddress: (path) => `${CONSOLE}${path}`,
    logActivity: async (input) => void activity.push(input),
  })
  return {
    routes,
    store,
    calls,
    engine,
    webhookTargets,
    activity,
    accountCalls,
    env,
    setRole: (role: NetworkRole) => {
      gateRole = role
    },
  }
}

const post = (path: string, body: Record<string, unknown>, method = 'POST') =>
  new Request(`${CONSOLE}/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostId: HOST, ...body }) })
const get = (path: string, query: Record<string, string> = {}) =>
  new Request(`${CONSOLE}/api/${path}?${new URLSearchParams({ hostId: HOST, ...query }).toString()}`)

async function connectShipbob(h: ReturnType<typeof harness>) {
  const start = await h.routes.connect(post('fulfillment-networks/connect', { provider: 'shipbob', returnTo: '/acme/store/settings' }))
  const { url } = await start.json()
  const state = new URL(url).searchParams.get('state') as string
  const form = new URLSearchParams({ code: 'sb-code', id_token: 'jwt', state })
  return h.routes.oauthCallback(
    new Request(`${CONSOLE}/api/fulfillment-networks/oauth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }),
  )
}

describe('what the store settings offer (AGL-3634)', () => {
  it('offers nothing where the deployment has no token key or app', async () => {
    const none = harness({ env: { [FULFILLMENT_NETWORKS_ENV.shipbobClientId]: 'a', [FULFILLMENT_NETWORKS_ENV.shipbobClientSecret]: 'b' } })
    await expect((await none.routes.list(get('fulfillment-networks/connections'))).json()).resolves.toEqual({ offered: [], connections: [] })
    const refused = await none.routes.connect(post('fulfillment-networks/connect', { provider: 'shipbob' }))
    expect(refused.status).toBe(404)
  })

  it('offers each network whose app is set, and never a credential', async () => {
    const h = harness()
    await connectShipbob(h)
    const answer = await (await h.routes.list(get('fulfillment-networks/connections'))).json()
    expect(answer.offered).toEqual([
      { id: 'shipbob', sandbox: false },
      { id: 'amazon-mcf', sandbox: false },
    ])
    expect(answer.connections).toEqual([expect.objectContaining({ provider: 'shipbob', status: 'active', accountName: 'Aglyn channel' })])
    expect(JSON.stringify(answer)).not.toMatch(/sealed|sb-access|sb-refresh|webhookToken|pendingOAuth/)
  })
})

describe('connecting (AGL-3634)', () => {
  it('only an admin starts a connect, to the network’s consent page with a single-use state', async () => {
    const h = harness({ role: 'editor' })
    expect((await h.routes.connect(post('fulfillment-networks/connect', { provider: 'shipbob' }))).status).toBe(403)
    h.setRole('admin')
    const answer = await (await h.routes.connect(post('fulfillment-networks/connect', { provider: 'shipbob', returnTo: '//evil.example' }))).json()
    const url = new URL(answer.url)
    expect(url.origin + url.pathname).toBe('https://auth.shipbob.com/connect/authorize')
    expect(url.searchParams.get('client_id')).toBe('sb-client')
    expect(url.searchParams.get('redirect_uri')).toBe(`${CONSOLE}/api/fulfillment-networks/oauth/callback`)
    expect(url.searchParams.get('scope')).toContain('orders_write')
    expect(url.searchParams.get('response_mode')).toBe('form_post')
    const state = readOAuthState(url.searchParams.get('state'))
    const stored = h.store.connections.get(networkConnectionId(HOST, 'shipbob'))
    expect(stored?.pendingOAuth).toMatchObject({ nonceHash: sha256(state?.nonce as string), returnTo: '/' })
    expect(JSON.stringify(stored)).not.toContain(state?.nonce as string)
  })

  it('finishes a ShipBob connect: the grant sealed, the channel read, webhooks pointed at a token address', async () => {
    const h = harness()
    const back = await connectShipbob(h)
    expect(back.status).toBe(303)
    expect(back.headers.get('location')).toBe(`${CONSOLE}/acme/store/settings?fulfillmentNetwork=connected`)
    const id = networkConnectionId(HOST, 'shipbob')
    const stored = h.store.connections.get(id)!
    expect(stored).toMatchObject({ status: 'active', channelId: 'ch-5', pendingOAuth: null, accessTokenExpiresAtMs: 1_000_000 + 3_600_000 })
    const keyring = readFulfillmentNetworksConfig(ENV).keyring!
    expect(openGrant(stored.sealedAccessToken as string, id, 'access', keyring).value).toBe('sb-access')
    expect(openGrant(stored.sealedRefreshToken as string, id, 'refresh', keyring).value).toBe('sb-refresh')
    expect(JSON.stringify(stored)).not.toMatch(/sb-access|sb-refresh/)
    const exchange = new URLSearchParams(h.calls[0].body as string)
    expect(Object.fromEntries(exchange)).toEqual({
      grant_type: 'authorization_code',
      code: 'sb-code',
      redirect_uri: `${CONSOLE}/api/fulfillment-networks/oauth/callback`,
      client_id: 'sb-client',
      client_secret: 'sb-secret',
    })
    const [target] = h.webhookTargets
    expect(target.prefix).toBe(`${CONSOLE}/api/fulfillment-networks/webhooks/shipbob?connection=${id}`)
    const token = new URL(target.url as string).searchParams.get('token') as string
    expect(stored.webhookTokenHash).toBe(sha256(token))
    expect(h.activity).toEqual([expect.objectContaining({ action: 'connected', provider: 'shipbob' })])
  })

  it('finishes an Amazon connect from Seller Central’s redirect, choosing the one marketplace', async () => {
    const h = harness()
    const start = await (await h.routes.connect(post('fulfillment-networks/connect', { provider: 'amazon-mcf' }))).json()
    const consent = new URL(start.url)
    expect(consent.origin + consent.pathname).toBe('https://sellercentral.amazon.com/apps/authorize/consent')
    expect(consent.searchParams.get('application_id')).toBe('amzn1.sp.solution.app')
    const state = consent.searchParams.get('state') as string
    const back = await h.routes.oauthCallback(
      new Request(
        `${CONSOLE}/api/fulfillment-networks/oauth/callback?${new URLSearchParams({ state, spapi_oauth_code: 'amz-code', selling_partner_id: 'A1' })}`,
      ),
    )
    expect(back.headers.get('location')).toContain('fulfillmentNetwork=connected')
    expect(h.calls[0].url).toBe('https://api.amazon.com/auth/o2/token')
    expect(h.store.connections.get(networkConnectionId(HOST, 'amazon-mcf'))).toMatchObject({
      status: 'active',
      marketplaceId: 'ATVPDKIKX0DER',
      accountName: 'Candles',
      webhookTokenHash: null,
    })
  })

  it('refuses a state it did not mint, and takes a state once', async () => {
    const h = harness()
    const forged = await h.routes.oauthCallback(new Request(`${CONSOLE}/api/x?state=host-1_shipbob.AAAAAAAAAAAAAAAAAAAA&code=c`))
    expect(forged.status).toBe(400)
    const start = await (await h.routes.connect(post('fulfillment-networks/connect', { provider: 'shipbob' }))).json()
    const state = new URL(start.url).searchParams.get('state') as string
    const callback = () => h.routes.oauthCallback(new Request(`${CONSOLE}/api/x?${new URLSearchParams({ state, code: 'c' })}`))
    expect((await callback()).status).toBe(303)
    expect((await callback()).status).toBe(400)
  })

  it('sends the member back declined when the network sent no code', async () => {
    const h = harness()
    const start = await (await h.routes.connect(post('fulfillment-networks/connect', { provider: 'shipbob' }))).json()
    const state = new URL(start.url).searchParams.get('state') as string
    const back = await h.routes.oauthCallback(new Request(`${CONSOLE}/api/x?${new URLSearchParams({ state, error: 'access_denied' })}`))
    expect(back.headers.get('location')).toContain('fulfillmentNetwork=declined')
    expect(h.calls).toHaveLength(0)
  })
})

describe('settings and disconnect (AGL-3634)', () => {
  it('saves settings an admin sends, refusing what is not valid', async () => {
    const h = harness()
    await connectShipbob(h)
    const bad = await h.routes.connection(post('fulfillment-networks/connection', { provider: 'shipbob', routing: 'sometimes' }, 'PATCH'))
    expect(bad.status).toBe(400)
    const saved = await (
      await h.routes.connection(post('fulfillment-networks/connection', { provider: 'shipbob', routing: 'manual', shippingMethod: '2-Day', syncInventory: true }, 'PATCH'))
    ).json()
    expect(saved.connection).toMatchObject({ routing: 'manual', shippingMethod: '2-Day', syncInventory: true })
    h.setRole('editor')
    expect((await h.routes.connection(post('fulfillment-networks/connection', { provider: 'shipbob', paused: true }, 'PATCH'))).status).toBe(403)
  })

  it('takes only a marketplace the seller has', async () => {
    const h = harness()
    const start = await (await h.routes.connect(post('fulfillment-networks/connect', { provider: 'amazon-mcf' }))).json()
    const state = new URL(start.url).searchParams.get('state') as string
    await h.routes.oauthCallback(new Request(`${CONSOLE}/api/x?${new URLSearchParams({ state, spapi_oauth_code: 'c' })}`))
    const other = await h.routes.connection(post('fulfillment-networks/connection', { provider: 'amazon-mcf', marketplaceId: 'A1F83G8C2ARO7P' }, 'PATCH'))
    expect(other.status).toBe(400)
  })

  it('disconnects: removes the webhooks, releases what is still held, and deletes the grant', async () => {
    const h = harness()
    await connectShipbob(h)
    const id = networkConnectionId(HOST, 'shipbob')
    const routing = (status: StoredRouting['status']) =>
      ({ orgId: 'org-1', hostId: HOST, recordId: `o-${status}`, provider: 'shipbob', connectionId: id, displayRef: '#1', status, attempt: 1, reference: 'r', providerOrderId: 'p', lines: [], shipments: {}, note: null, cancelRequested: false, active: true, nextRunAtMs: 0, leaseUntilMs: 0, failures: 0, testMode: false, lastShippedAtMs: null, createdAtMs: 0, updatedAtMs: 0 }) as StoredRouting
    await h.store.createRouting('q', routing('queued'))
    await h.store.createRouting('a', routing('accepted'))
    const answer = await h.routes.connection(post('fulfillment-networks/connection', { provider: 'shipbob' }, 'DELETE'))
    expect(answer.status).toBe(200)
    expect(h.webhookTargets.at(-1)).toEqual({ prefix: `${CONSOLE}/api/fulfillment-networks/webhooks/shipbob?connection=${id}`, url: null })
    expect(h.store.connections.has(id)).toBe(false)
    expect(h.store.routings.get('q')).toMatchObject({ status: 'skipped', active: false })
    expect(h.store.routings.get('a')).toMatchObject({ status: 'failed', active: false, note: expect.stringMatching(/disconnected/) })
    expect(h.activity.at(-1)).toMatchObject({ action: 'disconnected' })
  })

  it('counts stock and reads back held orders on Sync now', async () => {
    const h = harness()
    await connectShipbob(h)
    await h.store.createRouting('a', { connectionId: networkConnectionId(HOST, 'shipbob'), active: true } as StoredRouting)
    const answer = await h.routes.syncNow(post('fulfillment-networks/sync-now', { provider: 'shipbob' }))
    expect(answer.status).toBe(200)
    expect(h.engine.runInventory).toHaveBeenCalledWith(networkConnectionId(HOST, 'shipbob'), { force: true })
    expect(h.engine.runRouting).toHaveBeenCalledWith('a', { force: true })
  })
})

describe('one order (AGL-3634)', () => {
  it('sends an order now, and again after the network canceled it, as a new order there', async () => {
    const h = harness({ role: 'editor' })
    await h.store.patchConnection(networkConnectionId(HOST, 'shipbob'), {
      ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: 'shipbob', sandbox: false, nowMs: 0 }),
      status: 'active',
      connectedAtMs: 1,
    })
    const id = networkOrderId(HOST, 'order-1', 'shipbob')
    const first = await h.routes.orderSend(post('fulfillment-networks/order/send', { provider: 'shipbob', recordId: 'order-1' }))
    expect(first.status).toBe(200)
    expect(h.engine.runRouting).toHaveBeenCalledWith(id, { force: true })
    expect(h.store.routings.get(id)).toMatchObject({ status: 'queued', attempt: 1 })
    await h.store.patchRouting(id, { status: 'accepted', reference: 'agx', lines: [{ lineIndex: 0, sku: 'A', name: 'A', quantity: 1, shippedQuantity: 0 }] })
    expect((await h.routes.orderSend(post('fulfillment-networks/order/send', { provider: 'shipbob', recordId: 'order-1' }))).status).toBe(409)
    await h.store.patchRouting(id, { status: 'canceled', active: false })
    await h.routes.orderSend(post('fulfillment-networks/order/send', { provider: 'shipbob', recordId: 'order-1' }))
    expect(h.store.routings.get(id)).toMatchObject({ status: 'queued', attempt: 2, reference: null, lines: [] })
  })

  it('asks for a cancel only of what a network holds', async () => {
    const h = harness({ role: 'editor' })
    const id = networkOrderId(HOST, 'order-1', 'shipbob')
    expect((await h.routes.orderCancel(post('fulfillment-networks/order/cancel', { provider: 'shipbob', recordId: 'order-1' }))).status).toBe(409)
    await h.store.createRouting(id, {
      hostId: HOST,
      status: 'accepted',
      lines: [{ lineIndex: 0, sku: 'A', name: 'A', quantity: 1, shippedQuantity: 0 }],
    } as StoredRouting)
    const answer = await h.routes.orderCancel(post('fulfillment-networks/order/cancel', { provider: 'shipbob', recordId: 'order-1' }))
    expect(answer.status).toBe(200)
    expect(h.store.routings.get(id)).toMatchObject({ cancelRequested: true, active: true })
    expect(h.engine.runRouting).toHaveBeenCalledWith(id, { force: true })
  })

  it('answers where an order stands to a viewer, and refuses a malformed order id', async () => {
    const h = harness({ role: 'viewer' })
    expect((await h.routes.order(get('fulfillment-networks/order', { recordId: '../x' }))).status).toBe(400)
    const answer = await (await h.routes.order(get('fulfillment-networks/order', { recordId: 'order-1' }))).json()
    expect(answer).toEqual({ connections: [], routings: [] })
    expect((await h.routes.orderSend(post('fulfillment-networks/order/send', { provider: 'shipbob', recordId: 'order-1' }))).status).toBe(403)
  })
})

describe('ShipBob’s webhook (AGL-3634)', () => {
  it('acts only on an address with the connection’s token', async () => {
    const h = harness()
    await connectShipbob(h)
    const id = networkConnectionId(HOST, 'shipbob')
    const token = new URL(h.webhookTargets[0].url as string).searchParams.get('token') as string
    const hook = (query: Record<string, string>, body: unknown) =>
      h.routes.webhookShipbob(
        new Request(`${CONSOLE}/api/fulfillment-networks/webhooks/shipbob?${new URLSearchParams(query)}`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      )
    expect((await hook({ connection: id, token: 'wrong', topic: 'order_shipped' }, { id: 1, order_id: 9 })).status).toBe(401)
    expect((await hook({ connection: 'host-2_shipbob', token, topic: 'order_shipped' }, { id: 1, order_id: 9 })).status).toBe(401)
    expect(h.engine.applyShipbobEvent).not.toHaveBeenCalled()
    const answer = await hook({ connection: id, token, topic: 'shipment_delivered' }, { id: 77, order_id: 9001 })
    expect(answer.status).toBe(200)
    expect(h.engine.applyShipbobEvent).toHaveBeenCalledWith(id, 'shipment_delivered', { orderId: '9001', shipmentId: '77' })
  })
})

const SHIPMONK_ENV = { ...ENV, [FULFILLMENT_NETWORKS_ENV.shipmonkEnabled]: 'true' }

const connectShipmonk = (h: ReturnType<typeof harness>, body: Record<string, unknown> = {}) =>
  h.routes.connectKey(post('fulfillment-networks/connect-key', { provider: 'shipmonk', apiKey: 'sm-live-key-1234', storeId: '11364', ...body }))

const shipmonkHook = (h: ReturnType<typeof harness>, connection: string, raw: string, signature: string | null) =>
  h.routes.webhookShipmonk(
    new Request(`${CONSOLE}/api/fulfillment-networks/webhooks/shipmonk?${new URLSearchParams({ connection })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Sm-Signature': signature } : {}) },
      body: raw,
    }),
  )

describe('ShipMonk: connecting with the merchant’s own API key (AGL-3697)', () => {
  it('is offered only where the deployment opts in, and never by sign-in', async () => {
    const off = harness()
    expect((await connectShipmonk(off)).status).toBe(404)
    const h = harness({ env: SHIPMONK_ENV })
    const answer = await (await h.routes.list(get('fulfillment-networks/connections'))).json()
    expect(answer.offered).toContainEqual({ id: 'shipmonk', sandbox: false })
    expect((await h.routes.connect(post('fulfillment-networks/connect', { provider: 'shipmonk' }))).status).toBe(400)
    expect((await h.routes.connectKey(post('fulfillment-networks/connect-key', { provider: 'shipbob', apiKey: 'x'.repeat(20) }))).status).toBe(400)
    const sandbox = harness({ env: { ...SHIPMONK_ENV, [FULFILLMENT_NETWORKS_ENV.shipmonkEnvironment]: 'sandbox' } })
    const offered = (await (await sandbox.routes.list(get('fulfillment-networks/connections'))).json()).offered
    expect(offered).toContainEqual({ id: 'shipmonk', sandbox: true })
  })

  it('only an admin connects, with a key and a store id that read right', async () => {
    const h = harness({ env: SHIPMONK_ENV, role: 'editor' })
    expect((await connectShipmonk(h)).status).toBe(403)
    h.setRole('admin')
    expect((await connectShipmonk(h, { apiKey: 'short' })).status).toBe(400)
    const badStore = await connectShipmonk(h, { storeId: 'abc' })
    expect(badStore.status).toBe(400)
    expect((await badStore.json()).error).toMatch(/store id/)
    expect(h.accountCalls).toHaveLength(0)
  })

  it('tries the key first, seals it, mints a webhook secret shown once, and answers no credential', async () => {
    const h = harness({ env: SHIPMONK_ENV })
    const response = await connectShipmonk(h)
    expect(response.status).toBe(200)
    const answer = await response.json()
    const id = networkConnectionId(HOST, 'shipmonk')
    expect(h.accountCalls).toEqual([{ accessToken: 'sm-live-key-1234', storeId: '11364' }])
    expect(answer.connection).toMatchObject({ provider: 'shipmonk', status: 'active', storeId: '11364', accountName: 'Store 11364', webhookSecretSet: true })
    expect(answer.webhook.url).toBe(`${CONSOLE}/api/fulfillment-networks/webhooks/shipmonk?connection=${id}`)
    expect(answer.webhook.secret).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(JSON.stringify(answer)).not.toContain('sm-live-key-1234')
    const stored = h.store.connections.get(id)
    expect(JSON.stringify(stored)).not.toContain('sm-live-key-1234')
    expect(JSON.stringify(stored)).not.toContain(answer.webhook.secret)
    const keyring = readFulfillmentNetworksConfig(h.env).keyring as NonNullable<ReturnType<typeof readFulfillmentNetworksConfig>['keyring']>
    expect(openGrant(stored?.sealedAccessToken as string, id, 'access', keyring).value).toBe('sm-live-key-1234')
    expect(openGrant(stored?.sealedWebhookSecret as string, id, 'webhook', keyring).value).toBe(answer.webhook.secret)
    expect(stored).toMatchObject({ sealedRefreshToken: null, accessTokenExpiresAtMs: null, inventoryDueAtMs: 1_000_000 })
    expect(h.activity).toEqual([expect.objectContaining({ action: 'connected', provider: 'shipmonk' })])
  })

  it('refuses a key ShipMonk refuses, keeping nothing, and says when ShipMonk is unreachable', async () => {
    const h = harness({ env: SHIPMONK_ENV })
    const refused = await connectShipmonk(h, { apiKey: 'sm-refused' })
    expect(refused.status).toBe(400)
    expect((await refused.json()).error).toBe('ShipMonk refused that API key. Check it and the store id.')
    expect((await connectShipmonk(h, { apiKey: 'sm-down-key' })).status).toBe(502)
    expect(h.store.connections.get(networkConnectionId(HOST, 'shipmonk'))).toBeUndefined()
  })

  it('connects again with a new key, keeping the webhook secret and the settings', async () => {
    const h = harness({ env: SHIPMONK_ENV })
    const first = await (await connectShipmonk(h)).json()
    const id = networkConnectionId(HOST, 'shipmonk')
    await h.store.patchConnection(id, { status: 'reconnect', routing: 'manual', stock: { MUG: 3 } })
    const again = await (await connectShipmonk(h, { apiKey: 'sm-new-key-5678', storeId: '22' })).json()
    expect(again.webhook).toBeNull()
    expect(again.connection).toMatchObject({ status: 'active', routing: 'manual', storeId: '22' })
    const stored = h.store.connections.get(id)
    expect(stored?.stock).toEqual({})
    const keyring = readFulfillmentNetworksConfig(h.env).keyring as NonNullable<ReturnType<typeof readFulfillmentNetworksConfig>['keyring']>
    expect(openGrant(stored?.sealedWebhookSecret as string, id, 'webhook', keyring).value).toBe(first.webhook.secret)
    expect(openGrant(stored?.sealedAccessToken as string, id, 'access', keyring).value).toBe('sm-new-key-5678')
  })

  it('mints a new webhook secret for an admin only, ending the old one', async () => {
    const h = harness({ env: SHIPMONK_ENV })
    const first = await (await connectShipmonk(h)).json()
    h.setRole('editor')
    expect((await h.routes.webhookSecret(post('fulfillment-networks/webhook-secret', { provider: 'shipmonk' }))).status).toBe(403)
    h.setRole('admin')
    expect((await h.routes.webhookSecret(post('fulfillment-networks/webhook-secret', { provider: 'shipbob' }))).status).toBe(400)
    const rotated = await (await h.routes.webhookSecret(post('fulfillment-networks/webhook-secret', { provider: 'shipmonk' }))).json()
    expect(rotated.webhook.secret).not.toBe(first.webhook.secret)
    const id = networkConnectionId(HOST, 'shipmonk')
    const raw = JSON.stringify({ order_key: 'agabc' })
    const signed = (secret: string) => createHmac('sha512', secret).update(raw).digest('hex')
    expect((await shipmonkHook(h, id, raw, signed(first.webhook.secret))).status).toBe(401)
    expect((await shipmonkHook(h, id, raw, signed(rotated.webhook.secret))).status).toBe(200)
  })

  it('disconnects, deleting the sealed key and secret', async () => {
    const h = harness({ env: SHIPMONK_ENV })
    await connectShipmonk(h)
    const response = await h.routes.connection(post('fulfillment-networks/connection', { provider: 'shipmonk' }, 'DELETE'))
    expect(response.status).toBe(200)
    expect(h.store.connections.get(networkConnectionId(HOST, 'shipmonk'))).toBeUndefined()
  })
})

describe('ShipMonk’s webhook (AGL-3697)', () => {
  it('acts only on a body signed with the connection’s own secret, read back by the order it names', async () => {
    const h = harness({ env: SHIPMONK_ENV })
    const { webhook } = await (await connectShipmonk(h)).json()
    const id = networkConnectionId(HOST, 'shipmonk')
    const raw = JSON.stringify({ order_key: 'agabc-part', parent_order_key: 'agabc', processing_status: 'en_route' })
    const signature = createHmac('sha512', webhook.secret).update(raw).digest('hex')
    expect((await shipmonkHook(h, id, raw, null)).status).toBe(401)
    expect((await shipmonkHook(h, id, raw, createHmac('sha512', 'guess').update(raw).digest('hex'))).status).toBe(401)
    expect((await shipmonkHook(h, id, `${raw} `, signature)).status).toBe(401)
    expect((await shipmonkHook(h, 'host-2_shipmonk', raw, signature)).status).toBe(401)
    expect((await shipmonkHook(h, networkConnectionId(HOST, 'shipbob'), raw, signature)).status).toBe(401)
    expect(h.engine.applyOrderWebhook).not.toHaveBeenCalled()
    const answer = await shipmonkHook(h, id, raw, createHmac('sha512', webhook.secret).update(raw).digest('base64'))
    expect(answer.status).toBe(200)
    expect(h.engine.applyOrderWebhook).toHaveBeenCalledWith(id, 'agabc')
    const plain = JSON.stringify({ order_key: 'agabc' })
    await shipmonkHook(h, id, plain, createHmac('sha512', webhook.secret).update(plain).digest('hex'))
    expect(h.engine.applyOrderWebhook).toHaveBeenLastCalledWith(id, 'agabc')
  })

  it('refuses a body too large to be ShipMonk’s before reading it', async () => {
    const h = harness({ env: SHIPMONK_ENV })
    await connectShipmonk(h)
    const huge = 'x'.repeat(1_000_001)
    expect((await shipmonkHook(h, networkConnectionId(HOST, 'shipmonk'), huge, 'sig')).status).toBe(413)
  })
})
