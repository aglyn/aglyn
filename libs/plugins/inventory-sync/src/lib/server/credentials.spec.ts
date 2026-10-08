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

import { parseSecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { randomBytes } from 'node:crypto'
import { mockHttp } from '../testing/mock-http'
import { createMemoryInventoryStore } from '../testing/memory-store'
import { openCredential, readInventorySyncConfig, sealCredential, offeredProviders } from './config'
import { createCredentialOpener, TOKEN_REFRESH_MARGIN_MS } from './credentials'
import { emptyConnection, type StoredConnection } from './store'

const T0 = Date.UTC(2026, 9, 7, 12)
const key = () => randomBytes(32).toString('base64')

describe('config (AGL-3642)', () => {
  it('offers nothing without the token key, and Brightpearl only with its app', () => {
    expect(offeredProviders(readInventorySyncConfig({}))).toEqual([])
    const keyOnly = readInventorySyncConfig({ INVENTORY_SYNC_TOKEN_KEY: key() })
    expect(offeredProviders(keyOnly)).toEqual(['cin7-core', 'inflow'])
    const all = readInventorySyncConfig({
      INVENTORY_SYNC_TOKEN_KEY: key(),
      BRIGHTPEARL_APP_REF: 'app',
      BRIGHTPEARL_DEV_REF: 'dev',
    })
    expect(offeredProviders(all)).toEqual(['cin7-core', 'inflow', 'brightpearl'])
    expect(all.brightpearl).toEqual({ appRef: 'app', devRef: 'dev', clientSecret: null })
    expect(offeredProviders(readInventorySyncConfig({ INVENTORY_SYNC_TOKEN_KEY: 'not-a-key' }))).toEqual([])
  })

  it('seals a credential to its connection: moved to another, it does not open', () => {
    const keyring = parseSecretBoxKeyring(key())
    const sealed = sealCredential({ provider: 'cin7-core', accountId: 'a', apiKey: 'secret-key' }, 'host-1', keyring)
    expect(sealed).not.toContain('secret-key')
    expect(openCredential(sealed, 'host-1', keyring).payload).toEqual({ provider: 'cin7-core', accountId: 'a', apiKey: 'secret-key' })
    expect(() => openCredential(sealed, 'host-2', keyring)).toThrow()
  })
})

describe('opening a credential (AGL-3642)', () => {
  const first = key()
  const second = key()

  function setup(connection: Partial<StoredConnection>, keyValue = first, routes = [] as Parameters<typeof mockHttp>[0]) {
    const store = createMemoryInventoryStore()
    const { http, calls } = mockHttp(routes)
    const config = () =>
      readInventorySyncConfig({ INVENTORY_SYNC_TOKEN_KEY: keyValue, BRIGHTPEARL_APP_REF: 'app', BRIGHTPEARL_DEV_REF: 'dev' })
    const stored: StoredConnection = {
      ...emptyConnection({ orgId: 'o', hostId: 'host-1', provider: 'cin7-core', nowMs: T0 }),
      ...connection,
    }
    store.connections.set('host-1', stored)
    return { store, calls, open: createCredentialOpener({ store, config, http, now: () => T0 }), stored }
  }

  it('opens pasted keys, and seals them again under a rotated-in key', async () => {
    const sealed = sealCredential({ provider: 'inflow', companyId: 'c', apiKey: 'k' }, 'host-1', parseSecretBoxKeyring(first))
    const { open, store, stored } = setup({ provider: 'inflow', sealedCredential: sealed }, `${second},${first}`)
    await expect(open('host-1', stored)).resolves.toEqual({ provider: 'inflow', companyId: 'c', apiKey: 'k' })
    const resealed = store.connections.get('host-1')!.sealedCredential!
    expect(resealed).not.toBe(sealed)
    expect(openCredential(resealed, 'host-1', parseSecretBoxKeyring(second)).payload).toMatchObject({ apiKey: 'k' })
  })

  it('reads a credential it cannot open as connect-again', async () => {
    const { open, stored } = setup({ sealedCredential: 'garbage' })
    await expect(open('host-1', stored)).rejects.toMatchObject({ kind: 'auth' })
  })

  it('refreshes a Brightpearl grant near its expiry and stores the new one sealed', async () => {
    const sealed = sealCredential({ provider: 'brightpearl', accessToken: 'old', refreshToken: 'refresh-1' }, 'host-1', parseSecretBoxKeyring(first))
    const { open, store, stored, calls } = setup(
      {
        provider: 'brightpearl',
        sealedCredential: sealed,
        accountCode: 'shop',
        apiDomain: 'use1.brightpearlconnect.com',
        accessTokenExpiresAtMs: T0 + TOKEN_REFRESH_MARGIN_MS - 1,
      },
      first,
      [{ method: 'POST', match: 'oauth.brightpearlapp.com/token/shop', body: { access_token: 'new', refresh_token: 'refresh-2', expires_in: 604800, api_domain: 'use1.brightpearlconnect.com' } }],
    )
    await expect(open('host-1', stored)).resolves.toEqual({
      provider: 'brightpearl',
      accountCode: 'shop',
      apiDomain: 'use1.brightpearlconnect.com',
      accessToken: 'new',
    })
    expect(calls[0].body).toContain('grant_type=refresh_token')
    expect(calls[0].body).toContain('client_id=app')
    const after = store.connections.get('host-1')!
    expect(after.accessTokenExpiresAtMs).toBe(T0 + 604800 * 1000)
    expect(openCredential(after.sealedCredential!, 'host-1', parseSecretBoxKeyring(first)).payload).toEqual({
      provider: 'brightpearl',
      accessToken: 'new',
      refreshToken: 'refresh-2',
    })
  })

  it('reads a refused refresh as a revoked grant', async () => {
    const sealed = sealCredential({ provider: 'brightpearl', accessToken: 'old', refreshToken: 'r' }, 'host-1', parseSecretBoxKeyring(first))
    const { open, stored } = setup(
      { provider: 'brightpearl', sealedCredential: sealed, accountCode: 'shop', apiDomain: 'use1.brightpearlconnect.com', accessTokenExpiresAtMs: T0 },
      first,
      [{ method: 'POST', match: 'token', status: 400, body: { error: 'invalid_grant' } }],
    )
    await expect(open('host-1', stored)).rejects.toMatchObject({ kind: 'auth' })
  })
})
