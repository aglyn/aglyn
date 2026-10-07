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
  parseSecretBoxKeyring,
  type SecretBoxKeyring,
} from '@aglyn/shared-util-tools/secret-box'
import { createEasypostProvider } from '../providers/easypost'
import type { ProviderFetch } from '../providers/http'
import { createShippoProvider } from '../providers/shippo'
import type { ProviderAccount, ShippingProvider, ShippingProviderId } from '../providers/types'
import { OWN_ACCOUNT_KINDS, type OwnAccountKind } from '../model/own-accounts'

/**
 * THE ONE MODULE THAT READS SHIPPING'S CREDENTIALS FROM THE ENVIRONMENT
 * (AGL-3612). Server-only: nothing here is imported by a client module.
 *
 * - `SHIPPO_API_TOKEN` — the platform's Shippo token (Platform Accounts). Set,
 *   Shippo is the provider.
 * - `EASYPOST_API_KEY` — the platform's EasyPost key (Child Users). The
 *   provider when Shippo's token is unset, or when `SHIPPING_PROVIDER` says
 *   `easypost`.
 * - `SHIPPING_TOKEN_KEY` — 32 random bytes, base64, sealing every stored
 *   account id and child key through the shared secret box. A comma-separated
 *   list rotates: the first seals, the rest only open.
 * - `SHIPPO_WEBHOOK_TOKEN` — the token Shippo's webhook URL carries
 *   (`?token=`), Shippo's "self-generated token" option. Optional
 *   `SHIPPO_WEBHOOK_HMAC_SECRET`: when set, the `Shippo-Auth-Signature`
 *   header is verified as well.
 * - `EASYPOST_WEBHOOK_SECRET` — the `webhook_secret` EasyPost signs each
 *   event with (`X-Hmac-Signature`).
 *
 * With no provider credential, or no sealing key, the plugin is NOT
 * CONFIGURED: every card, rate kind and route answers as though it did not
 * exist. Read in the bracket form so Next never inlines a value.
 */

export const SHIPPING_ENV = {
  shippoToken: 'SHIPPO_API_TOKEN',
  easypostKey: 'EASYPOST_API_KEY',
  provider: 'SHIPPING_PROVIDER',
  tokenKey: 'SHIPPING_TOKEN_KEY',
  shippoWebhookToken: 'SHIPPO_WEBHOOK_TOKEN',
  shippoWebhookHmac: 'SHIPPO_WEBHOOK_HMAC_SECRET',
  easypostWebhookSecret: 'EASYPOST_WEBHOOK_SECRET',
  ownAccountProviders: 'SHIPPING_OWN_ACCOUNT_PROVIDERS',
} as const

export interface ShippingConfig {
  provider: ShippingProvider
  providerId: ShippingProviderId
  keyring: SecretBoxKeyring
  /** Whether the provider credential is a test one: labels cost nothing. */
  testMode: boolean
  /**
   * Set when the workspace ships on an account of its OWN (AGL-3632): the
   * merchant's Easyship or Sendcloud credentials, opened. Labels are billed
   * to the merchant by that platform, so nothing is recovered here, and no
   * account is ever opened for the workspace.
   */
  ownAccount?: ProviderAccount
}

export type ShippingConfigResult =
  | { configured: true; config: ShippingConfig }
  | { configured: false; missing: string[] }

function env(name: string): string {
  return String(process.env[name] ?? '').trim()
}

let fetchOverride: ProviderFetch | null = null

/** Test seam: the `fetch` every provider built here calls. */
export function setShippingFetchForTests(fetchImpl: ProviderFetch | null): void {
  fetchOverride = fetchImpl
}

/** Reads the variables. Never throws; an unusable key counts as missing. */
export function readShippingConfig(): ShippingConfigResult {
  const shippoToken = env(SHIPPING_ENV.shippoToken)
  const easypostKey = env(SHIPPING_ENV.easypostKey)
  const preferred = env(SHIPPING_ENV.provider).toLowerCase()
  const missing: string[] = []
  let keyring: SecretBoxKeyring | null = null
  const tokenKey = env(SHIPPING_ENV.tokenKey)
  if (tokenKey) {
    try {
      keyring = parseSecretBoxKeyring(tokenKey)
    } catch {
      keyring = null
    }
  }
  if (!keyring) missing.push(SHIPPING_ENV.tokenKey)
  const useEasypost = Boolean(easypostKey) && (!shippoToken || preferred === 'easypost')
  if (!shippoToken && !easypostKey) {
    missing.push(SHIPPING_ENV.shippoToken)
  }
  if (missing.length || !keyring) return { configured: false, missing }
  const fetchImpl = fetchOverride ?? undefined
  if (useEasypost) {
    return {
      configured: true,
      config: {
        provider: createEasypostProvider({ apiKey: easypostKey, ...(fetchImpl ? { fetchImpl } : {}) }),
        providerId: 'easypost',
        keyring,
        testMode: easypostKey.startsWith('EZTK'),
      },
    }
  }
  return {
    configured: true,
    config: {
      provider: createShippoProvider({ token: shippoToken, ...(fetchImpl ? { fetchImpl } : {}) }),
      providerId: 'shippo',
      keyring,
      testMode: shippoToken.startsWith('shippo_test_'),
    },
  }
}

/** Whether the deployment can ship at all. */
export function isShippingConfigured(): boolean {
  return readShippingConfig().configured
}

/** The Shippo webhook's URL token and optional HMAC secret. */
export function readShippoWebhookSecrets(): { token: string; hmacSecret: string } {
  return { token: env(SHIPPING_ENV.shippoWebhookToken), hmacSecret: env(SHIPPING_ENV.shippoWebhookHmac) }
}

/** EasyPost's webhook secret. */
export function readEasypostWebhookSecret(): string {
  return env(SHIPPING_ENV.easypostWebhookSecret)
}

/** The deployment's sealing key, or `null` when it is unset or unusable. */
export function readShippingKeyring(): SecretBoxKeyring | null {
  const tokenKey = env(SHIPPING_ENV.tokenKey)
  if (!tokenKey) return null
  try {
    return parseSecretBoxKeyring(tokenKey)
  } catch {
    return null
  }
}

/**
 * The merchant-account services this deployment offers (AGL-3632): the ones
 * `SHIPPING_OWN_ACCOUNT_PROVIDERS` names (`easyship,sendcloud,shipperhq`),
 * and none without the sealing key their credentials are kept under.
 *
 * Aglyn holds no account with any of them — each merchant brings their own
 * — but every adapter is switched on by name, one at a time, once it has
 * been tried against the vendor's live API with a real merchant account
 * (the runbook on AGL-3632). Unnamed, a service shows nowhere.
 */
export function readOwnAccountKinds(): OwnAccountKind[] {
  if (!readShippingKeyring()) return []
  const named = new Set(
    env(SHIPPING_ENV.ownAccountProviders)
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean),
  )
  return OWN_ACCOUNT_KINDS.filter((kind) => named.has(kind))
}

/** The `fetch` a provider built outside this module calls: the test seam's, or the global. */
export function shippingFetch(): ProviderFetch {
  return fetchOverride ?? ((input, init) => fetch(input, init))
}

/**
 * Whether ANY shipping surface exists on this deployment: a platform
 * provider, or a merchant-account service a workspace could connect.
 */
export function isShippingSurfaceConfigured(): boolean {
  return readShippingConfig().configured || readOwnAccountKinds().length > 0
}

/** The sentence every route answers for an unconfigured deployment. */
export const SHIPPING_NOT_CONFIGURED_MESSAGE =
  'Carrier rates and labels are not available on this deployment.'
