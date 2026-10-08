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

/**
 * THE ONE MODULE THAT READS ACCOUNTING'S CREDENTIALS FROM THE ENVIRONMENT
 * (AGL-3614).
 *
 * - `INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET` — the Intuit developer app a
 *   QuickBooks Online company grants access to.
 * - `INTUIT_ENVIRONMENT` — `sandbox` or `production`: which QuickBooks API
 *   host the app's keys open. Sandbox when unset, because a development app's
 *   keys only open sandbox companies and posting a test sale into a real
 *   company's books is the mistake that cannot be taken back.
 * - `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` — the Xero app an organization
 *   grants access to. `XERO_SCOPES` optionally replaces the requested scopes,
 *   for an app made before Xero's granular scopes.
 * - `CODAT_API_KEY` — the Codat client's API key (AGL-3636), which reaches
 *   every other accounting system through Codat: QuickBooks Desktop,
 *   NetSuite, Sage, FreshBooks, Zoho Books, Wave. One key for the
 *   deployment; each workspace is one Codat company, and what is sealed is
 *   that company's id.
 * - `ACCOUNTING_TOKEN_KEY` — 32 random bytes, base64, sealing every stored
 *   token. A comma-separated list rotates: the first key seals, the rest only
 *   open, and a token opened under an older key is sealed again under the
 *   first.
 *
 * A provider is CONFIGURED only when its client and the token key are all
 * set; the console page shows a provider's Connect button only then, and the
 * whole page says nothing can be connected when neither is.
 *
 * ## Console-only, structurally
 *
 * The client secrets and the token key together are the power to write into
 * every connected business's books, so none may be reachable from the
 * tenant runtime, which serves the public internet. They are read here and
 * nowhere else, this module is imported only by the plugin's console server
 * half, and `accounting-credential-isolation.spec.ts` holds both facts.
 *
 * Read in the bracket form, so Next never inlines a value into a build.
 */

import { parseSecretBoxKeyring, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import type { AccountingProviderId } from '../model/accounting.types'
import type { QuickBooksEnvironment } from './providers/quickbooks'

export const ACCOUNTING_ENV = {
  intuitClientId: 'INTUIT_CLIENT_ID',
  intuitClientSecret: 'INTUIT_CLIENT_SECRET',
  intuitEnvironment: 'INTUIT_ENVIRONMENT',
  xeroClientId: 'XERO_CLIENT_ID',
  xeroClientSecret: 'XERO_CLIENT_SECRET',
  xeroScopes: 'XERO_SCOPES',
  codatApiKey: 'CODAT_API_KEY',
  tokenKey: 'ACCOUNTING_TOKEN_KEY',
} as const

export interface AccountingProviderCredentials {
  clientId: string
  clientSecret: string
  keyring: SecretBoxKeyring
  /** QuickBooks only. */
  environment: QuickBooksEnvironment
  /** Xero only. */
  scopes: string | null
  /** Codat only: the client's API key. */
  apiKey: string | null
}

export type AccountingProviderConfigResult =
  | { configured: true; config: AccountingProviderCredentials }
  | { configured: false; missing: string[] }

const trimmed = (value: string | undefined) => String(value ?? '').trim()

/** The token keyring, or `null` when it is unset or unusable. */
export function readAccountingKeyring(): SecretBoxKeyring | null {
  const value = trimmed(process.env['ACCOUNTING_TOKEN_KEY'])
  if (!value) return null
  try {
    return parseSecretBoxKeyring(value)
  } catch {
    return null
  }
}

/** The QuickBooks environment: production only when it says so. */
export function readQuickBooksEnvironment(): QuickBooksEnvironment {
  return trimmed(process.env['INTUIT_ENVIRONMENT']).toLowerCase() === 'production' ? 'production' : 'sandbox'
}

/** Reads one provider's variables and the token key. Never throws. */
export function readAccountingProviderConfig(provider: AccountingProviderId): AccountingProviderConfigResult {
  if (provider === 'codat') return readCodatConfig()
  const quickbooks = provider === 'quickbooks'
  const clientId = trimmed(quickbooks ? process.env['INTUIT_CLIENT_ID'] : process.env['XERO_CLIENT_ID'])
  const clientSecret = trimmed(quickbooks ? process.env['INTUIT_CLIENT_SECRET'] : process.env['XERO_CLIENT_SECRET'])
  const missing: string[] = []
  if (!clientId) missing.push(quickbooks ? ACCOUNTING_ENV.intuitClientId : ACCOUNTING_ENV.xeroClientId)
  if (!clientSecret) missing.push(quickbooks ? ACCOUNTING_ENV.intuitClientSecret : ACCOUNTING_ENV.xeroClientSecret)
  if (quickbooks) {
    const environment = trimmed(process.env['INTUIT_ENVIRONMENT']).toLowerCase()
    if (environment && environment !== 'sandbox' && environment !== 'production') {
      missing.push(ACCOUNTING_ENV.intuitEnvironment)
    }
  }
  const keyring = readAccountingKeyring()
  if (!keyring) missing.push(ACCOUNTING_ENV.tokenKey)
  if (missing.length || !keyring) return { configured: false, missing }
  return {
    configured: true,
    config: {
      clientId,
      clientSecret,
      keyring,
      environment: readQuickBooksEnvironment(),
      scopes: quickbooks ? null : trimmed(process.env['XERO_SCOPES']) || null,
      apiKey: null,
    },
  }
}

/** Codat: its API key and the token key. */
function readCodatConfig(): AccountingProviderConfigResult {
  const apiKey = trimmed(process.env['CODAT_API_KEY'])
  const keyring = readAccountingKeyring()
  const missing: string[] = []
  if (!apiKey) missing.push(ACCOUNTING_ENV.codatApiKey)
  if (!keyring) missing.push(ACCOUNTING_ENV.tokenKey)
  if (missing.length || !keyring) return { configured: false, missing }
  return {
    configured: true,
    config: { clientId: '', clientSecret: '', keyring, environment: 'production', scopes: null, apiKey },
  }
}

/** The sentence every route answers for a provider this deployment cannot connect. */
export function accountingNotConfiguredMessage(provider: AccountingProviderId | null): string {
  if (provider === 'quickbooks') return 'Connecting QuickBooks Online is not available on this deployment.'
  if (provider === 'xero') return 'Connecting Xero is not available on this deployment.'
  if (provider === 'codat') return 'Connecting other accounting software is not available on this deployment.'
  return 'Accounting connections are not available on this deployment.'
}
