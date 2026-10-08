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

import type { MarketplaceId } from '../model/marketplaces'
import { ProviderError } from '../providers/http'
import type { MarketplaceCredential, MarketplaceProvider } from '../providers/provider'
import { openGrant, sealGrant, type MarketplacesConfig } from './config'
import type { MarketplaceStore, StoredConnection } from './store'

/**
 * Opening a connection's sealed grant for one run (AGL-3638).
 *
 * The plaintext lives only in the returned object. An access token within
 * five minutes of expiring is refreshed first, and the new grant sealed and
 * stored before it is used; a grant sealed under a key since rotated out of
 * first place is sealed again under the current one. Anything that leaves no
 * usable grant is a `ProviderError('auth')`, which turns the connection to
 * "connect again".
 */

export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface CredentialDeps {
  store: MarketplaceStore
  config: () => MarketplacesConfig
  provider: (id: MarketplaceId) => MarketplaceProvider
  now(): number
}

export function createCredentialOpener(deps: CredentialDeps) {
  return async function openMarketplaceCredential(id: string, connection: StoredConnection): Promise<MarketplaceCredential> {
    const config = deps.config()
    const keyring = config.keyring
    if (!keyring) throw new ProviderError('auth', 'This deployment can no longer open stored connections. Connect again once it can.')
    const app = config.apps[connection.marketplace]
    if (!app) throw new ProviderError('auth', 'This deployment no longer has the app this connection was made with.')
    const account = connection.account ?? {}
    const open = (sealed: string | null, purpose: 'access' | 'refresh') => {
      if (!sealed) return null
      try {
        return openGrant(sealed, id, purpose, keyring)
      } catch {
        throw new ProviderError('auth', 'The stored grant could not be opened. Connect again.')
      }
    }
    const access = open(connection.sealedAccessToken, 'access')
    const expires = connection.accessTokenExpiresAtMs
    if (access && (expires === null || expires === undefined || expires - TOKEN_REFRESH_MARGIN_MS > deps.now())) {
      if (access.needsReseal) {
        await deps.store.patchConnection(id, {
          sealedAccessToken: sealGrant(access.value, id, 'access', keyring),
          tokenKeyId: keyring.current.id,
        })
      }
      return { accessToken: access.value, account }
    }
    const refresh = open(connection.sealedRefreshToken, 'refresh')
    if (!refresh) throw new ProviderError('auth', 'The connection expired. Connect again.')
    if (connection.refreshTokenExpiresAtMs && connection.refreshTokenExpiresAtMs <= deps.now()) {
      throw new ProviderError('auth', 'The connection expired. Connect again.')
    }
    const grant = await deps
      .provider(connection.marketplace)
      .refresh(app, { refreshToken: refresh.value, nowMs: deps.now() })
      .catch((error) => {
        // A refused refresh is a revoked grant; anything else is retried.
        if (error instanceof ProviderError && (error.kind === 'invalid' || error.kind === 'auth')) {
          throw new ProviderError('auth', 'The connection was revoked or expired. Connect again.')
        }
        throw error
      })
    await deps.store.patchConnection(id, {
      sealedAccessToken: sealGrant(grant.accessToken, id, 'access', keyring),
      // A marketplace that rotates refresh tokens hands back a new one; one
      // that does not keeps the old one working.
      sealedRefreshToken: sealGrant(grant.refreshToken ?? refresh.value, id, 'refresh', keyring),
      accessTokenExpiresAtMs: grant.expiresAtMs,
      ...(grant.refreshExpiresAtMs ? { refreshTokenExpiresAtMs: grant.refreshExpiresAtMs } : {}),
      tokenKeyId: keyring.current.id,
      updatedAtMs: deps.now(),
    })
    return { accessToken: grant.accessToken, account }
  }
}
