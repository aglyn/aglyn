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

import { openSecret, sealSecret, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { connectionDocId } from '../../constants/bundle-common'
import { channelsCollection } from '../feed-store'
import type { ConnectProvider } from './config'

/**
 * A SITE'S CONNECTION TO A CHANNEL'S API (AGL-3637, phase 2), on
 * `hosts/{hostId}/salesChannels/connection-{provider}`.
 *
 * The OAuth token is SEALED with `secret-box` under `SALES_CHANNELS_TOKEN_KEY`
 * and the site and provider as context, so a sealed value copied onto another
 * site's document does not open. The collection is refused to every client
 * by the rules; only this plugin's console routes read it.
 */

export interface ConnectionDocument {
  provider: ConnectProvider
  /** The sealed refresh token (Google) or long-lived user token (Meta). */
  sealedToken: string
  /** Merchant Center account id (Google) or catalog id (Meta). */
  targetId: string
  targetName: string
  /** Every account or catalog the grant reaches, for the picker. */
  targets: Array<{ id: string; name: string }>
  connectedAtMs: number
  connectedBy: string
  /** Meta's long-lived token expires; epoch ms, when known. */
  tokenExpiresAtMs?: number
  /** What connecting registered on the channel's side: its scheduled feed. */
  scheduledFeedId?: string
  lastSyncAtMs?: number
  lastSyncResult?: { sent: number; failed: number; errors: string[]; deleted?: number; partial?: boolean }
}

const context = (hostId: string, provider: ConnectProvider) => `sales-channels:${provider}:${hostId}`

export function sealConnectionToken(
  token: string,
  keyring: SecretBoxKeyring,
  hostId: string,
  provider: ConnectProvider,
): string {
  return sealSecret(token, keyring.current, { context: context(hostId, provider) })
}

/** The plaintext token, or throws `SecretBoxError` for a token that does not open. */
export function openConnectionToken(
  connection: ConnectionDocument,
  keyring: SecretBoxKeyring,
  hostId: string,
): string {
  return openSecret(connection.sealedToken, keyring, { context: context(hostId, connection.provider) }).plaintext
}

export function readConnection(raw: FirebaseFirestore.DocumentData | undefined): ConnectionDocument | null {
  if (!raw || typeof raw['sealedToken'] !== 'string') return null
  const provider = raw['provider'] === 'meta' ? 'meta' : raw['provider'] === 'google' ? 'google' : null
  if (!provider) return null
  const targets = Array.isArray(raw['targets'])
    ? (raw['targets'] as Array<Record<string, unknown>>)
        .map((target) => ({ id: String(target?.['id'] ?? ''), name: String(target?.['name'] ?? '') }))
        .filter((target) => target.id)
        .slice(0, 50)
    : []
  return {
    provider,
    sealedToken: raw['sealedToken'],
    targetId: String(raw['targetId'] ?? ''),
    targetName: String(raw['targetName'] ?? ''),
    targets,
    connectedAtMs: Number(raw['connectedAtMs']) || 0,
    connectedBy: String(raw['connectedBy'] ?? ''),
    ...(Number(raw['tokenExpiresAtMs']) ? { tokenExpiresAtMs: Number(raw['tokenExpiresAtMs']) } : {}),
    ...(raw['scheduledFeedId'] ? { scheduledFeedId: String(raw['scheduledFeedId']) } : {}),
    ...(Number(raw['lastSyncAtMs']) ? { lastSyncAtMs: Number(raw['lastSyncAtMs']) } : {}),
    ...(raw['lastSyncResult'] && typeof raw['lastSyncResult'] === 'object'
      ? { lastSyncResult: raw['lastSyncResult'] as ConnectionDocument['lastSyncResult'] }
      : {}),
  }
}

export async function getConnection(hostId: string, provider: ConnectProvider): Promise<ConnectionDocument | null> {
  const snapshot = await channelsCollection(hostId).doc(connectionDocId(provider)).get()
  return snapshot.exists ? readConnection(snapshot.data()) : null
}

export async function saveConnection(hostId: string, connection: ConnectionDocument): Promise<void> {
  await channelsCollection(hostId).doc(connectionDocId(connection.provider)).set(connection)
}

export async function updateConnection(
  hostId: string,
  provider: ConnectProvider,
  patch: Partial<ConnectionDocument>,
): Promise<void> {
  await channelsCollection(hostId).doc(connectionDocId(provider)).set(patch, { merge: true })
}

export async function deleteConnection(hostId: string, provider: ConnectProvider): Promise<void> {
  await channelsCollection(hostId).doc(connectionDocId(provider)).delete()
}

/** What the console may see of a connection: never the token. */
export function publicConnection(connection: ConnectionDocument | null) {
  if (!connection) return null
  return {
    provider: connection.provider,
    targetId: connection.targetId,
    targetName: connection.targetName,
    targets: connection.targets,
    connectedAtMs: connection.connectedAtMs,
    ...(connection.tokenExpiresAtMs ? { tokenExpiresAtMs: connection.tokenExpiresAtMs } : {}),
    ...(connection.scheduledFeedId ? { scheduledFeedId: connection.scheduledFeedId } : {}),
    ...(connection.lastSyncAtMs ? { lastSyncAtMs: connection.lastSyncAtMs } : {}),
    ...(connection.lastSyncResult ? { lastSyncResult: connection.lastSyncResult } : {}),
  }
}
