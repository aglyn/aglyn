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
import type { ProviderFetch } from '../providers/http'

/**
 * THE ONE MODULE THAT READS REVIEW PLATFORMS' ENVIRONMENT (AGL-3699).
 * Server-only.
 *
 * Every service is the MERCHANT's own account, so the deployment holds no
 * vendor secret and needs no partner app. What it holds is the key that
 * seals what merchants paste in:
 *
 * - `REVIEW_PLATFORMS_TOKEN_KEY` — 32 random bytes, base64, sealing every
 *   stored Trustpilot API key and secret and Yotpo secret key through the
 *   shared secret box. A keyring (`id:base64,id:base64`, current first)
 *   rotates it.
 *
 * Without it nothing can be sealed, so the Trustpilot API mode and Yotpo are
 * not offered. Trustpilot's BCC invitation address needs no key and is
 * always offered.
 *
 * Read in the bracket form so Next never inlines a value.
 */

export const REVIEW_PLATFORMS_ENV = {
  tokenKey: 'REVIEW_PLATFORMS_TOKEN_KEY',
} as const

export interface ReviewPlatformsConfig {
  /** `null` when no key is set: API credentials can be neither kept nor opened. */
  keyring: SecretBoxKeyring | null
  fetchImpl?: ProviderFetch
}

let fetchOverride: ProviderFetch | null = null

/** Test seam: the `fetch` every service call made here goes through. */
export function setReviewPlatformsFetchForTests(fetchImpl: ProviderFetch | null): void {
  fetchOverride = fetchImpl
}

/** Reads the variable. Never throws; an unusable key counts as none. */
export function readReviewPlatformsConfig(): ReviewPlatformsConfig {
  const value = String(process.env[REVIEW_PLATFORMS_ENV.tokenKey] ?? '').trim()
  let keyring: SecretBoxKeyring | null = null
  if (value) {
    try {
      keyring = parseSecretBoxKeyring(value)
    } catch (error) {
      console.error(`[review-platforms] ${REVIEW_PLATFORMS_ENV.tokenKey} is not a usable key`, (error as Error)?.message)
    }
  }
  return { keyring, ...(fetchOverride ? { fetchImpl: fetchOverride } : {}) }
}

/** Whether the deployment can keep API credentials. */
export function apiConnectionsAvailable(config: ReviewPlatformsConfig): boolean {
  return Boolean(config.keyring)
}
