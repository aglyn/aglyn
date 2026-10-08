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

import { ProviderError, type ProviderHttp } from '../providers/http'
import type { InventoryCredential } from '../providers/provider'
import { openCredential, sealCredential, type InventorySyncConfig } from './config'
import { refreshBrightpearlGrant } from './oauth'
import type { InventoryStore, StoredConnection } from './store'

/**
 * Opening a connection's sealed credential for one run (AGL-3642).
 *
 * The plaintext lives only in the returned object. A Brightpearl access token
 * within a day of expiring is refreshed first, and the new grant sealed and
 * stored before it is used; a credential sealed under a key since rotated out
 * of first place is sealed again under the current one. Anything that leaves
 * no usable credential is a `ProviderError('auth')`, which turns the
 * connection to "connect again".
 */

export const TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000

export interface CredentialDeps {
  store: InventoryStore
  config: () => InventorySyncConfig
  http: ProviderHttp
  now(): number
}

export function createCredentialOpener(deps: CredentialDeps) {
  return async function openInventoryCredential(id: string, connection: StoredConnection): Promise<InventoryCredential> {
    const config = deps.config()
    const keyring = config.keyring
    if (!keyring) throw new ProviderError('auth', 'This deployment can no longer open stored connections. Connect again once it can.')
    if (!connection.sealedCredential) throw new ProviderError('auth', 'The connection has no stored keys. Connect again.')
    let opened: ReturnType<typeof openCredential>
    try {
      opened = openCredential(connection.sealedCredential, id, keyring)
    } catch {
      throw new ProviderError('auth', 'The stored keys could not be opened. Connect again.')
    }
    const payload = opened.payload
    if (payload.provider !== connection.provider) throw new ProviderError('auth', 'The stored keys are for another system. Connect again.')
    const reseal = async () => {
      if (!opened.needsReseal) return
      await deps.store.patchConnection(id, {
        sealedCredential: sealCredential(payload, id, keyring),
        credentialKeyId: keyring.current.id,
      })
    }
    if (payload.provider === 'cin7-core') {
      await reseal()
      return { provider: 'cin7-core', accountId: payload.accountId, apiKey: payload.apiKey }
    }
    if (payload.provider === 'inflow') {
      await reseal()
      return { provider: 'inflow', companyId: payload.companyId, apiKey: payload.apiKey }
    }
    const accountCode = connection.accountCode ?? ''
    if (!accountCode || !connection.apiDomain) throw new ProviderError('auth', 'The Brightpearl connection is incomplete. Connect again.')
    const expires = connection.accessTokenExpiresAtMs
    if (expires === null || expires === undefined || expires - TOKEN_REFRESH_MARGIN_MS > deps.now()) {
      await reseal()
      return { provider: 'brightpearl', accountCode, apiDomain: connection.apiDomain, accessToken: payload.accessToken }
    }
    if (!payload.refreshToken) throw new ProviderError('auth', 'The Brightpearl connection expired. Connect again.')
    if (!config.brightpearl) throw new ProviderError('auth', 'This deployment no longer has the Brightpearl app. Connect again once it does.')
    const grant = await refreshBrightpearlGrant({
      http: deps.http,
      app: config.brightpearl,
      accountCode,
      refreshToken: payload.refreshToken,
      nowMs: deps.now(),
    }).catch((error) => {
      // A refused refresh is a revoked grant; anything else is retried.
      if (error instanceof ProviderError && (error.kind === 'invalid' || error.kind === 'auth')) {
        throw new ProviderError('auth', 'The Brightpearl connection was revoked or expired. Connect again.')
      }
      throw error
    })
    await deps.store.patchConnection(id, {
      sealedCredential: sealCredential(
        { provider: 'brightpearl', accessToken: grant.accessToken, refreshToken: grant.refreshToken ?? payload.refreshToken },
        id,
        keyring,
      ),
      credentialKeyId: keyring.current.id,
      accessTokenExpiresAtMs: grant.expiresAtMs,
      apiDomain: grant.apiDomain,
      updatedAtMs: deps.now(),
    })
    return { provider: 'brightpearl', accountCode, apiDomain: grant.apiDomain, accessToken: grant.accessToken }
  }
}
