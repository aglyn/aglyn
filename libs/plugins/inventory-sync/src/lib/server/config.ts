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
  parseSecretBoxKeyring,
  sealSecret,
  type SecretBoxKeyring,
} from '@aglyn/shared-util-tools/secret-box'
import { INVENTORY_SYNC_CONNECTIONS_COLLECTION, INVENTORY_SYNC_ENV } from '../constants'
import { INVENTORY_PROVIDER_IDS, type InventoryProviderId } from '../model/inventory-sync'

/**
 * What this deployment can connect (AGL-3642), read from env on the console.
 *
 * - Cin7 Core and inFlow need nothing of Aglyn's: the merchant pastes their
 *   own account's API keys. They are offered once the token key that seals
 *   those keys is set.
 * - Brightpearl needs a developer app Aglyn registers with Brightpearl: its
 *   app reference (the OAuth client id), its developer reference, and its
 *   client secret when the app has confidential OAuth on. It is offered only
 *   when the app's references AND the token key are set.
 *
 * With no token key the plugin draws nothing, page or docs, and every route
 * answers as though it did not exist.
 *
 * Read in the bracket form, so a bundler never inlines a value.
 */

export interface BrightpearlAppConfig {
  appRef: string
  devRef: string
  /** Only for an app with confidential OAuth on. */
  clientSecret: string | null
}

export interface InventorySyncConfig {
  keyring: SecretBoxKeyring | null
  brightpearl: BrightpearlAppConfig | null
}

const read = (env: Record<string, string | undefined>, name: string) => String(env[name] ?? '').trim()

export function readInventorySyncConfig(env: Record<string, string | undefined> = process.env): InventorySyncConfig {
  let keyring: SecretBoxKeyring | null = null
  const key = read(env, INVENTORY_SYNC_ENV.tokenKey)
  if (key) {
    try {
      keyring = parseSecretBoxKeyring(key)
    } catch {
      keyring = null
    }
  }
  const appRef = read(env, INVENTORY_SYNC_ENV.brightpearlAppRef)
  const devRef = read(env, INVENTORY_SYNC_ENV.brightpearlDevRef)
  return {
    keyring,
    brightpearl:
      appRef && devRef
        ? { appRef, devRef, clientSecret: read(env, INVENTORY_SYNC_ENV.brightpearlClientSecret) || null }
        : null,
  }
}

/** The systems a merchant may connect here. Empty means the plugin shows nothing. */
export function offeredProviders(config: InventorySyncConfig): InventoryProviderId[] {
  if (!config.keyring) return []
  return INVENTORY_PROVIDER_IDS.filter((id) => id !== 'brightpearl' || config.brightpearl !== null)
}

/**
 * The secret half of a connection, sealed as one JSON value: the merchant's
 * API key (and Cin7 Core's account id, inFlow's company id), or Brightpearl's
 * access and refresh tokens.
 */
export type SealedCredentialPayload =
  | { provider: 'cin7-core'; accountId: string; apiKey: string }
  | { provider: 'inflow'; companyId: string; apiKey: string }
  | { provider: 'brightpearl'; accessToken: string; refreshToken: string | null }

/** The context a credential is sealed under: bound to its connection, so a moved value does not open. */
export const credentialSealContext = (connectionId: string) => `${INVENTORY_SYNC_CONNECTIONS_COLLECTION}/${connectionId}#credential`

export function sealCredential(
  payload: SealedCredentialPayload,
  connectionId: string,
  keyring: SecretBoxKeyring,
): string {
  return sealSecret(JSON.stringify(payload), keyring.current, { context: credentialSealContext(connectionId) })
}

/** Opens a sealed credential; throws when the key is gone, the value was moved or it is not ours. */
export function openCredential(
  sealed: string,
  connectionId: string,
  keyring: SecretBoxKeyring,
): { payload: SealedCredentialPayload; needsReseal: boolean } {
  const opened = openSecret(sealed, keyring, { context: credentialSealContext(connectionId) })
  const payload = JSON.parse(opened.plaintext) as SealedCredentialPayload
  if (!payload || typeof payload !== 'object' || !INVENTORY_PROVIDER_IDS.includes(payload.provider)) {
    throw new Error('not an inventory-sync credential')
  }
  return { payload, needsReseal: needsReseal(opened, keyring) }
}

/** The sentence a route answers when the deployment cannot connect anything. */
export const NOT_CONFIGURED_MESSAGE = 'Inventory sync is not available on this deployment.'
