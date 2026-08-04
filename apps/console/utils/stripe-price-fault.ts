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
 * Turn Stripe's `resource_missing` into the env var that caused it (AGL-1137).
 *
 * Returns null for every other Stripe error, so a genuine outage still reads
 * as one — the point is to separate "we are misconfigured" from "Stripe is
 * unhappy", not to relabel everything as configuration.
 */
export function configuredPriceFault(
  error: { code?: string; param?: string; message?: string } | undefined,
  plan: string,
  interval: 'month' | 'year',
): string | null {
  if (!error || error.code !== 'resource_missing') return null
  const param = String(error.param ?? '')
  if (!param.includes('price')) return null
  // line_items[1] is the shared metered price; [0] is the plan itself.
  const envVar = param.includes('[1]')
    ? 'STRIPE_PRICE_METERED'
    : `STRIPE_PRICE_${plan.toUpperCase()}${interval === 'year' ? '_YEARLY' : ''}`
  return (
    `Billing is misconfigured: ${envVar} points at a price that does not ` +
    `exist in this Stripe account/mode. This is the shape you get when the ` +
    `secret key is switched between test and live and the price ids are not. ` +
    `Stripe said: ${error.message ?? 'no such price'}`
  )
}
