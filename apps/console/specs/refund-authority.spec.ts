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
 * The refund ceiling predicate (AGL-2486).
 *
 * This is the one function the route refuses with AND the console disables
 * with, so it is worth pinning on its own rather than only through the two
 * surfaces: a disagreement between them would show up here first, and the
 * edge cases below (`0`, a role nobody has heard of, an exact boundary) are
 * awkward to reach through a rendered form.
 */
import {
  checkRefundAuthority,
  describeRefundAllowance,
  formatRefundCap,
  refundAuthorityForRole,
  refundCapCentsForRole,
  STAFF_REFUND_CAP_CENTS,
  STAFF_REFUND_DAILY_CAP_CENTS,
  STAFF_REFUND_WINDOW_MAX_ENTRIES,
} from '../constants/refund-authority'

describe('which roles carry a ceiling', () => {
  it('leaves only super uncapped', () => {
    expect(refundAuthorityForRole('super')).toBe('super')
    expect(refundCapCentsForRole('super')).toBeNull()
  })

  it.each(['support', 'billing'])('caps %s', (role) => {
    expect(refundAuthorityForRole(role)).toBe('capped')
    expect(refundCapCentsForRole(role)).toBe(STAFF_REFUND_CAP_CENTS)
  })

  /**
   * The fail-closed direction, which is the one a `switch` gets wrong. A
   * token minted by a future migration, or one with no claim at all, must
   * land on the capped side rather than falling through to uncapped.
   */
  it.each([undefined, null, '', 'admin', 'SUPER', 'super ', 42])(
    'treats %p as capped, never as super',
    (role) => {
      expect(refundAuthorityForRole(role)).toBe('capped')
    },
  )
})

describe('the per-refund cap', () => {
  const capped = (amountCents: number, windowCents = 0) =>
    checkRefundAuthority({ role: 'support', amountCents, windowCents })

  it('admits exactly the cap and refuses one cent more', () => {
    expect(capped(STAFF_REFUND_CAP_CENTS).allowed).toBe(true)
    expect(capped(STAFF_REFUND_CAP_CENTS + 1).allowed).toBe(false)
    expect(capped(STAFF_REFUND_CAP_CENTS + 1).code).toBe('over-per-refund')
  })

  it('names the escalation rather than only refusing', () => {
    const verdict = capped(STAFF_REFUND_CAP_CENTS + 1)
    expect(verdict.error).toContain('super staff role')
    // And warns off the obvious evasion, which the daily ceiling then
    // actually refuses.
    expect(verdict.error).toMatch(/splitting/)
  })

  /**
   * `strictNullChecks` is off repo-wide and this is money code, so `0` has to
   * be handled as a number rather than as an absence. It is a legal input
   * here — the ROUTE rejects a zero refund on its own, separately — and what
   * must never happen is `0` being read as "no amount given" and waved
   * through as if uncapped.
   */
  it('treats 0 as a real amount, not as an absence', () => {
    const verdict = capped(0)
    expect(verdict.allowed).toBe(true)
    expect(verdict.overCap).toBe(false)
  })

  it('refuses a non-number instead of comparing NaN', () => {
    // `NaN > cap` is false, so a naive comparison would have ADMITTED this.
    const verdict = checkRefundAuthority({
      role: 'support',
      amountCents: Number('not-a-number'),
    })
    expect(verdict.allowed).toBe(false)
  })

  it('does not cap super, but still reports whether the amount was over it', () => {
    const big = checkRefundAuthority({
      role: 'super',
      amountCents: STAFF_REFUND_CAP_CENTS * 10,
    })
    expect(big.allowed).toBe(true)
    // The audit row's whole point: a super refunding $1,500 is an escalation,
    // a super refunding $50 is a Tuesday, and `authority` cannot tell them
    // apart on its own.
    expect(big.overCap).toBe(true)
    expect(
      checkRefundAuthority({ role: 'super', amountCents: 5000 }).overCap,
    ).toBe(false)
  })
})

describe('the rolling 24-hour ceiling', () => {
  const withWindow = (amountCents: number, windowCents: number) =>
    checkRefundAuthority({ role: 'support', amountCents, windowCents })

  it('admits an amount that exactly exhausts the window', () => {
    expect(withWindow(10000, STAFF_REFUND_DAILY_CAP_CENTS - 10000).allowed).toBe(
      true,
    )
  })

  it('refuses one cent past it', () => {
    const verdict = withWindow(10001, STAFF_REFUND_DAILY_CAP_CENTS - 10000)
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('over-window')
  })

  /**
   * The reason this cap exists at all. Four refunds each legal under the
   * per-refund cap sum past the day's ceiling — the split that would
   * otherwise turn one escalation into four routine refunds.
   */
  it('stops a large refund being split into legal-sized ones', () => {
    let spent = 0
    const outcomes = [0, 1, 2, 3].map(() => {
      const verdict = withWindow(STAFF_REFUND_CAP_CENTS, spent)
      if (verdict.allowed) spent += STAFF_REFUND_CAP_CENTS
      return verdict.allowed
    })
    expect(outcomes).toEqual([true, true, true, false])
  })

  it('names what is left, not just that there was a limit', () => {
    // Under the PER-REFUND cap deliberately, so it is the window that
    // refuses — an over-cap amount would have been refused by the other
    // rule and this assertion would have read the wrong sentence.
    const verdict = withWindow(12000, 40000)
    expect(verdict.code).toBe('over-window')
    expect(verdict.error).toContain(formatRefundCap(10000))
  })

  it('refuses on COUNT once the entry ceiling is reached, whatever they sum to', () => {
    const verdict = checkRefundAuthority({
      role: 'support',
      amountCents: 1,
      windowCents: 1,
      windowCount: STAFF_REFUND_WINDOW_MAX_ENTRIES,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('too-many')
  })

  it('does not apply the window to super', () => {
    expect(
      checkRefundAuthority({
        role: 'super',
        amountCents: STAFF_REFUND_DAILY_CAP_CENTS * 5,
        windowCents: STAFF_REFUND_DAILY_CAP_CENTS,
      }).allowed,
    ).toBe(true)
  })
})

describe('the sentence the card shows before anything is typed', () => {
  it('states both ceilings and the remainder for a capped role', () => {
    const copy = describeRefundAllowance('support', 32000)
    expect(copy).toContain(formatRefundCap(STAFF_REFUND_CAP_CENTS))
    expect(copy).toContain(formatRefundCap(STAFF_REFUND_DAILY_CAP_CENTS))
    expect(copy).toContain(formatRefundCap(STAFF_REFUND_DAILY_CAP_CENTS - 32000))
  })

  it('never claims more is left than there is', () => {
    // An over-spent window (a cap lowered under an actor mid-day) must floor
    // at zero rather than reading as a negative allowance.
    expect(
      describeRefundAllowance('support', STAFF_REFUND_DAILY_CAP_CENTS * 2),
    ).toContain('$0.00 of that is left')
  })

  it('tells super it has none', () => {
    expect(describeRefundAllowance('super')).toContain('any amount')
  })
})
