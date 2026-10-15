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

import { ProviderError } from '../providers/http'
import type { HelpDeskCredential } from '../providers/provider'
import { openCredential, sealCredential, type HelpDesksConfig } from './config'
import type { ConnectionStore, StoredConnection } from './store'

/**
 * Opening a connection's sealed credential for one run (AGL-3824).
 *
 * The plaintext lives only in the returned object. A credential sealed under
 * a key that has since been rotated out of first place is sealed again under
 * the current one as it is opened. Anything that leaves no usable credential
 * is a `ProviderError('auth')`, which the engine turns into "connect again".
 */
export function createCredentialOpener(deps: { store: Pick<ConnectionStore, 'patch'>; config: () => HelpDesksConfig }) {
  return async function openConnectionCredential(id: string, connection: StoredConnection): Promise<HelpDeskCredential> {
    const keyring = deps.config().keyring
    if (!keyring) throw new ProviderError('auth', 'This deployment can no longer open stored connections. Connect again once it can.')
    if (!connection.sealedToken) throw new ProviderError('auth', 'This connection has no credential. Connect again.')
    let opened: ReturnType<typeof openCredential>
    try {
      opened = openCredential(connection.sealedToken, id, keyring)
    } catch {
      throw new ProviderError('auth', 'The stored credential could not be opened. Connect again.')
    }
    if (opened.needsReseal) {
      await deps.store.patch(id, { sealedToken: sealCredential(opened.parts, id, keyring), tokenKeyId: keyring.current.id })
    }
    return {
      account: connection.account ?? null,
      login: opened.parts.login,
      token: opened.parts.token,
      appClientId: opened.parts.appClientId,
      supportEmail: connection.supportEmail ?? null,
    }
  }
}
