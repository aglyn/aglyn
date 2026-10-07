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

/**
 * A WORKSPACE ERASED TAKES ITS LEDGER GRANT WITH IT (AGL-3614).
 *
 * The connection, the sync log and the pending OAuth states are all under
 * `orgs/{orgId}`, so the erasure's recursive delete removes them. What it
 * cannot reach is the grant at Intuit or Xero, which would otherwise go on
 * opening the business's books after the workspace that held it is gone. So
 * this revokes it first. A revoke that fails is reported, never fatal: the
 * workspace's data is erased either way, and the sealed token goes with it.
 */

import type { PluginOrgErasureReport, PluginOrgErasureRequest } from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import { readAccountingProviderConfig } from './accounting-config'
import { loadOrgConnection, openToken } from './connection-store'
import type { AccountingProvider } from './providers/provider'
import type { AccountingProviderId } from '../model/accounting.types'

export interface AccountingErasureDeps {
  firestore: () => FirebaseFirestore.Firestore
  providerFor: (provider: AccountingProviderId) => AccountingProvider | null
}

export function createAccountingOrgEraser(deps: AccountingErasureDeps) {
  return async (request: PluginOrgErasureRequest): Promise<PluginOrgErasureReport> => {
    const record = await loadOrgConnection(deps.firestore(), request.orgId)
    if (!record) return { connections: 0, revoked: 0 }
    if (request.dryRun) return { connections: 1, revoked: 0 }
    const adapter = deps.providerFor(record.provider)
    const config = readAccountingProviderConfig(record.provider)
    if (!adapter || !config.configured) return { connections: 1, revoked: 0, revokeSkipped: true }
    try {
      await adapter.revoke({
        refreshToken: openToken(config.config.keyring, record, 'refresh').token,
        accessToken: record.sealedAccessToken ? openToken(config.config.keyring, record, 'access').token : null,
        connectionId: record.connectionId,
      })
      return { connections: 1, revoked: 1 }
    } catch (error) {
      console.error('[accounting] revoke during workspace erasure failed', error)
      return { connections: 1, revoked: 0, revokeFailed: true }
    }
  }
}
