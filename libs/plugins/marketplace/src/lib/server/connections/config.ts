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
 * THE ONE MODULE THAT READS DECLARED CONNECTIONS' KEY FROM THE ENVIRONMENT
 * (AGL-4193).
 *
 * - `PLUGIN_CONNECTIONS_TOKEN_KEY` — 32 random bytes, base64
 *   (`openssl rand -base64 32`), sealing every publisher OAuth client id and
 *   secret and every site's refresh and access token with `secret-box`. A
 *   comma-separated list rotates: the first key seals, every key listed opens.
 *
 * There is no provider credential here: the OAuth app is each PUBLISHER's,
 * stored per listing (`credentials-store.ts`). Unset, connections are off on
 * the deployment: every connect route answers 503 and the status route says
 * so, and nothing is ever stored unsealed. Read only by the console's server,
 * in the bracket form, so Next never inlines a value into a build.
 */

export const PLUGIN_CONNECTIONS_TOKEN_KEY_ENV = 'PLUGIN_CONNECTIONS_TOKEN_KEY'

/** The keyring, or `null` when the key is unset or unusable. Never throws. */
export function readPluginConnectionsKeyring(): SecretBoxKeyring | null {
  const value = String(process.env[PLUGIN_CONNECTIONS_TOKEN_KEY_ENV] ?? '').trim()
  if (!value) return null
  try {
    return parseSecretBoxKeyring(value)
  } catch {
    return null
  }
}

/**
 * A listing id: a resource uid (`[A-Za-z0-9_-]`). A connection id never holds
 * an underscore, so `{listingId}__{connectionId}` splits at its LAST `__`.
 */
export const isListingId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

/** A site id, as every host route reads one. */
export const isHostId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/') && !/^__.*__$/.test(value)
