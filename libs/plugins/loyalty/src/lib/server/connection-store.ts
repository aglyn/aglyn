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

import {
  needsReseal,
  openSecret,
  sealSecret,
} from '@aglyn/shared-util-tools/secret-box'
import {
  isLoyaltyConnectorId,
  LOYALTY_CONNECTOR_LABELS,
  type LoyaltyConnectionView,
  type LoyaltyConnectorCredentials,
  type LoyaltyConnectorId,
} from '../model/loyalty-connectors'
import { LOYALTY_COLLECTIONS } from '../constants/bundle-common'
import { readLoyaltyConnectorsKeyring } from './connector-config'
import { loyaltyRefs } from './db'

/**
 * A store's connection to its own Smile.io or Yotpo account (AGL-3677), at
 * `orgs/{orgId}/loyaltyConnections/{hostId}`: server-written and
 * server-read, closed to every client by the Firestore rules. The API key is
 * sealed with `secret-box` under `LOYALTY_CONNECTORS_TOKEN_KEY`, bound to the
 * site it belongs to, so a sealed key copied into another site's document
 * will not open. The field names carry `token`: the personal-data export
 * redacts by field name first.
 */

export interface StoredLoyaltyConnection {
  orgId: string
  hostId: string
  provider: LoyaltyConnectorId
  sealedApiToken: string
  apiTokenKeyId: string
  /** Yotpo's account GUID: an account id, not a secret. */
  guid: string | null
  keyLast4: string
  accountLabel: string | null
  connectedByUid: string
  connectedAtMs: number
  lastError: string | null
  lastSyncedAtMs: number | null
  updatedAtMs: number
}

/** The context a site's key is sealed under. */
export function loyaltyApiTokenContext(hostId: string): string {
  return `${LOYALTY_COLLECTIONS.connections}/${hostId}#apiToken`
}

export function sealLoyaltyApiToken(
  apiKey: string,
  hostId: string,
): { sealedApiToken: string; apiTokenKeyId: string } | null {
  const keyring = readLoyaltyConnectorsKeyring()
  if (!keyring) return null
  return {
    sealedApiToken: sealSecret(apiKey, keyring.current, {
      context: loyaltyApiTokenContext(hostId),
    }),
    apiTokenKeyId: keyring.current.id,
  }
}

/** A stored connection read defensively, or `null` when the document is not one. */
export function readStoredLoyaltyConnection(
  data: unknown,
): StoredLoyaltyConnection | null {
  if (!data || typeof data !== 'object') return null
  const source = data as Record<string, unknown>
  if (!isLoyaltyConnectorId(source['provider'])) return null
  if (typeof source['sealedApiToken'] !== 'string' || !source['sealedApiToken'])
    return null
  const text = (value: unknown) =>
    typeof value === 'string' && value ? value : null
  return {
    orgId: String(source['orgId'] ?? ''),
    hostId: String(source['hostId'] ?? ''),
    provider: source['provider'],
    sealedApiToken: source['sealedApiToken'] as string,
    apiTokenKeyId: String(source['apiTokenKeyId'] ?? ''),
    guid: text(source['guid']),
    keyLast4: String(source['keyLast4'] ?? ''),
    accountLabel: text(source['accountLabel']),
    connectedByUid: String(source['connectedByUid'] ?? ''),
    connectedAtMs: Number(source['connectedAtMs']) || 0,
    lastError: text(source['lastError']),
    lastSyncedAtMs: Number(source['lastSyncedAtMs']) || null,
    updatedAtMs: Number(source['updatedAtMs']) || 0,
  }
}

export async function readLoyaltyConnection(
  orgId: string,
  hostId: string,
): Promise<StoredLoyaltyConnection | null> {
  const snapshot = await loyaltyRefs.connection(orgId, hostId).get()
  return snapshot.exists ? readStoredLoyaltyConnection(snapshot.data()) : null
}

/** A connection with its key opened, ready for an adapter. */
export interface OpenLoyaltyConnection {
  connection: StoredLoyaltyConnection
  credentials: LoyaltyConnectorCredentials
}

/**
 * The connection and its opened credentials, or `null`: none, the deployment
 * holds no key, or the sealed key will not open (a key retired from the ring).
 * A key sealed under an earlier ring key is sealed again under the current one.
 */
export async function openLoyaltyConnection(
  orgId: string,
  hostId: string,
): Promise<OpenLoyaltyConnection | null> {
  const keyring = readLoyaltyConnectorsKeyring()
  if (!keyring) return null
  const connection = await readLoyaltyConnection(orgId, hostId)
  if (!connection) return null
  try {
    const opened = openSecret(connection.sealedApiToken, keyring, {
      context: loyaltyApiTokenContext(hostId),
    })
    if (needsReseal(opened, keyring)) {
      const resealed = sealLoyaltyApiToken(opened.plaintext, hostId)
      if (resealed)
        await loyaltyRefs
          .connection(orgId, hostId)
          .set(resealed, { merge: true })
          .catch(() => undefined)
    }
    return {
      connection,
      credentials: {
        apiKey: opened.plaintext,
        ...(connection.guid ? { guid: connection.guid } : {}),
      },
    }
  } catch (error) {
    console.error(
      '[loyalty] a connection key would not open',
      hostId,
      (error as Error)?.message,
    )
    return null
  }
}

/** Records how the last call to the vendor went, for the card. Never throws. */
export async function noteLoyaltyConnection(
  orgId: string,
  hostId: string,
  outcome:
    { ok: true; nowMs: number } | { ok: false; error: string; nowMs: number },
): Promise<void> {
  await loyaltyRefs
    .connection(orgId, hostId)
    .set(
      outcome.ok === true
        ? {
            lastError: null,
            lastSyncedAtMs: outcome.nowMs,
            updatedAtMs: outcome.nowMs,
          }
        : {
            lastError: outcome.error.slice(0, 200),
            updatedAtMs: outcome.nowMs,
          },
      { merge: true },
    )
    .catch(() => undefined)
}

export function toLoyaltyConnectionView(
  connection: StoredLoyaltyConnection,
): LoyaltyConnectionView {
  return {
    provider: connection.provider,
    label: LOYALTY_CONNECTOR_LABELS[connection.provider],
    accountLabel: connection.accountLabel,
    keyLast4: connection.keyLast4,
    connectedAtMs: connection.connectedAtMs,
    lastError: connection.lastError,
    lastSyncedAtMs: connection.lastSyncedAtMs,
  }
}
