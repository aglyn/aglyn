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
 * AGL-2295. There is ONE source for a storefront's platform fee, and this file
 * is what keeps it that way.
 *
 * `commerce.ts` exported `COMMERCE_PLATFORM_FEE_PERCENT = 2` with **zero call
 * sites**. It asserted a flat 2% that agrees with the plan table for exactly
 * one cell — Starter, physical — and disagrees with the other fifteen. Nothing
 * was wrong while nothing read it; the cost was that a constant sitting in the
 * model beside the types reads like the answer, so the next reader to wire it
 * up would silently re-price every plan.
 *
 * The real source is `resolveTransactionFeePct(org, productType)`, resolved per
 * request because it depends on the plan, on per-org staff overrides, and on
 * whether the org's subscription is still alive. A constant cannot express any
 * of that — which is the argument for deleting it rather than correcting it.
 *
 * ## Why a source guard
 *
 * A deleted export cannot be asserted by importing it: the import would not
 * compile. What can be asserted is that no such constant comes BACK, and that
 * the doc comments describing the fee do not drift into stating a number
 * again. Both fail on purpose if someone re-adds one.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { PLAN_ENTITLEMENTS, resolveTransactionFeePct } from '@aglyn/aglyn'

const MODEL = join(__dirname, 'commerce.ts')
const CHECKOUT = join(__dirname, '..', 'server', 'checkout.ts')

describe('the storefront fee has one source (AGL-2295)', () => {
  it('no fee constant lives in the commerce model', () => {
    const source = readFileSync(MODEL, 'utf8')
    // The exact name that was there, and the shape of any replacement.
    expect(source).not.toMatch(/export const COMMERCE_PLATFORM_FEE_PERCENT/)
    expect(source).not.toMatch(/export const \w*(PLATFORM_FEE|FEE_PERCENT)\w*/)
  })

  it('the checkout docblock no longer states a rate or the wrong gate', () => {
    const source = readFileSync(CHECKOUT, 'utf8')
    // It said "with a 2% platform fee" and "gated on the owner's
    // `marketplaceSelling` plan flag". The second is the dangerous one:
    // `marketplaceSelling` gates the MARKETPLACE, and a reader who trusted it
    // would gate a storefront on the wrong entitlement.
    expect(source).not.toContain('2% platform fee')
    expect(source).not.toContain("gated on the owner's `marketplaceSelling`")
  })

  /**
   * POSITIVE CONTROL for the guard: these are the files it thinks they are.
   * Without this, a wrong path would make every `not.toMatch` above pass on an
   * empty read — a check that cannot fail.
   */
  it('POSITIVE CONTROL: it is reading the files it names', () => {
    expect(readFileSync(MODEL, 'utf8')).toContain(
      'export const COMMERCE_MAX_PRICE_USD',
    )
    expect(readFileSync(CHECKOUT, 'utf8')).toContain(
      'export const checkoutHandler',
    )
  })
})

/**
 * And the reason a constant could never have been right: the rate the deleted
 * one asserted is correct for one plan-and-type pair and wrong for the rest.
 * Measured against the live table rather than restated, so a pricing change
 * moves this with it.
 */
describe('why 2% was never the answer', () => {
  const org = (plan: string) => ({ plan }) as never

  it('disagrees with the table almost everywhere', () => {
    const flat = 2
    const pairs: Array<['physical' | 'digital', string]> = [
      ['physical', 'starter'],
      ['digital', 'starter'],
      ['physical', 'pro'],
      ['digital', 'pro'],
      ['physical', 'business'],
      ['digital', 'business'],
      ['digital', 'scale'],
      ['digital', 'advanced'],
    ]
    const agreeing = pairs.filter(
      ([type, plan]) => resolveTransactionFeePct(org(plan), type) === flat,
    )
    // Starter physical and Business digital are the only 2% cells among these.
    expect(agreeing.map(([type, plan]) => `${plan}:${type}`)).toEqual([
      'starter:physical',
      'business:digital',
    ])
  })

  it('is resolved from the ORG, which no constant can be', () => {
    // A dead subscription collapses to the free plan's entitlements, so the
    // same product on the same site prices differently depending on whether
    // the merchant is still paying — the fact that makes this a function.
    const live = resolveTransactionFeePct(
      { plan: 'starter', billingStatus: 'active' } as never,
      'digital',
    )
    const dead = resolveTransactionFeePct(
      { plan: 'starter', billingStatus: 'canceled' } as never,
      'digital',
    )
    expect(live).toBe(PLAN_ENTITLEMENTS.starter.transactionFeeDigitalPct)
    expect(dead).not.toBe(live)
  })
})
