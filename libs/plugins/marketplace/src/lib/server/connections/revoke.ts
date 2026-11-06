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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { readPluginConnectionsKeyring } from './config'
import { openToken, type PluginConnectionRecord } from './connection-store'
import { openCredentials } from './credentials-store'
import { installedConnection } from './installed-connection'
import { revokePluginConnectionToken } from './provider-http'

/**
 * Revokes a record's grant at the provider, best effort: a grant that cannot
 * be revoked is still forgotten here, and the owner can remove the app on the
 * provider's side. Never throws. Shared with the erasers.
 */
export async function revokeRecord(record: PluginConnectionRecord, orgId: string | null): Promise<boolean> {
  const keyring = readPluginConnectionsKeyring()
  if (!keyring) return false
  try {
    const found = await installedConnection(firebaseAdmin.app().firestore(), {
      hostId: record.hostId,
      orgId,
      listingId: record.listingId,
      connectionId: record.connectionId,
    })
    if (!found?.connection.revocationUrl) return false
    const client = await openCredentials(firebaseAdmin.app().firestore(), keyring, record.listingId, record.connectionId).catch(() => null)
    const token = record.sealedRefreshToken
      ? openToken(keyring, record, 'refresh').token
      : openToken(keyring, record, 'access').token
    return await revokePluginConnectionToken(found.connection, client, token)
  } catch (error) {
    console.warn('plugin-connections: revoke failed', error instanceof Error ? error.message : error)
    return false
  }
}

