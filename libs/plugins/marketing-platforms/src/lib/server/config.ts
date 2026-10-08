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
import { MARKETING_PLATFORM_CONNECTIONS_COLLECTION, MARKETING_PLATFORMS_ENV } from '../constants'
import {
  MARKETING_PROVIDER_IDS,
  MARKETING_PROVIDERS,
  type MarketingProviderId,
} from '../model/connections'

/**
 * What this deployment can connect (AGL-3639), read from env on the console.
 *
 * The token key is the floor: nothing is stored without it, so with it unset
 * every provider is unavailable and the page says why. Above it, a provider
 * is offered by API key when it takes one (Mailchimp, Klaviyo, Omnisend) and
 * by OAuth when its app registration is set. Attentive and Constant Contact
 * take no API key, so each is offered only with its app — hidden otherwise,
 * page and docs — and either one's absence changes nothing for the others.
 *
 * Read in the bracket form, so a bundler never inlines a value.
 */

export interface OAuthClient {
  clientId: string
  clientSecret: string
}

export interface MarketingPlatformsConfig {
  keyring: SecretBoxKeyring | null
  oauth: Partial<Record<MarketingProviderId, OAuthClient>>
}

export interface ProviderAvailability {
  id: MarketingProviderId
  apiKey: boolean
  oauth: boolean
}

const read = (env: Record<string, string | undefined>, name: string) => String(env[name] ?? '').trim()

export function readMarketingPlatformsConfig(
  env: Record<string, string | undefined> = process.env,
): MarketingPlatformsConfig {
  let keyring: SecretBoxKeyring | null = null
  const key = read(env, MARKETING_PLATFORMS_ENV.tokenKey)
  if (key) {
    try {
      keyring = parseSecretBoxKeyring(key)
    } catch {
      keyring = null
    }
  }
  const oauth: Partial<Record<MarketingProviderId, OAuthClient>> = {}
  const pairs: Array<[MarketingProviderId, string, string]> = [
    ['mailchimp', MARKETING_PLATFORMS_ENV.mailchimpClientId, MARKETING_PLATFORMS_ENV.mailchimpClientSecret],
    ['klaviyo', MARKETING_PLATFORMS_ENV.klaviyoClientId, MARKETING_PLATFORMS_ENV.klaviyoClientSecret],
    ['attentive', MARKETING_PLATFORMS_ENV.attentiveClientId, MARKETING_PLATFORMS_ENV.attentiveClientSecret],
    [
      'constant-contact',
      MARKETING_PLATFORMS_ENV.constantContactClientId,
      MARKETING_PLATFORMS_ENV.constantContactClientSecret,
    ],
  ]
  for (const [id, idVar, secretVar] of pairs) {
    const clientId = read(env, idVar)
    const clientSecret = read(env, secretVar)
    if (clientId && clientSecret) oauth[id] = { clientId, clientSecret }
  }
  return { keyring, oauth }
}

/** Which providers the page offers, and how. A provider with neither is not shown. */
export function providerAvailability(config: MarketingPlatformsConfig): ProviderAvailability[] {
  return MARKETING_PROVIDER_IDS.map((id) => ({
    id,
    apiKey: Boolean(config.keyring && MARKETING_PROVIDERS[id].apiKey),
    oauth: Boolean(config.keyring && config.oauth[id]),
  })).filter((entry) => entry.apiKey || entry.oauth)
}

/** The context a connection's secret is sealed under: bound to its document and its purpose. */
export const credentialSealContext = (connectionId: string, purpose: 'token' | 'refresh') =>
  `${MARKETING_PLATFORM_CONNECTIONS_COLLECTION}/${connectionId}#${purpose}`

export function sealCredential(
  value: string,
  connectionId: string,
  purpose: 'token' | 'refresh',
  keyring: SecretBoxKeyring,
): string {
  return sealSecret(value, keyring.current, { context: credentialSealContext(connectionId, purpose) })
}

/** Opens a sealed secret; throws `SecretBoxError` when the key is gone or the value was moved. */
export function openCredential(
  sealed: string,
  connectionId: string,
  purpose: 'token' | 'refresh',
  keyring: SecretBoxKeyring,
): { value: string; needsReseal: boolean } {
  const opened = openSecret(sealed, keyring, { context: credentialSealContext(connectionId, purpose) })
  return { value: opened.plaintext, needsReseal: needsReseal(opened, keyring) }
}
