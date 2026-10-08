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

import type { PluginPaymentCheckoutRequest } from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import type { MemoryFirestore } from './memory-firestore'

/** A sandbox partner integration, every variable set. */
export const PAYPAL_TEST_ENV: Record<string, string> = {
  PAYPAL_ENVIRONMENT: 'sandbox',
  PAYPAL_CLIENT_ID: 'AYSq3RDGsmBLJE-otTkBtM-jBRd1TCQwFf9RGfwddNXWz0uFU9ztymylOhRS',
  PAYPAL_CLIENT_SECRET: 'EGnHDxD_qRPdaLdZz8iCr8N7_MzF-YHPTkjs6NKYQvQSBngp4PTTVWkPZRbL',
  PAYPAL_PARTNER_MERCHANT_ID: 'PARTNER9QKJ3Z',
  PAYPAL_PARTNER_ATTRIBUTION_ID: 'Aglyn_SP_PPCP',
  PAYPAL_WEBHOOK_ID: '8PT597110X687430LKGECATA',
}

export const TEST_ORG = 'org-candles'
export const TEST_HOST = 'host-candles'
export const TEST_SELLER = 'SELLER7RXQG3L'

export function setPayPalTestEnv(): void {
  for (const [name, value] of Object.entries(PAYPAL_TEST_ENV)) process.env[name] = value
}

export function clearPayPalTestEnv(): void {
  for (const name of Object.keys(PAYPAL_TEST_ENV)) delete process.env[name]
}

export async function seedReadySeller(db: MemoryFirestore, overrides: Record<string, unknown> = {}): Promise<void> {
  await db.collection('paypalSellers').doc(TEST_ORG).set({
    orgId: TEST_ORG,
    environment: 'sandbox',
    trackingId: 'aglyn-org-candles-0a1b2c3d4e5f',
    merchantId: TEST_SELLER,
    status: 'ready',
    paymentsReceivable: true,
    primaryEmailConfirmed: true,
    permissionsGranted: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  })
}

/** A cart of two candles and a gift note, shipped, with tax, a discount and the platform's fee. */
export function testCheckoutRequest(overrides: Partial<PluginPaymentCheckoutRequest> = {}): PluginPaymentCheckoutRequest {
  return {
    ownerKind: 'shop-cart',
    checkoutId: 'pay_paypal_0123456789abcdef0123456789abcdef',
    orgId: TEST_ORG,
    hostId: TEST_HOST,
    currency: 'usd',
    channel: 'online',
    lines: [
      { name: 'Fig candle', quantity: 2, unitCents: 2_400, sku: 'FIG-8OZ', ships: true },
      { name: 'Gift note', quantity: 1, unitCents: 300, ships: false },
    ],
    discountCents: 510,
    taxCents: 412,
    shipping: {
      options: [
        { id: 'ground', label: 'Ground', amountCents: 695 },
        { id: 'express', label: 'Express', amountCents: 1_995 },
      ],
      countries: ['US', 'CA'],
    },
    platformFeeCents: 102,
    merchantName: 'Candle & Co',
    buyerEmail: 'ada@example.com',
    returnUrl: 'https://candles.example/shop?order=success&session_id=pay_paypal_0123456789abcdef0123456789abcdef',
    cancelUrl: 'https://candles.example/shop?order=canceled',
    metadata: { type: 'commerce-cart', hostId: TEST_HOST, cartId: 'cart-1', feeCents: '102' },
    expiresAtMs: Date.now() + 31 * 60 * 1000,
    ...overrides,
  }
}
