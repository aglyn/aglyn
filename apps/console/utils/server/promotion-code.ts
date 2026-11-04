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

// By its own module, not the server barrel: the checkout and subscription
// route specs stub `@aglyn/aglyn/server` with a partial object.
import type { OrgPlan } from '@aglyn/aglyn/foundation'
import { COUPON_PLAN_CHOICES } from '../coupon-list-query'
import {
  couponLimitedProducts,
  couponPlanRefusal,
  couponReachesPrice,
  plansForProducts,
  readPlanProducts,
} from './coupon-plan-products'

/*
 * ONE RESOLVER FOR A CUSTOMER-TYPED CODE (AGL-4160).
 *
 * Moved here from `/api/billing/checkout` so the plan switch on a live
 * subscription (`/api/billing/subscription`) resolves and refuses a code by
 * exactly the rules a new subscription does: active codes only, the
 * coupon's duration and amount reported, and a code limited to another
 * plan's base price refused with the plan it is for (AGL-4159). Two copies
 * would drift, and the first difference would be a code one door accepts
 * and the other refuses.
 */

/** What `resolvePromotionCode` answers. */
export type ResolvedPromotionCode = Awaited<ReturnType<typeof resolvePromotionCode>>

/**
 * Look up a customer-typed promotion code.
 *
 * Stripe's `discounts[0][promotion_code]` takes the code's ID, not the string
 * a customer types, so this is a lookup and not a pass-through. `active=true`
 * means an expired or exhausted code is reported as unknown rather than
 * silently ignored — a discount that vanishes between the preview and the
 * charge is the worst version of this feature.
 *
 * Returns `{}` for an empty input so the common path costs no API call.
 *
 * ## Why the coupon's DURATION comes back with it
 *
 * `duration: once` discounts the first invoice and nothing after it. A
 * customer who is shown "$0.80" and enrolled at $26.65 a month has been told
 * the truth about today and misled about the subscription, which is the same
 * defect as showing a discount that never reaches the charge — only harder to
 * notice, because the first invoice agrees with the screen.
 *
 * The duration is taken from THIS lookup rather than from a second call or
 * from an expanded invoice field: a promotion code carries its coupon inline,
 * so the fact is already in a response the resolve path always reads, and
 * reading it here cannot add a request to the purchase path.
 *
 * ## A code limited to a plan's base price (AGL-4159)
 *
 * A coupon minted for one plan's base price carries `applies_to.products`,
 * which Stripe answers only when expanded, so the lookup expands it. Given
 * the `sale` being priced, a limited code is held to it: the plan's price is
 * read for its product, and a code whose products do not include it is
 * REFUSED with the plans it is for ("This code is for the Starter plan.").
 * Stripe would otherwise accept it and discount nothing — the customer shown
 * the code as applied and charged the full price. The extra reads happen for
 * a limited code only; every other code costs the one lookup it always did.
 */
export async function resolvePromotionCode(
  secretKey: string,
  code: string,
  sale?: { plan: OrgPlan; priceId: string },
): Promise<{
  id?: string
  code?: string
  error?: string
  /**
   * Why a code that exists was refused, beside `error`: `plan` when it is
   * limited to other plans, `unavailable` when the plan's price could not be
   * read to tell. Absent for a code Stripe does not recognize.
   */
  refusal?: 'plan' | 'unavailable'
  /**
   * The products the code's coupon is limited to (AGL-4159), or null when it
   * reaches the whole subscription. A limited code that resolved reaches the
   * base price being sold, and only the lines of its products.
   */
  limitedToProducts?: string[] | null
  /** Stripe's `coupon.duration` — `once`, `repeating` or `forever`. */
  duration?: string | null
  /** Stripe's `coupon.duration_in_months`, set only for `repeating`. */
  durationInMonths?: number | null
  /** Stripe's `coupon.percent_off`, when the code takes a percentage off. */
  percentOff?: number | null
  /** Stripe's `coupon.amount_off` in dollars, when it takes an amount off each charge. */
  amountOffUsd?: number | null
}> {
  const wanted = String(code ?? '').trim()
  if (!wanted) return {}
  const response = await fetch(
    `https://api.stripe.com/v1/promotion_codes?code=${encodeURIComponent(
      wanted,
    )}&active=true&limit=1&expand[]=data.coupon.applies_to`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  )
  const payload = await response.json()
  const found = Array.isArray(payload?.data) ? payload.data[0] : null
  if (!response.ok || !found?.id) {
    return { error: `We do not recognize the code “${wanted.slice(0, 40)}”.` }
  }
  const limitedToProducts = couponLimitedProducts(found?.coupon)
  if (limitedToProducts && sale) {
    const reaches = await couponReachesPrice(secretKey, limitedToProducts, sale.priceId)
    if (reaches === 'unknown') {
      return {
        error: 'We could not check that code against this plan just now.',
        refusal: 'unavailable',
      }
    }
    if (reaches === 'no') {
      // Named by the plans it IS for, read from the same price env.
      const { products } = await readPlanProducts(secretKey, COUPON_PLAN_CHOICES)
      return {
        error: couponPlanRefusal(
          plansForProducts(limitedToProducts, products, COUPON_PLAN_CHOICES),
          sale.plan,
        ),
        refusal: 'plan',
      }
    }
  }
  return {
    limitedToProducts,
    id: String(found.id),
    code: String(found.code ?? wanted),
    // Reported, never defaulted. An absent duration answers "we do not know
    // whether this discount persists", and the confirm says exactly that —
    // guessing `forever` would promise a price nobody verified, and guessing
    // `once` would frighten a customer off a discount they actually keep.
    duration:
      typeof found?.coupon?.duration === 'string' ? found.coupon.duration : null,
    durationInMonths:
      typeof found?.coupon?.duration_in_months === 'number'
        ? found.coupon.duration_in_months
        : null,
    percentOff:
      typeof found?.coupon?.percent_off === 'number' ? found.coupon.percent_off : null,
    amountOffUsd:
      typeof found?.coupon?.amount_off === 'number' ? found.coupon.amount_off / 100 : null,
  }
}
