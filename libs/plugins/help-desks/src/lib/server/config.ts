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
import { HELP_DESK_CONNECTIONS_COLLECTION, HELP_DESKS_ENV } from '../constants'
import { HELP_DESK_PROVIDER_IDS, type HelpDeskProviderId } from '../model/connections'

/**
 * What this deployment can connect (AGL-3824), read from env on the console.
 *
 * The token key is the whole gate: every help desk takes the merchant's own
 * key, so nothing else is needed, and with the key unset nothing can be
 * stored, every provider is unavailable and the card draws nothing.
 *
 * Read in the bracket form, so a bundler never inlines a value.
 */

export interface HelpDesksConfig {
  keyring: SecretBoxKeyring | null
}

export function readHelpDesksConfig(env: Record<string, string | undefined> = process.env): HelpDesksConfig {
  const key = String(env[HELP_DESKS_ENV.tokenKey] ?? '').trim()
  if (!key) return { keyring: null }
  try {
    return { keyring: parseSecretBoxKeyring(key) }
  } catch {
    return { keyring: null }
  }
}

/** The help desks the card offers: every one, once a credential can be stored; none before. */
export function availableProviders(config: HelpDesksConfig): HelpDeskProviderId[] {
  return config.keyring ? [...HELP_DESK_PROVIDER_IDS] : []
}

/** The secret parts of a credential, sealed together as one value. */
export interface SealedCredentialParts {
  token: string
  login: string | null
  appClientId: string | null
}

/** The context a connection's credential is sealed under: bound to its document. */
export const credentialSealContext = (connectionId: string) => `${HELP_DESK_CONNECTIONS_COLLECTION}/${connectionId}#credential`

export function sealCredential(parts: SealedCredentialParts, connectionId: string, keyring: SecretBoxKeyring): string {
  return sealSecret(JSON.stringify(parts), keyring.current, { context: credentialSealContext(connectionId) })
}

/** Opens a sealed credential; throws when the key is gone, the value was moved, or it is not one. */
export function openCredential(
  sealed: string,
  connectionId: string,
  keyring: SecretBoxKeyring,
): { parts: SealedCredentialParts; needsReseal: boolean } {
  const opened = openSecret(sealed, keyring, { context: credentialSealContext(connectionId) })
  const parsed = JSON.parse(opened.plaintext) as Partial<SealedCredentialParts>
  if (typeof parsed?.token !== 'string' || !parsed.token) throw new Error('not a help desk credential')
  return {
    parts: {
      token: parsed.token,
      login: typeof parsed.login === 'string' ? parsed.login : null,
      appClientId: typeof parsed.appClientId === 'string' ? parsed.appClientId : null,
    },
    needsReseal: needsReseal(opened, keyring),
  }
}
