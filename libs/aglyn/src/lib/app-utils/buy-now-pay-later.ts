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
 * NO CHECKOUT ON A SITE OFFERS BUY-NOW-PAY-LATER (AGL-4198).
 *
 * Every charge a site takes is a destination charge on the platform's Stripe
 * account, so Stripe offers the methods the platform's payment method
 * configuration turns on, and that configuration has `klarna` and `affirm` on
 * beside the card family. Those cost Stripe about 6% + 30¢ (Affirm's enhanced
 * plans 7.99%), against 2.9% + 30¢ for a card, and the processing half of
 * every application fee is sized before the buyer chooses. So each Checkout
 * Session a site opens excludes them by name, and the fee is priced at the
 * card rate (`SALE_PROCESSING_PERCENT`).
 *
 * Exclusion, not `payment_method_types`: the sessions keep dynamic payment
 * methods, so a seller's own switches (AGL-3629) and Stripe's per-order
 * filtering still apply, and `excluded_payment_method_types` is accepted at
 * the account default API version and at the in-page checkout's pinned one.
 * What stays possible is the card family (a card, Apple Pay, Google Pay, Link,
 * Cash App Pay, Amazon Pay, all 2.9% + 30¢ on Stripe's US pricing) and
 * stablecoins (1.5%) where a seller turns them on.
 */
export const BUY_NOW_PAY_LATER_PAYMENT_METHOD_TYPES = [
  'klarna',
  'afterpay_clearpay',
  'affirm',
] as const

export type BuyNowPayLaterPaymentMethodType =
  (typeof BUY_NOW_PAY_LATER_PAYMENT_METHOD_TYPES)[number]

const EXCLUDED_KEY = /^excluded_payment_method_types\[(\d+)\]$/

/**
 * Exclude every buy-now-pay-later method on a Checkout Session's params,
 * after whatever the params already exclude, without naming one twice. A
 * session that pins `payment_method_types` already offers nothing else, and
 * Stripe refuses both on one session, so it is left alone.
 */
export function excludeBuyNowPayLater<T extends URLSearchParams | Record<string, unknown>>(
  params: T,
): T {
  const entries: Array<[string, unknown]> =
    params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params)
  if (entries.some(([key]) => key.startsWith('payment_method_types'))) return params
  const already = new Set<string>()
  let next = 0
  for (const [key, value] of entries) {
    const match = EXCLUDED_KEY.exec(key)
    if (!match) continue
    already.add(String(value))
    next = Math.max(next, Number(match[1]) + 1)
  }
  for (const type of BUY_NOW_PAY_LATER_PAYMENT_METHOD_TYPES) {
    if (already.has(type)) continue
    const key = `excluded_payment_method_types[${next++}]`
    if (params instanceof URLSearchParams) params.set(key, type)
    else (params as Record<string, unknown>)[key] = type
  }
  return params
}
