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

import type { SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { ProviderError, type ProviderHttp } from '../providers/http'
import type { ProviderCredential } from '../providers/provider'
import { openCredential, sealCredential, type MarketingPlatformsConfig } from './config'
import { refreshOAuthGrant } from './oauth'
import type { ConnectionStore, StoredConnection } from './store'

/**
 * Opening a connection's sealed credential for one run (AGL-3639).
 *
 * The plaintext lives only in the returned object. A credential sealed under
 * a key that has since been rotated out of first place is sealed again under
 * the current one as it is opened. An OAuth access token within five minutes
 * of expiring is refreshed first, and the new grant sealed and stored before
 * it is used. Anything that leaves no usable credential is a
 * `ProviderError('auth')`, which the engine turns into "connect again".
 */

/** How long before expiry an access token is refreshed. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface CredentialDeps {
  store: ConnectionStore
  config: () => MarketingPlatformsConfig
  http: ProviderHttp
  now(): number
}

export function createCredentialOpener(deps: CredentialDeps) {
  return async function openConnectionCredential(id: string, connection: StoredConnection): Promise<ProviderCredential> {
    const config = deps.config()
    const keyring: SecretBoxKeyring | null = config.keyring
    if (!keyring) throw new ProviderError('auth', 'This deployment can no longer open stored connections. Connect again once it can.')
    if (!connection.sealedToken) throw new ProviderError('auth', 'This connection has no credential. Connect again.')
    let token: { value: string; needsReseal: boolean }
    try {
      token = openCredential(connection.sealedToken, id, 'token', keyring)
    } catch {
      throw new ProviderError('auth', 'The stored credential could not be opened. Connect again.')
    }
    if (token.needsReseal) {
      await deps.store.patch(id, {
        sealedToken: sealCredential(token.value, id, 'token', keyring),
        tokenKeyId: keyring.current.id,
      })
    }
    const credential: ProviderCredential = { kind: connection.authKind, token: token.value, apiBase: connection.apiBase }
    const expires = connection.tokenExpiresAtMs
    if (connection.authKind !== 'oauth' || expires === null || expires === undefined) return credential
    if (expires - TOKEN_REFRESH_MARGIN_MS > deps.now()) return credential

    const client = config.oauth[connection.provider]
    if (!client) throw new ProviderError('auth', 'This deployment no longer has the app this connection was made with. Connect again.')
    if (!connection.sealedRefreshToken) throw new ProviderError('auth', 'The connection expired. Connect again.')
    let refresh: string
    try {
      refresh = openCredential(connection.sealedRefreshToken, id, 'refresh', keyring).value
    } catch {
      throw new ProviderError('auth', 'The stored credential could not be opened. Connect again.')
    }
    const grant = await refreshOAuthGrant({
      http: deps.http,
      provider: connection.provider,
      client,
      refreshToken: refresh,
      nowMs: deps.now(),
    }).catch((error) => {
      // A refused refresh is a revoked grant; anything else is retried.
      if (error instanceof ProviderError && (error.kind === 'invalid' || error.kind === 'auth')) {
        throw new ProviderError('auth', 'The connection was revoked or expired. Connect again.')
      }
      throw error
    })
    await deps.store.patch(id, {
      sealedToken: sealCredential(grant.accessToken, id, 'token', keyring),
      // A provider that rotates refresh tokens hands back a new one; one that
      // does not keeps the old one working.
      sealedRefreshToken: sealCredential(grant.refreshToken ?? refresh, id, 'refresh', keyring),
      tokenExpiresAtMs: grant.expiresAtMs,
      tokenKeyId: keyring.current.id,
      updatedAtMs: deps.now(),
    })
    return { kind: 'oauth', token: grant.accessToken, apiBase: connection.apiBase }
  }
}
