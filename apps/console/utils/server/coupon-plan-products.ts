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

// By its own module, not the server barrel: the coupon, checkout and
// org-discount route specs all stub `@aglyn/aglyn/server` with a partial
// object, and a label read off it there would be undefined.
import { PLAN_LABELS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { OrgPlan } from '@aglyn/aglyn/foundation'
import { couponPlanList } from '../coupon-list-query'

/*
 * A COUPON LIMITED TO A PLAN'S BASE PRICE (AGL-4159).
 *
 * Stripe limits a coupon to products, not to prices or plans:
 * `applies_to[products][]`. A plan's base price is a Stripe price, and the
 * product it belongs to is the product such a coupon names. That product is
 * read from the deployment's OWN price env, `STRIPE_PRICE_<PLAN>` and
 * `STRIPE_PRICE_<PLAN>_YEARLY` → `GET /v1/prices/{id}` → `product`, so no
 * product id is written into the code or the docs, and a self-hosted install
 * resolves its own. Monthly and yearly normally share one product
 * (`tools/scripts/setup-stripe.mjs` creates the yearly price on the monthly
 * one's product); both are read and the products kept, so a deployment whose
 * two prices sit on different products is still covered on both intervals.
 *
 * Everything else on a subscription is a different product: each add-on, Site
 * Care, Aglyn AI credits and the metered usage item. So a coupon limited to a
 * plan's product takes its discount off that plan's base line and nothing
 * else, and moving to another plan (a different product) is not discounted.
 */

/** The env names that hold a plan's base price ids, monthly then yearly. */
export function planPriceEnvNames(plan: OrgPlan): [string, string] {
  const name = `STRIPE_PRICE_${plan.toUpperCase()}`
  return [name, `${name}_YEARLY`]
}

/**
 * The plan's configured base price ids, read at call time, monthly first.
 * Empty when neither env is set.
 */
export function configuredPlanPriceIds(plan: OrgPlan): string[] {
  return planPriceEnvNames(plan)
    .map((name) => process.env[name])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim())
}

/** Why a plan's product could not be read, for the refusal that names it. */
export interface PlanProductFault {
  plan: OrgPlan
  /** 501 when no price env is set; 502 when Stripe could not answer for one. */
  status: 501 | 502
  error: string
}

export interface PlanProducts {
  /** Each plan whose product was read, with its product ids (usually one). */
  products: Partial<Record<OrgPlan, string[]>>
  faults: PlanProductFault[]
}

/** The refusal for a plan with no price env: what to set, in words. */
function unconfigured(plan: OrgPlan): PlanProductFault {
  const [monthly, yearly] = planPriceEnvNames(plan)
  return {
    plan,
    status: 501,
    error:
      `${PLAN_LABELS[plan] ?? plan} has no price configured: set ${monthly} ` +
      `or ${yearly} to the plan's Stripe price. A coupon limited to a plan ` +
      "takes its discount off that price's product.",
  }
}

/**
 * The plan's price, read from Stripe for its product. The id comes from the
 * deployment's env, but it is still interpolated into a path, so it is
 * encoded rather than trusted.
 */
async function priceProduct(
  secretKey: string,
  priceId: string,
): Promise<{ ok: true; product: string } | { ok: false; error: string }> {
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )
    const body = await response.json().catch(() => ({}))
    const product =
      typeof body?.product === 'string' ? body.product : body?.product?.id
    if (!response.ok || typeof product !== 'string' || !product) {
      return { ok: false, error: body?.error?.message ?? 'price lookup failed' }
    }
    return { ok: true, product }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'price lookup failed' }
  }
}

/**
 * Every listed plan's base-price product(s), read from the deployment's
 * price env. A plan that cannot be read is a FAULT, not an error: the caller
 * decides whether that refuses (minting a coupon for that plan) or only
 * leaves the plan unnamed (labelling the list).
 */
export async function readPlanProducts(
  secretKey: string,
  plans: readonly OrgPlan[],
): Promise<PlanProducts> {
  const products: Partial<Record<OrgPlan, string[]>> = {}
  const faults: PlanProductFault[] = []
  await Promise.all(
    plans.map(async (plan) => {
      const priceIds = configuredPlanPriceIds(plan)
      if (!priceIds.length) {
        faults.push(unconfigured(plan))
        return
      }
      const read = await Promise.all(priceIds.map((id) => priceProduct(secretKey, id)))
      const failures = read.flatMap((one) => ('error' in one ? [one.error] : []))
      if (failures.length) {
        faults.push({
          plan,
          status: 502,
          error:
            `Stripe could not read the ${PLAN_LABELS[plan] ?? plan} price ` +
            `(${failures[0]}). Check ${planPriceEnvNames(plan).join(' and ')}.`,
        })
        return
      }
      products[plan] = [
        ...new Set(read.flatMap((one) => ('product' in one ? [one.product] : []))),
      ]
    }),
  )
  // Ladder order, whatever order the reads finished in.
  faults.sort((a, b) => plans.indexOf(a.plan) - plans.indexOf(b.plan))
  return { products, faults }
}

/**
 * The products a Stripe coupon is limited to, or null for one that reaches
 * the whole subscription. Stripe answers `applies_to` only when it is
 * expanded, so a caller reading a coupon expands it first.
 */
export function couponLimitedProducts(coupon: any): string[] | null {
  const products = coupon?.applies_to?.products
  if (!Array.isArray(products)) return null
  const ids = products.filter(
    (product: unknown): product is string => typeof product === 'string' && product !== '',
  )
  return ids.length ? ids : null
}

/** The plans, of those read, whose base-price product a coupon names. */
export function plansForProducts(
  products: readonly string[],
  planProducts: PlanProducts['products'],
  order: readonly OrgPlan[],
): OrgPlan[] {
  return order.filter((plan) =>
    (planProducts[plan] ?? []).some((product) => products.includes(product)),
  )
}

/**
 * The sentence a code limited to other plans is refused with at checkout:
 * "This code is for the Starter plan." When the plans it IS for cannot be
 * named, it says which plan it is not for.
 */
export function couponPlanRefusal(plans: readonly OrgPlan[], pricedPlan: OrgPlan): string {
  if (!plans.length) {
    return `This code does not apply to the ${PLAN_LABELS[pricedPlan] ?? pricedPlan} plan.`
  }
  return `This code is for the ${couponPlanList(plans)} plan${plans.length > 1 ? 's' : ''}.`
}

/**
 * Whether a coupon limited to `products` reaches the base price being sold,
 * `priceId`. Read off the price itself, so the answer is Stripe's — the same
 * product match Stripe makes when it applies the discount. `unknown` when the
 * price cannot be read: the caller refuses rather than guess.
 */
export async function couponReachesPrice(
  secretKey: string,
  products: readonly string[],
  priceId: string,
): Promise<'yes' | 'no' | 'unknown'> {
  const read = await priceProduct(secretKey, priceId)
  if (!read.ok) return 'unknown'
  return products.includes(read.product) ? 'yes' : 'no'
}
