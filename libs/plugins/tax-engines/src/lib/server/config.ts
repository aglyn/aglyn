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
import type { TaxEngineProviderId } from '../model/tax-engines'
import { createAvalaraProvider } from '../providers/avalara'
import type { ProviderFetch } from '../providers/http'
import { createTaxJarProvider } from '../providers/taxjar'
import type { TaxProvider } from '../providers/types'

/**
 * The deployment's half of a tax engine (AGL-3631): ONE variable, and no
 * vendor account of Aglyn's. Each merchant brings their own Avalara or TaxJar
 * credentials; what the deployment holds is the key their credentials are
 * sealed under.
 *
 * - `TAX_ENGINES_TOKEN_KEY` — 32 random bytes, base64, sealing every stored
 *   AvaTax license key and TaxJar API token (`secret-box`, AES-256-GCM). A
 *   keyring (`id:base64,id:base64`, current first) rotates it.
 *
 * Without it nothing can be stored, so every surface says the deployment
 * cannot connect a tax engine and draws nothing else, and checkout prices tax
 * the way the store's own settings do.
 */

export const TAX_ENGINES_ENV = {
  tokenKey: 'TAX_ENGINES_TOKEN_KEY',
} as const

export const TAX_ENGINES_NOT_CONFIGURED_MESSAGE =
  'Tax services are not available on this deployment.'

export function readTaxEnginesKeyring(): SecretBoxKeyring | null {
  const value = String(process.env[TAX_ENGINES_ENV.tokenKey] ?? '').trim()
  if (!value) return null
  try {
    return parseSecretBoxKeyring(value)
  } catch (error) {
    console.error(`[tax-engines] ${TAX_ENGINES_ENV.tokenKey} is not a usable key`, (error as Error)?.message)
    return null
  }
}

let fetchOverride: ProviderFetch | null = null

/** Test seam: the `fetch` every provider built here calls. */
export function setTaxEnginesFetchForTests(fetchImpl: ProviderFetch | null): void {
  fetchOverride = fetchImpl
}

function providerFetch(): ProviderFetch {
  return fetchOverride ?? ((input, init) => fetch(input, init))
}

/** The adapter for one vendor. */
export function taxProviderFor(id: TaxEngineProviderId): TaxProvider {
  return id === 'avalara' ? createAvalaraProvider(providerFetch()) : createTaxJarProvider(providerFetch())
}
