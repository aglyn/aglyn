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
import { createSmileAdapter } from '../connectors/smile'
import type {
  LoyaltyVendorAdapter,
  LoyaltyVendorFetch,
} from '../connectors/types'
import { createYotpoAdapter } from '../connectors/yotpo'
import type { LoyaltyConnectorId } from '../model/loyalty-connectors'

/**
 * The deployment's half of a connected loyalty program (AGL-3677): ONE
 * variable, and no vendor account or app of Aglyn's. Each merchant brings
 * their own Smile.io API key or Yotpo GUID and API key; what the deployment
 * holds is the key those are sealed under.
 *
 * - `LOYALTY_CONNECTORS_TOKEN_KEY` — 32 random bytes, base64, sealing every
 *   stored Smile.io and Yotpo API key (`secret-box`, AES-256-GCM). A keyring
 *   (`id:base64,id:base64`, current first) rotates it.
 *
 * Without it nothing can be stored, so the connection card draws nothing, its
 * guide stays unlisted, and every store runs the built-in program.
 */

export const LOYALTY_CONNECTORS_ENV = {
  tokenKey: 'LOYALTY_CONNECTORS_TOKEN_KEY',
} as const

export function readLoyaltyConnectorsKeyring(): SecretBoxKeyring | null {
  const value = String(
    process.env[LOYALTY_CONNECTORS_ENV.tokenKey] ?? '',
  ).trim()
  if (!value) return null
  try {
    return parseSecretBoxKeyring(value)
  } catch (error) {
    console.error(
      `[loyalty] ${LOYALTY_CONNECTORS_ENV.tokenKey} is not a usable key`,
      (error as Error)?.message,
    )
    return null
  }
}

let fetchOverride: LoyaltyVendorFetch | null = null

/** Test seam: the `fetch` every adapter built here calls. */
export function setLoyaltyVendorFetchForTests(
  fetchImpl: LoyaltyVendorFetch | null,
): void {
  fetchOverride = fetchImpl
}

function vendorFetch(): LoyaltyVendorFetch {
  return fetchOverride ?? ((input, init) => fetch(input, init))
}

/** The adapter for one vendor. */
export function loyaltyVendorFor(id: LoyaltyConnectorId): LoyaltyVendorAdapter {
  return id === 'smile'
    ? createSmileAdapter(vendorFetch())
    : createYotpoAdapter(vendorFetch())
}
