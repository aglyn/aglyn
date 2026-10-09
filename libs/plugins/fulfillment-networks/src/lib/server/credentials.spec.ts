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

import { randomBytes } from 'node:crypto'
import { FULFILLMENT_NETWORKS_ENV } from '../constants'
import { networkConnectionId } from '../model/networks'
import { createMemoryNetworkStore } from '../testing/memory-store'
import { mockHttp } from '../testing/mock-http'
import { offeredNetworks, openGrant, readFulfillmentNetworksConfig, sealGrant } from './config'
import { createCredentialOpener } from './credentials'
import { networkAuthorizeUrl, safeReturnTo } from './oauth'
import { emptyConnection } from './store'

const KEY = randomBytes(32).toString('base64')
const ENV = {
  [FULFILLMENT_NETWORKS_ENV.tokenKey]: KEY,
  [FULFILLMENT_NETWORKS_ENV.shipbobClientId]: 'sb-client',
  [FULFILLMENT_NETWORKS_ENV.shipbobClientSecret]: 'sb-secret',
  [FULFILLMENT_NETWORKS_ENV.shipbobEnvironment]: 'sandbox',
  [FULFILLMENT_NETWORKS_ENV.amazonApplicationId]: 'app-id',
  [FULFILLMENT_NETWORKS_ENV.amazonClientId]: 'lwa-id',
  [FULFILLMENT_NETWORKS_ENV.amazonClientSecret]: 'lwa-secret',
  [FULFILLMENT_NETWORKS_ENV.amazonRegion]: 'EU',
  [FULFILLMENT_NETWORKS_ENV.amazonDraftApp]: 'true',
}

describe('what the deployment offers (AGL-3634)', () => {
  it('offers nothing without the token key, whatever apps are set', () => {
    const { [FULFILLMENT_NETWORKS_ENV.tokenKey]: _key, ...withoutKey } = ENV
    expect(offeredNetworks(readFulfillmentNetworksConfig(withoutKey))).toEqual([])
    expect(offeredNetworks(readFulfillmentNetworksConfig({ ...ENV, [FULFILLMENT_NETWORKS_ENV.tokenKey]: 'short' }))).toEqual([])
  })

  it('offers a network only when its whole app is set', () => {
    expect(offeredNetworks(readFulfillmentNetworksConfig(ENV))).toEqual(['shipbob', 'amazon-mcf'])
    const { [FULFILLMENT_NETWORKS_ENV.amazonClientSecret]: _secret, ...noAmazon } = ENV
    expect(offeredNetworks(readFulfillmentNetworksConfig(noAmazon))).toEqual(['shipbob'])
    const config = readFulfillmentNetworksConfig(ENV)
    expect(config.shipbob?.sandbox).toBe(true)
    expect(config.amazon).toMatchObject({ region: 'eu', sandbox: false, draft: true })
  })

  it('builds each consent address for its environment and region', () => {
    const config = readFulfillmentNetworksConfig(ENV)
    const shipbob = new URL(networkAuthorizeUrl({ provider: 'shipbob', config, redirectUri: 'https://c/cb', connectionId: 'h_shipbob', nonce: 'n'.repeat(20) }))
    expect(shipbob.origin).toBe('https://authstage.shipbob.com')
    expect(shipbob.searchParams.get('state')).toBe(`h_shipbob.${'n'.repeat(20)}`)
    const amazon = new URL(networkAuthorizeUrl({ provider: 'amazon-mcf', config, redirectUri: 'https://c/cb', connectionId: 'h_amazon-mcf', nonce: 'n'.repeat(20) }))
    expect(amazon.origin).toBe('https://sellercentral-europe.amazon.com')
    expect(amazon.searchParams.get('version')).toBe('beta')
  })

  it('offers ShipMonk only where the deployment opts in, with the token key (AGL-3697)', () => {
    expect(offeredNetworks(readFulfillmentNetworksConfig({ [FULFILLMENT_NETWORKS_ENV.shipmonkEnabled]: 'true' }))).toEqual([])
    const config = readFulfillmentNetworksConfig({
      [FULFILLMENT_NETWORKS_ENV.tokenKey]: KEY,
      [FULFILLMENT_NETWORKS_ENV.shipmonkEnabled]: 'TRUE',
      [FULFILLMENT_NETWORKS_ENV.shipmonkEnvironment]: 'sandbox',
    })
    expect(offeredNetworks(config)).toEqual(['shipmonk'])
    expect(config.shipmonk).toEqual({ sandbox: true })
    expect(offeredNetworks(readFulfillmentNetworksConfig({ ...ENV, [FULFILLMENT_NETWORKS_ENV.shipmonkEnabled]: 'yes' }))).not.toContain('shipmonk')
  })

  it('sends a member back only to a path on the console', () => {
    expect(safeReturnTo('/acme/store?tab=settings')).toBe('/acme/store?tab=settings')
    expect(safeReturnTo('//evil.example/x')).toBe('/')
    expect(safeReturnTo('https://evil.example')).toBe('/')
  })
})

describe('opening a grant (AGL-3634)', () => {
  const id = networkConnectionId('host-1', 'shipbob')
  const config = () => readFulfillmentNetworksConfig(ENV)

  async function stored(expiresAtMs: number | null, refresh = true) {
    const store = createMemoryNetworkStore()
    const keyring = config().keyring!
    await store.patchConnection(id, {
      ...emptyConnection({ orgId: 'o', hostId: 'host-1', provider: 'shipbob', sandbox: true, nowMs: 0 }),
      status: 'active',
      channelId: 'ch-5',
      sealedAccessToken: sealGrant('old-access', id, 'access', keyring),
      sealedRefreshToken: refresh ? sealGrant('old-refresh', id, 'refresh', keyring) : null,
      accessTokenExpiresAtMs: expiresAtMs,
    })
    return store
  }

  it('answers a live access token as it is', async () => {
    const store = await stored(10_000_000)
    const { http, calls } = mockHttp([])
    const open = createCredentialOpener({ store, config, http, now: () => 1_000_000 })
    await expect(open(id, (await store.getConnection(id))!)).resolves.toEqual({ accessToken: 'old-access', channelId: 'ch-5', marketplaceId: null, storeId: null })
    expect(calls).toHaveLength(0)
  })

  it('refreshes one about to expire, sealing and storing the new grant first', async () => {
    const store = await stored(1_000_000 + 60_000)
    const { http, calls } = mockHttp([
      { method: 'POST', match: 'authstage.shipbob.com/connect/token', body: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 } },
    ])
    const open = createCredentialOpener({ store, config, http, now: () => 1_000_000 })
    const credential = await open(id, (await store.getConnection(id))!)
    expect(credential.accessToken).toBe('new-access')
    expect(Object.fromEntries(new URLSearchParams(calls[0].body as string))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
      client_id: 'sb-client',
      client_secret: 'sb-secret',
    })
    const after = (await store.getConnection(id))!
    const keyring = config().keyring!
    expect(openGrant(after.sealedRefreshToken as string, id, 'refresh', keyring).value).toBe('new-refresh')
    expect(after.accessTokenExpiresAtMs).toBe(1_000_000 + 3_600_000)
  })

  it('reads a refused refresh as a revoked grant', async () => {
    const store = await stored(0)
    const { http } = mockHttp([{ method: 'POST', match: '/connect/token', status: 400, body: { error: 'invalid_grant' } }])
    const open = createCredentialOpener({ store, config, http, now: () => 1_000_000 })
    await expect(open(id, (await store.getConnection(id))!)).rejects.toMatchObject({ kind: 'auth', message: expect.stringMatching(/Connect again/) })
  })

  it('refuses a grant sealed for another connection', async () => {
    const store = await stored(10_000_000)
    const moved = { ...(await store.getConnection(id))! }
    const open = createCredentialOpener({ store, config, http: mockHttp([]).http, now: () => 0 })
    await expect(open(networkConnectionId('host-2', 'shipbob'), moved)).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('opening a pasted API key (AGL-3697)', () => {
  it('opens a ShipMonk key as-is, with its store, never refreshing it', async () => {
    const config = readFulfillmentNetworksConfig({ [FULFILLMENT_NETWORKS_ENV.tokenKey]: KEY, [FULFILLMENT_NETWORKS_ENV.shipmonkEnabled]: 'true' })
    const keyring = config.keyring as NonNullable<typeof config.keyring>
    const id = networkConnectionId('host-1', 'shipmonk')
    const store = createMemoryNetworkStore()
    const connection = {
      ...emptyConnection({ orgId: 'org-1', hostId: 'host-1', provider: 'shipmonk', sandbox: false, nowMs: 0 }),
      status: 'active' as const,
      storeId: '11364',
      sealedAccessToken: sealGrant('sm-key-abcdef', id, 'access', keyring),
      sealedWebhookSecret: sealGrant('whsec', id, 'webhook', keyring),
    }
    const { http, calls } = mockHttp([])
    const open = createCredentialOpener({ store, config: () => config, http, now: () => 10 ** 13 })
    await expect(open(id, connection)).resolves.toEqual({ accessToken: 'sm-key-abcdef', channelId: null, marketplaceId: null, storeId: '11364' })
    expect(calls).toHaveLength(0)
    // A secret sealed for the webhook does not open as the key, nor the other way round.
    expect(() => openGrant(connection.sealedWebhookSecret, id, 'access', keyring)).toThrow()
    await expect(open(id, { ...connection, sealedAccessToken: connection.sealedWebhookSecret })).rejects.toMatchObject({ kind: 'auth' })
  })
})
