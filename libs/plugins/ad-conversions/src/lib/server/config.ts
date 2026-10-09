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
import { AD_CONVERSION_CONNECTIONS_COLLECTION, AD_CONVERSIONS_ENV } from '../constants'

/**
 * The key merchants' access tokens are sealed under (AGL-3694), read from env
 * on the CONSOLE, the only process that opens one. Without it nothing can be
 * connected and the card says why.
 *
 * Read in the bracket form, so a bundler never inlines a value.
 */
export function readAdConversionsKeyring(
  env: Record<string, string | undefined> = process.env,
): SecretBoxKeyring | null {
  const key = String(env[AD_CONVERSIONS_ENV.tokenKey] ?? '').trim()
  if (!key) return null
  try {
    return parseSecretBoxKeyring(key)
  } catch {
    return null
  }
}

/** The context a token is sealed under: bound to its connection document, so a sealed value moved to another connection does not open. */
export const tokenSealContext = (connectionId: string) => `${AD_CONVERSION_CONNECTIONS_COLLECTION}/${connectionId}#token`

export function sealToken(value: string, connectionId: string, keyring: SecretBoxKeyring): string {
  return sealSecret(value, keyring.current, { context: tokenSealContext(connectionId) })
}

/** Opens a sealed token; throws `SecretBoxError` when the key is gone or the value was moved. */
export function openToken(
  sealed: string,
  connectionId: string,
  keyring: SecretBoxKeyring,
): { value: string; needsReseal: boolean } {
  const opened = openSecret(sealed, keyring, { context: tokenSealContext(connectionId) })
  return { value: opened.plaintext, needsReseal: needsReseal(opened, keyring) }
}
