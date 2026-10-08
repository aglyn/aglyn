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
import type { PodProviderId } from '../model/print-on-demand'
import type { ProviderFetch } from '../providers/http'
import { createPrintfulProvider } from '../providers/printful'
import { createPrintifyProvider } from '../providers/printify'
import type { PodProvider } from '../providers/types'

/**
 * The deployment's half of print-on-demand (AGL-3641): ONE variable, and no
 * account of Aglyn's with either service. Each merchant brings a token made
 * in their own Printful or Printify account — neither needs a developer app
 * or partnership of Aglyn's — and the deployment holds only the key those
 * tokens are sealed under.
 *
 * - `PRINT_ON_DEMAND_TOKEN_KEY` — 32 random bytes, base64, sealing every
 *   stored token and webhook secret (`secret-box`, AES-256-GCM). A keyring
 *   (`id:base64,id:base64`, current first) rotates it.
 *
 * Without it nothing can be stored, so every surface draws nothing and no
 * order is sent anywhere. It is read on the console (connecting, importing,
 * the job) and on whichever server delivers commerce's order events.
 */

export const POD_ENV = {
  tokenKey: 'PRINT_ON_DEMAND_TOKEN_KEY',
} as const

export const POD_NOT_CONFIGURED_MESSAGE = 'Print on demand is not available on this deployment.'

export function readPodKeyring(): SecretBoxKeyring | null {
  const value = String(process.env[POD_ENV.tokenKey] ?? '').trim()
  if (!value) return null
  try {
    return parseSecretBoxKeyring(value)
  } catch (error) {
    console.error(`[print-on-demand] ${POD_ENV.tokenKey} is not a usable key`, (error as Error)?.message)
    return null
  }
}

let fetchOverride: ProviderFetch | null = null

/** Test seam: the `fetch` every adapter built here calls. */
export function setPodFetchForTests(fetchImpl: ProviderFetch | null): void {
  fetchOverride = fetchImpl
}

export function podFetch(): ProviderFetch {
  return fetchOverride ?? ((input, init) => fetch(input, init))
}

/** The adapter for one service. */
export function podProviderFor(id: PodProviderId): PodProvider {
  return id === 'printful' ? createPrintfulProvider(podFetch()) : createPrintifyProvider(podFetch())
}
