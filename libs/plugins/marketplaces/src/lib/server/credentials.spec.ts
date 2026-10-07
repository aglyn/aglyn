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
import { ProviderError } from '../providers/http'
import type { MarketplaceProvider } from '../providers/provider'
import { createMemoryMarketplaceStore } from '../testing/memory-store'
import { openGrant, readMarketplacesConfig, sealGrant } from './config'
import { createCredentialOpener } from './credentials'
import { emptyConnection } from './store'

const T0 = 1_800_000_000_000
const ID = 'host1_ebay'
const env = (key: string) => ({
  [MARKETPLACES_ENV.tokenKey]: key,
  [MARKETPLACES_ENV.ebayClientId]: 'id',
  [MARKETPLACES_ENV.ebayClientSecret]: 'secret',
  [MARKETPLACES_ENV.ebayRuName]: 'ru',
})

function setup() {
  const key = randomBytes(32).toString('base64')
  let config = readMarketplacesConfig(env(key))
  const store = createMemoryMarketplaceStore()
  const refresh = jest.fn(async () => ({ accessToken: 'fresh', refreshToken: null, expiresAtMs: T0 + 7200_000 }))
  const provider = { refresh } as unknown as MarketplaceProvider
  const open = createCredentialOpener({ store, config: () => config, provider: () => provider, now: () => T0 })
  const keyring = config.keyring!
  const connection = {
    ...emptyConnection({ orgId: 'o', hostId: 'host1', marketplace: 'ebay', sandbox: false, nowMs: T0 }),
    account: { sellerId: 's1' },
    sealedAccessToken: sealGrant('old-access', ID, 'access', keyring),
    sealedRefreshToken: sealGrant('the-refresh', ID, 'refresh', keyring),
    accessTokenExpiresAtMs: T0 + 3600_000,
  }
  return { store, refresh, open, connection, keyring, key, setConfig: (next: typeof config) => (config = next) }
}

describe('opening a grant (AGL-3638)', () => {
  it('opens a live access token without a refresh', async () => {
    const h = setup()
    await expect(h.open(ID, h.connection)).resolves.toEqual({ accessToken: 'old-access', account: { sellerId: 's1' } })
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('refreshes one about to expire, seals the new one and keeps a refresh token not rotated', async () => {
    const h = setup()
    const credential = await h.open(ID, { ...h.connection, accessTokenExpiresAtMs: T0 + 60_000 })
    expect(credential.accessToken).toBe('fresh')
    const stored = h.store.connections.get(ID)!
    expect(openGrant(stored.sealedAccessToken!, ID, 'access', h.keyring).value).toBe('fresh')
    expect(openGrant(stored.sealedRefreshToken!, ID, 'refresh', h.keyring).value).toBe('the-refresh')
  })

  it('asks to connect again when the grant is refused, expired or cannot be opened', async () => {
    const h = setup()
    h.refresh.mockRejectedValueOnce(new ProviderError('invalid', 'invalid_grant'))
    await expect(h.open(ID, { ...h.connection, accessTokenExpiresAtMs: T0 })).rejects.toMatchObject({ kind: 'auth' })
    await expect(h.open(ID, { ...h.connection, accessTokenExpiresAtMs: T0, refreshTokenExpiresAtMs: T0 })).rejects.toMatchObject({
      kind: 'auth',
    })
    await expect(h.open(ID, { ...h.connection, accessTokenExpiresAtMs: T0, sealedRefreshToken: null })).rejects.toMatchObject({
      kind: 'auth',
    })
    // Sealed for another connection: refused rather than opened.
    await expect(h.open('host2_ebay', h.connection)).rejects.toMatchObject({ kind: 'auth' })
    h.setConfig(readMarketplacesConfig({}))
    await expect(h.open(ID, h.connection)).rejects.toMatchObject({ kind: 'auth' })
  })

  it('seals again under a rotated-in key', async () => {
    const h = setup()
    const next = randomBytes(32).toString('base64')
    h.setConfig(readMarketplacesConfig(env(`${next},${h.key}`)))
    await h.open(ID, h.connection)
    const stored = h.store.connections.get(ID)!
    const rotated = readMarketplacesConfig(env(next)).keyring!
    expect(openGrant(stored.sealedAccessToken!, ID, 'access', rotated).value).toBe('old-access')
  })
})

describe('what a deployment offers (AGL-3638)', () => {
  it('reads each marketplace’s app, and offers none without the key', () => {
    const config = readMarketplacesConfig({
      [MARKETPLACES_ENV.tokenKey]: randomBytes(32).toString('base64'),
      [MARKETPLACES_ENV.amazonApplicationId]: 'amzn1.sp.solution.x',
      [MARKETPLACES_ENV.amazonClientId]: 'lwa',
      [MARKETPLACES_ENV.amazonClientSecret]: 'lwa-secret',
      [MARKETPLACES_ENV.amazonRegion]: 'EU',
      [MARKETPLACES_ENV.amazonEnvironment]: 'sandbox',
      [MARKETPLACES_ENV.tiktokAppKey]: 'k',
      [MARKETPLACES_ENV.tiktokAppSecret]: 's',
      [MARKETPLACES_ENV.walmartClientId]: 'w',
    })
    expect(config.apps.amazon).toEqual({
      clientId: 'lwa',
      clientSecret: 'lwa-secret',
      sandbox: true,
      extra: { applicationId: 'amzn1.sp.solution.x', region: 'eu', draft: 'false' },
    })
    // TikTok needs its service id; Walmart its secret.
    expect(config.apps.tiktok).toBeNull()
    expect(config.apps.walmart).toBeNull()
  })
})
