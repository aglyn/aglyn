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

// By leaf, not the library's index: the index reaches the sender and the
// health check, which this program has no use for and types more loosely.
import {
  deliverableMonthlyCeiling,
  EMAIL_ORG_HOURLY_SHARE,
} from '@aglyn/shared-util-email/send-ceilings'
import { EMAIL_SEND_RATE_DEFAULT_PER_HOUR } from '@aglyn/shared-util-email/send-rate'
import { PLAN_ENTITLEMENTS, SELF_SERVE_PLANS } from './plan-entitlements'

/** The shipped platform default, so the model is checked at its real values. */
const PLATFORM = EMAIL_SEND_RATE_DEFAULT_PER_HOUR

/*==========================================
 * R3 OVER THE REAL TABLE.
 *
 * ⚠️ EVERY R3 CASE IN `send-ceilings.spec.ts` IS HYPOTHETICAL — each passes
 * `planMonthlyLimit` in by hand, so the model can be proven correct while the
 * SHIPPED plans oversell
 * and nothing says so. That is exactly what happened: Agency sold 1,000,000 a
 * month against a 360,000 ceiling for as long as this file has existed, and
 * every test here was green.
 *
 * So this reads `PLAN_ENTITLEMENTS` itself. It is the only case that can fail
 * because of a number somebody edited in the price table, and it lives beside
 * that table: the core may import the email library's ceiling model, and the
 * email library may not import the core.
 *=========================================*/
describe('R3 holds for the plans we actually sell', () => {
  const deliverable = deliverableMonthlyCeiling(PLATFORM, EMAIL_ORG_HOURLY_SHARE)

  for (const plan of SELF_SERVE_PLANS) {
    it(`${plan} sells no more than the platform can deliver`, () => {
      const sold = PLAN_ENTITLEMENTS[plan].emailSendsPerMonth
      // An unlimited plan is bounded by contract, not by this table.
      if (sold === Number.POSITIVE_INFINITY) return
      expect(sold).toBeLessThanOrEqual(deliverable)
    })
  }

  /**
   * ANTI-VACUITY. Without this, a table whose every plan read `0` would pass
   * the loop above, and so would a `SELF_SERVE_PLANS` that had quietly become
   * empty.
   */
  it('CONTROL — the plans are real and the ceiling is not infinite', () => {
    expect(SELF_SERVE_PLANS.length).toBeGreaterThan(3)
    expect(Number.isFinite(deliverable)).toBe(true)
    expect(
      SELF_SERVE_PLANS.filter(
        (plan) => PLAN_ENTITLEMENTS[plan].emailSendsPerMonth > 0,
      ).length,
    ).toBeGreaterThan(3)
  })
})
