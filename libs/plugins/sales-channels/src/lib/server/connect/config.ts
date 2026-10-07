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

import { parseSecretBoxKeyring, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'

/**
 * THE ONE MODULE THAT READS THE CHANNEL CONNECTIONS' CREDENTIALS FROM THE
 * ENVIRONMENT (AGL-3637, phase 2).
 *
 * - `GOOGLE_MERCHANT_CLIENT_ID` and `GOOGLE_MERCHANT_CLIENT_SECRET` — the
 *   Google Cloud OAuth client a merchant's Google account grants Merchant
 *   Center access to (the `content` scope, which needs Google's consent
 *   screen verification before it serves anyone outside the project).
 * - `META_CATALOG_APP_ID` and `META_CATALOG_APP_SECRET` — the Meta app a
 *   merchant's Facebook login grants `catalog_management` and
 *   `business_management` to (App Review and business verification first).
 * - `META_GRAPH_API_VERSION` — optional, the Graph API version; `v26.0`
 *   when unset.
 * - `SALES_CHANNELS_TOKEN_KEY` — 32 random bytes, base64, sealing every
 *   stored OAuth token with `secret-box`. A comma-separated list rotates:
 *   the first key seals, the rest only open.
 *
 * A provider is CONFIGURED only when its two variables and the token key are
 * all set and usable; until then its connect button, its routes and its docs
 * do not exist. Read only by the console's server: the routes that use these
 * are registered from `consoleApi`, never from the tenant runtime, which
 * serves the public internet. Read in the bracket form, so Next never
 * inlines a value into a build.
 */

export type ConnectProvider = 'google' | 'meta'

export const CONNECT_PROVIDERS: readonly ConnectProvider[] = ['google', 'meta']

export const SALES_CHANNELS_ENV = {
  googleClientId: 'GOOGLE_MERCHANT_CLIENT_ID',
  googleClientSecret: 'GOOGLE_MERCHANT_CLIENT_SECRET',
  metaAppId: 'META_CATALOG_APP_ID',
  metaAppSecret: 'META_CATALOG_APP_SECRET',
  metaGraphVersion: 'META_GRAPH_API_VERSION',
  tokenKey: 'SALES_CHANNELS_TOKEN_KEY',
} as const

export const META_DEFAULT_GRAPH_VERSION = 'v26.0'

export interface ProviderConfig {
  provider: ConnectProvider
  clientId: string
  clientSecret: string
  keyring: SecretBoxKeyring
  /** Meta only. */
  graphVersion: string
}

export type ProviderConfigResult =
  | { configured: true; config: ProviderConfig }
  | { configured: false; missing: string[] }

const env = (name: string): string => String(process.env[name] ?? '').trim()

function readKeyring(): SecretBoxKeyring | null {
  const value = env(SALES_CHANNELS_ENV.tokenKey)
  if (!value) return null
  try {
    return parseSecretBoxKeyring(value)
  } catch {
    return null
  }
}

/** Reads one provider's variables. Never throws; an unusable key counts as missing. */
export function readProviderConfig(provider: ConnectProvider): ProviderConfigResult {
  const idName = provider === 'google' ? SALES_CHANNELS_ENV.googleClientId : SALES_CHANNELS_ENV.metaAppId
  const secretName =
    provider === 'google' ? SALES_CHANNELS_ENV.googleClientSecret : SALES_CHANNELS_ENV.metaAppSecret
  const clientId = env(idName)
  const clientSecret = env(secretName)
  const keyring = readKeyring()
  const missing: string[] = []
  if (!clientId) missing.push(idName)
  if (!clientSecret) missing.push(secretName)
  if (!keyring) missing.push(SALES_CHANNELS_ENV.tokenKey)
  if (missing.length || !keyring) return { configured: false, missing }
  const version = env(SALES_CHANNELS_ENV.metaGraphVersion)
  return {
    configured: true,
    config: {
      provider,
      clientId,
      clientSecret,
      keyring,
      graphVersion: /^v\d+\.\d+$/.test(version) ? version : META_DEFAULT_GRAPH_VERSION,
    },
  }
}

/** The providers this deployment can connect. */
export function configuredProviders(): ConnectProvider[] {
  return CONNECT_PROVIDERS.filter((provider) => readProviderConfig(provider).configured)
}
