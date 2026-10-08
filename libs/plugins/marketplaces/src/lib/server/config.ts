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
import { MARKETPLACE_CONNECTIONS_COLLECTION, MARKETPLACES_ENV } from '../constants'
import { MARKETPLACE_IDS, type MarketplaceId } from '../model/marketplaces'
import type { MarketplaceApp } from '../providers/provider'

/**
 * What this deployment can connect (AGL-3638), read from env on the console.
 *
 * Every marketplace needs an app registration Aglyn applies for — an Amazon
 * selling-partner app, an eBay developer keyset, an Etsy app, a TikTok Shop
 * partner app, a Walmart solution-provider app, a Faire integration. A
 * marketplace is offered only when its app's variables AND the token key are
 * set; with none configured the plugin draws nothing, page or docs, and
 * every route answers as though it did not exist.
 *
 * Read in the bracket form, so a bundler never inlines a value.
 */

export interface MarketplacesConfig {
  keyring: SecretBoxKeyring | null
  apps: Readonly<Record<MarketplaceId, MarketplaceApp | null>>
}

const read = (env: Record<string, string | undefined>, name: string) => String(env[name] ?? '').trim()

const isSandbox = (env: Record<string, string | undefined>, name: string) => read(env, name).toLowerCase() === 'sandbox'

const app = (
  clientId: string,
  clientSecret: string,
  sandbox: boolean,
  extra: Record<string, string> = {},
): MarketplaceApp | null => (clientId && clientSecret ? { clientId, clientSecret, sandbox, extra } : null)

export function readMarketplacesConfig(env: Record<string, string | undefined> = process.env): MarketplacesConfig {
  const E = MARKETPLACES_ENV
  let keyring: SecretBoxKeyring | null = null
  const key = read(env, E.tokenKey)
  if (key) {
    try {
      keyring = parseSecretBoxKeyring(key)
    } catch {
      keyring = null
    }
  }
  const region = read(env, E.amazonRegion).toLowerCase()
  const amazonApplicationId = read(env, E.amazonApplicationId)
  const ruName = read(env, E.ebayRuName)
  const serviceId = read(env, E.tiktokServiceId)
  return {
    keyring,
    apps: {
      amazon: amazonApplicationId
        ? app(read(env, E.amazonClientId), read(env, E.amazonClientSecret), isSandbox(env, E.amazonEnvironment), {
            applicationId: amazonApplicationId,
            region: region === 'eu' || region === 'fe' ? region : 'na',
            draft: read(env, E.amazonDraftApp).toLowerCase() === 'true' ? 'true' : 'false',
          })
        : null,
      // eBay's redirect is its RuName, without which no consent can come back.
      ebay: ruName
        ? app(read(env, E.ebayClientId), read(env, E.ebayClientSecret), isSandbox(env, E.ebayEnvironment), {
            ruName,
            // Which eBay site listings go to: EBAY_US unless the deployment says.
            ...(read(env, E.ebayMarketplaceId) ? { marketplaceId: read(env, E.ebayMarketplaceId) } : {}),
          })
        : null,
      // Etsy has no sandbox: a deployment's Etsy connections are always the real shop.
      etsy: app(read(env, E.etsyKeystring), read(env, E.etsySharedSecret), false),
      // TikTok Shop has no sandbox; `region` picks the US or the global consent page.
      tiktok: serviceId
        ? app(read(env, E.tiktokAppKey), read(env, E.tiktokAppSecret), false, {
            serviceId,
            region: read(env, E.tiktokRegion).toLowerCase() === 'global' ? 'global' : 'us',
          })
        : null,
      walmart: app(
        read(env, E.walmartClientId),
        read(env, E.walmartClientSecret),
        isSandbox(env, E.walmartEnvironment),
        read(env, E.walmartChannelType) ? { channelType: read(env, E.walmartChannelType) } : {},
      ),
      faire: app(read(env, E.faireApplicationId), read(env, E.faireApplicationSecret), false),
    },
  }
}

/** The marketplaces a merchant may connect here. Empty means the plugin shows nothing. */
export function offeredMarketplaces(config: MarketplacesConfig): MarketplaceId[] {
  if (!config.keyring) return []
  return MARKETPLACE_IDS.filter((id) => config.apps[id] !== null)
}

export type SealPurpose = 'access' | 'refresh' | 'verifier'

/** The context a secret is sealed under: bound to its connection and its purpose. */
export const grantSealContext = (connectionId: string, purpose: SealPurpose) =>
  `${MARKETPLACE_CONNECTIONS_COLLECTION}/${connectionId}#${purpose}`

export function sealGrant(value: string, connectionId: string, purpose: SealPurpose, keyring: SecretBoxKeyring): string {
  return sealSecret(value, keyring.current, { context: grantSealContext(connectionId, purpose) })
}

/** Opens a sealed secret; throws `SecretBoxError` when the key is gone or the value was moved. */
export function openGrant(
  sealed: string,
  connectionId: string,
  purpose: SealPurpose,
  keyring: SecretBoxKeyring,
): { value: string; needsReseal: boolean } {
  const opened = openSecret(sealed, keyring, { context: grantSealContext(connectionId, purpose) })
  return { value: opened.plaintext, needsReseal: needsReseal(opened, keyring) }
}

/** The sentence a route answers when the deployment cannot connect a marketplace. */
export const NOT_CONFIGURED_MESSAGE = 'Marketplaces are not available on this deployment.'
