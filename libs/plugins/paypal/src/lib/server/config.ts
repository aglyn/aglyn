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

import { paymentProvider } from '@aglyn/tenant-data-admin/server/payment-provider'
import { PAYPAL_API_BASES, PAYPAL_SDK_BASE } from '../constants'

/**
 * The deployment's PayPal partner integration (AGL-3630), read from the
 * environment. ⚑ PayPal is OFF — no surface shows, no request leaves — until
 * EVERY variable below is set, and they are to be set only after the
 * partner application is approved and PayPal's row is on the published
 * Subprocessors list.
 *
 * | Variable | What it is |
 * | -- | -- |
 * | `PAYPAL_ENVIRONMENT` | `sandbox` or `live`. Must match the card account's mode: a live deployment never offers sandbox PayPal, nor the reverse |
 * | `PAYPAL_CLIENT_ID` | The partner REST app's client id |
 * | `PAYPAL_CLIENT_SECRET` | The partner REST app's secret |
 * | `PAYPAL_PARTNER_MERCHANT_ID` | The partner account's own PayPal merchant (payer) id |
 * | `PAYPAL_PARTNER_ATTRIBUTION_ID` | The BN code PayPal assigned the partner; sent on every call and by the buttons |
 * | `PAYPAL_WEBHOOK_ID` | The id of the webhook registered on the partner app for `/api/paypal/webhook` on the console's host |
 *
 * Every name is read through {@link PAYPAL_ENV} rather than spelled at a
 * `process.env` read, so the self-hosting environment reference does not
 * list a feature that is not yet offered; add the six rows there in the same
 * change that un-hides PayPal.
 */
export const PAYPAL_ENV = {
  environment: 'PAYPAL_ENVIRONMENT',
  clientId: 'PAYPAL_CLIENT_ID',
  clientSecret: 'PAYPAL_CLIENT_SECRET',
  partnerMerchantId: 'PAYPAL_PARTNER_MERCHANT_ID',
  attributionId: 'PAYPAL_PARTNER_ATTRIBUTION_ID',
  webhookId: 'PAYPAL_WEBHOOK_ID',
} as const

export type PayPalEnvironment = 'sandbox' | 'live'

export interface PayPalConfig {
  environment: PayPalEnvironment
  clientId: string
  clientSecret: string
  partnerMerchantId: string
  attributionId: string
  webhookId: string
  /** REST host for this environment. */
  apiBase: string
  /** Where the buttons' script is served from. */
  sdkBase: string
}

export type PayPalConfigResult = { configured: true; config: PayPalConfig } | { configured: false; missing: string[] }


function env(name: string): string {
  return String(process.env[name] ?? '').trim()
}

export function readPayPalConfig(): PayPalConfigResult {
  const environment = env(PAYPAL_ENV.environment).toLowerCase()
  const values = {
    clientId: env(PAYPAL_ENV.clientId),
    clientSecret: env(PAYPAL_ENV.clientSecret),
    partnerMerchantId: env(PAYPAL_ENV.partnerMerchantId),
    attributionId: env(PAYPAL_ENV.attributionId),
    webhookId: env(PAYPAL_ENV.webhookId),
  }
  const missing: string[] = (Object.keys(values) as Array<keyof typeof values>)
    .filter((key) => !values[key])
    .map((key) => PAYPAL_ENV[key])
  if (environment !== 'sandbox' && environment !== 'live') missing.unshift(PAYPAL_ENV.environment)
  if (missing.length) return { configured: false, missing }
  const mode = environment as PayPalEnvironment
  return {
    configured: true,
    config: { environment: mode, ...values, apiBase: PAYPAL_API_BASES[mode], sdkBase: PAYPAL_SDK_BASE },
  }
}

let mismatchReported = false

/**
 * The config when PayPal may take money on this deployment, else `null`:
 * every variable set, AND the PayPal environment the same world as the card
 * account's. A live storefront taking sandbox PayPal would ship real goods
 * for play money; a test deployment taking live PayPal would charge real
 * buyers from a staging site. Either is refused, and said once in the log.
 */
export function payPalConfigForMoney(): PayPalConfig | null {
  const read = readPayPalConfig()
  if (!read.configured) return null
  const cardMode = paymentProvider().platformMode()
  if (cardMode && (cardMode === 'live') !== (read.config.environment === 'live')) {
    if (!mismatchReported) {
      mismatchReported = true
      console.error(
        `[paypal] PAYPAL_ENVIRONMENT is ${read.config.environment} but the card account is ${cardMode}; ` +
          'PayPal is not offered until they match.',
      )
    }
    return null
  }
  return read.config
}

/** Whether the deployment offers PayPal at all — what every surface asks before drawing. */
export function isPayPalConfigured(): boolean {
  return payPalConfigForMoney() !== null
}
