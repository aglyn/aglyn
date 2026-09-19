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

/**
 * THE ONE MODULE THAT READS OUTREACH'S CREDENTIALS FROM THE ENVIRONMENT
 * (AGL-2978).
 *
 * - `GOOGLE_OUTREACH_CLIENT_ID` and `GOOGLE_OUTREACH_CLIENT_SECRET` — the
 *   OAuth client a rep's Google account grants mailbox access to.
 * - `OUTREACH_TOKEN_KEY` — 32 random bytes, base64, sealing every stored
 *   refresh token. A comma-separated list rotates: the first key seals, the
 *   rest only open, and a token opened under an older key is sealed again
 *   under the first.
 *
 * ## Console-only, structurally
 *
 * The client secret and the token key together are the power to send as
 * every connected rep, so neither may be reachable from the tenant runtime,
 * which serves the public internet. They are read here and nowhere else; this
 * module is imported only by Outreach's server half and its console-only
 * declarations; and those are loaded only by the console's server manifests.
 * `outreach-credential-isolation.spec.ts`, beside this plugin's other specs,
 * holds all three facts, the way `sending-domain-credential-isolation.spec.ts`
 * holds the Resend domains key's.
 *
 * Read in the bracket form, so Next never inlines a value into a build.
 */

/** The env vars, named once for the refusal that lists what is missing. */
export const OUTREACH_ENV = {
  clientId: 'GOOGLE_OUTREACH_CLIENT_ID',
  clientSecret: 'GOOGLE_OUTREACH_CLIENT_SECRET',
  tokenKey: 'OUTREACH_TOKEN_KEY',
} as const

export interface OutreachGoogleConfig {
  clientId: string
  clientSecret: string
  keyring: SecretBoxKeyring
}

export type OutreachGoogleConfigResult =
  | { configured: true; config: OutreachGoogleConfig }
  | {
      configured: false
      /** The env var names that are unset or unusable — never their values. */
      missing: string[]
    }

/** The sentence every route and the panel use for an unconfigured deployment. */
export const OUTREACH_NOT_CONFIGURED_MESSAGE =
  'Connecting a Google mailbox is not configured on this deployment.'

/** Reads the three variables. Never throws; an unusable key counts as missing. */
export function readOutreachGoogleConfig(): OutreachGoogleConfigResult {
  const clientId = String(process.env['GOOGLE_OUTREACH_CLIENT_ID'] ?? '').trim()
  const clientSecret = String(process.env['GOOGLE_OUTREACH_CLIENT_SECRET'] ?? '').trim()
  const tokenKey = String(process.env['OUTREACH_TOKEN_KEY'] ?? '').trim()

  const missing: string[] = []
  if (!clientId) missing.push(OUTREACH_ENV.clientId)
  if (!clientSecret) missing.push(OUTREACH_ENV.clientSecret)
  let keyring: SecretBoxKeyring | null = null
  if (tokenKey) {
    try {
      keyring = parseSecretBoxKeyring(tokenKey)
    } catch {
      keyring = null
    }
  }
  if (!keyring) missing.push(OUTREACH_ENV.tokenKey)

  if (missing.length || !keyring) return { configured: false, missing }
  return { configured: true, config: { clientId, clientSecret, keyring } }
}
