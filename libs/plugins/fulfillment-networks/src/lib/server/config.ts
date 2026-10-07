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
import { FULFILLMENT_NETWORK_CONNECTIONS_COLLECTION, FULFILLMENT_NETWORKS_ENV } from '../constants'
import { NETWORK_PROVIDER_IDS, type NetworkProviderId } from '../model/networks'
import type { AmazonRegion } from '../providers/amazon-mcf'

/**
 * What this deployment can connect (AGL-3634), read from env on the console.
 *
 * Both networks need an app registration Aglyn applies for: a ShipBob
 * developer app, and an Amazon selling-partner app (with its Login with
 * Amazon client). A network is offered only when its app's variables AND the
 * token key are set; with neither network configured the plugin draws
 * nothing, page or docs, and every route answers as though it did not exist.
 *
 * Read in the bracket form, so a bundler never inlines a value.
 */

export interface ShipbobApp {
  clientId: string
  clientSecret: string
  sandbox: boolean
}

export interface AmazonApp {
  applicationId: string
  clientId: string
  clientSecret: string
  region: AmazonRegion
  sandbox: boolean
  /** A draft app's consent page needs `version=beta` until Amazon publishes it. */
  draft: boolean
}

export interface FulfillmentNetworksConfig {
  keyring: SecretBoxKeyring | null
  shipbob: ShipbobApp | null
  amazon: AmazonApp | null
}

const read = (env: Record<string, string | undefined>, name: string) => String(env[name] ?? '').trim()

export function readFulfillmentNetworksConfig(
  env: Record<string, string | undefined> = process.env,
): FulfillmentNetworksConfig {
  let keyring: SecretBoxKeyring | null = null
  const key = read(env, FULFILLMENT_NETWORKS_ENV.tokenKey)
  if (key) {
    try {
      keyring = parseSecretBoxKeyring(key)
    } catch {
      keyring = null
    }
  }
  const shipbobId = read(env, FULFILLMENT_NETWORKS_ENV.shipbobClientId)
  const shipbobSecret = read(env, FULFILLMENT_NETWORKS_ENV.shipbobClientSecret)
  const amazonApp = read(env, FULFILLMENT_NETWORKS_ENV.amazonApplicationId)
  const amazonId = read(env, FULFILLMENT_NETWORKS_ENV.amazonClientId)
  const amazonSecret = read(env, FULFILLMENT_NETWORKS_ENV.amazonClientSecret)
  const region = read(env, FULFILLMENT_NETWORKS_ENV.amazonRegion).toLowerCase()
  return {
    keyring,
    shipbob:
      shipbobId && shipbobSecret
        ? {
            clientId: shipbobId,
            clientSecret: shipbobSecret,
            sandbox: read(env, FULFILLMENT_NETWORKS_ENV.shipbobEnvironment).toLowerCase() === 'sandbox',
          }
        : null,
    amazon:
      amazonApp && amazonId && amazonSecret
        ? {
            applicationId: amazonApp,
            clientId: amazonId,
            clientSecret: amazonSecret,
            region: region === 'eu' || region === 'fe' ? region : 'na',
            sandbox: read(env, FULFILLMENT_NETWORKS_ENV.amazonEnvironment).toLowerCase() === 'sandbox',
            draft: read(env, FULFILLMENT_NETWORKS_ENV.amazonDraftApp).toLowerCase() === 'true',
          }
        : null,
  }
}

/** The networks a merchant may connect here. Empty means the plugin shows nothing. */
export function offeredNetworks(config: FulfillmentNetworksConfig): NetworkProviderId[] {
  if (!config.keyring) return []
  return NETWORK_PROVIDER_IDS.filter((id) => (id === 'shipbob' ? config.shipbob : config.amazon) !== null)
}

/** Whether the network's sandbox is where this deployment's connections go. */
export function networkSandbox(config: FulfillmentNetworksConfig, provider: NetworkProviderId): boolean {
  return provider === 'shipbob' ? config.shipbob?.sandbox === true : config.amazon?.sandbox === true
}

export type SealPurpose = 'access' | 'refresh'

/** The context a grant is sealed under: bound to its connection and its purpose. */
export const grantSealContext = (connectionId: string, purpose: SealPurpose) =>
  `${FULFILLMENT_NETWORK_CONNECTIONS_COLLECTION}/${connectionId}#${purpose}`

export function sealGrant(value: string, connectionId: string, purpose: SealPurpose, keyring: SecretBoxKeyring): string {
  return sealSecret(value, keyring.current, { context: grantSealContext(connectionId, purpose) })
}

/** Opens a sealed grant; throws `SecretBoxError` when the key is gone or the value was moved. */
export function openGrant(
  sealed: string,
  connectionId: string,
  purpose: SealPurpose,
  keyring: SecretBoxKeyring,
): { value: string; needsReseal: boolean } {
  const opened = openSecret(sealed, keyring, { context: grantSealContext(connectionId, purpose) })
  return { value: opened.plaintext, needsReseal: needsReseal(opened, keyring) }
}

/** The sentence a route answers when the deployment cannot connect a network. */
export const NOT_CONFIGURED_MESSAGE = 'Fulfillment networks are not available on this deployment.'
