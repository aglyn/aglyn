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
import { POST_PURCHASE_VENDORS, type PostPurchaseVendor } from '../constants/bundle-common'
import type { ProviderFetch } from '../providers/http'

/**
 * THE ONE MODULE THAT READS POST-PURCHASE'S ENVIRONMENT (AGL-3635).
 * Server-only.
 *
 * Every service is the MERCHANT's own account — their AfterShip key, their
 * Route token, their Narvar credentials — so the deployment holds no vendor
 * secret of its own. What it holds is the decision to offer each one, which
 * waits on Aglyn's partner approval with that vendor, and the key that seals
 * what merchants paste in:
 *
 * - `POST_PURCHASE_VENDORS` — the services this deployment offers, comma
 *   separated: `aftership`, `route`, `narvar`. Unset, the plugin offers none
 *   and every surface hides.
 * - `POST_PURCHASE_TOKEN_KEY` — 32 random bytes, base64, sealing every
 *   stored credential through the shared secret box. A comma-separated list
 *   rotates: the first seals, the rest only open.
 * - `ROUTE_API_BASE` (optional) — Route's API root; its sandbox for a test
 *   deployment. Defaults to production.
 * - `NARVAR_API_BASE` (optional) — Narvar's API root; defaults to production.
 *
 * Read in the bracket form so Next never inlines a value.
 */

export const POST_PURCHASE_ENV = {
  vendors: 'POST_PURCHASE_VENDORS',
  tokenKey: 'POST_PURCHASE_TOKEN_KEY',
  routeApiBase: 'ROUTE_API_BASE',
  narvarApiBase: 'NARVAR_API_BASE',
} as const

export const AFTERSHIP_API_BASE = 'https://api.aftership.com/tracking/2024-04'
export const ROUTE_API_BASE = 'https://api.route.com/v2'
export const NARVAR_API_BASE = 'https://ws.narvar.com/api/v1'

export interface PostPurchaseConfig {
  vendors: ReadonlySet<PostPurchaseVendor>
  keyring: SecretBoxKeyring
  routeApiBase: string
  narvarApiBase: string
  fetchImpl?: ProviderFetch
}

export type PostPurchaseConfigResult =
  | { configured: true; config: PostPurchaseConfig }
  | { configured: false; missing: string[] }

function env(name: string): string {
  return String(process.env[name] ?? '').trim()
}

let fetchOverride: ProviderFetch | null = null

/** Test seam: the `fetch` every vendor call made here goes through. */
export function setPostPurchaseFetchForTests(fetchImpl: ProviderFetch | null): void {
  fetchOverride = fetchImpl
}

function httpsBase(value: string, fallback: string): string {
  if (!value) return fallback
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString().replace(/\/+$/, '') : fallback
  } catch {
    return fallback
  }
}

/** Reads the variables. Never throws; an unusable key counts as missing. */
export function readPostPurchaseConfig(): PostPurchaseConfigResult {
  const vendors = new Set(
    env(POST_PURCHASE_ENV.vendors)
      .toLowerCase()
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry): entry is PostPurchaseVendor => (POST_PURCHASE_VENDORS as readonly string[]).includes(entry)),
  )
  const missing: string[] = []
  if (!vendors.size) missing.push(POST_PURCHASE_ENV.vendors)
  let keyring: SecretBoxKeyring | null = null
  const tokenKey = env(POST_PURCHASE_ENV.tokenKey)
  if (tokenKey) {
    try {
      keyring = parseSecretBoxKeyring(tokenKey)
    } catch {
      keyring = null
    }
  }
  if (!keyring) missing.push(POST_PURCHASE_ENV.tokenKey)
  if (missing.length || !keyring) return { configured: false, missing }
  return {
    configured: true,
    config: {
      vendors,
      keyring,
      routeApiBase: httpsBase(env(POST_PURCHASE_ENV.routeApiBase), ROUTE_API_BASE),
      narvarApiBase: httpsBase(env(POST_PURCHASE_ENV.narvarApiBase), NARVAR_API_BASE),
      ...(fetchOverride ? { fetchImpl: fetchOverride } : {}),
    },
  }
}

/** Whether the deployment offers `vendor`. */
export function offersVendor(config: PostPurchaseConfig, vendor: PostPurchaseVendor): boolean {
  return config.vendors.has(vendor)
}

/** The sentence every route answers for an unconfigured deployment. */
export const POST_PURCHASE_NOT_CONFIGURED_MESSAGE =
  'Tracking and package protection services are not available on this deployment.'
