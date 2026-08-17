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
 * AGL-1796: turning AGL-1787's `dispute` record back into something a merchant
 * can read.
 *
 * The records here are not invented — they are the two shapes
 * `billing-webhook.ts` actually writes. `charge.dispute.created` writes
 * `{id, status, reason?, amountCents, openedAtMs, evidenceDueByMs?}` and
 * nothing else; `charge.dispute.closed` overwrites `status` with the outcome
 * and adds `outcome`, `closedAtMs` and `reversedCents` — the last one present
 * and ZERO on a dispute that was won, which is why every "did money move" test
 * here asks `> 0` rather than asking whether the field exists.
 *
 * Figures are chosen so no two coincide (AGL-1711): order total 6200, disputed
 * 6200, reversed 4500, already refunded 1700, a second store's order 3300.
 */

import {
  describeOrderDispute,
  isOrderDisputeOpen,
  orderDisputeBlocksRefund,
  orderHasOpenDispute,
  splitOrderReversal,
  summariseOpenDisputes,
} from './commerce-dispute'
import type { HostOrder, OrderDispute } from './commerce-orders'

const OPENED_AT = Date.UTC(2026, 9, 2, 14, 30)
const DUE_BY = Date.UTC(2026, 9, 16, 23, 59)
const CLOSED_AT = Date.UTC(2026, 9, 20, 9, 15)
/** Five days before the deadline. */
const NOW = Date.UTC(2026, 9, 11, 23, 59)

/** Exactly what `charge.dispute.created` stores. */
const opened: OrderDispute = {
  id: 'dp_1TESTopened',
  status: 'needs_response',
  reason: 'product_not_received',
  amountCents: 6200,
  openedAtMs: OPENED_AT,
  evidenceDueByMs: DUE_BY,
}

/** Exactly what `charge.dispute.closed` stores for a loss. */
const lost: OrderDispute = {
  ...opened,
  status: 'lost',
  outcome: 'lost',
  closedAtMs: CLOSED_AT,
  reversedCents: 6200,
}

/** The same record with one optional field absent, as Stripe may send it. */
const without = (
  dispute: OrderDispute,
  key: keyof OrderDispute,
): OrderDispute => {
  const copy = { ...dispute }
  delete copy[key]
  return copy
}

const won: OrderDispute = {
  ...opened,
  status: 'won',
  outcome: 'won',
  closedAtMs: CLOSED_AT,
  reversedCents: 0,
}

describe('isOrderDisputeOpen (AGL-1796)', () => {
  it('is open on the record `charge.dispute.created` writes', () => {
    expect(isOrderDisputeOpen(opened)).toBe(true)
  })

  it('is not open once an outcome is recorded', () => {
    expect(isOrderDisputeOpen(lost)).toBe(false)
    expect(isOrderDisputeOpen(won)).toBe(false)
  })

  it('treats a still-running inquiry as open', () => {
    // `warning_needs_response` and `warning_under_review` are OPEN — only
    // `warning_closed` ends. A "starts with warning" test would have closed
    // all three and hidden the deadline on the two that still have one.
    for (const status of ['warning_needs_response', 'warning_under_review']) {
      expect(`${status}: ${isOrderDisputeOpen({ ...opened, status })}`).toBe(
        `${status}: true`,
      )
    }
    expect(isOrderDisputeOpen({ ...opened, status: 'warning_closed' })).toBe(
      false,
    )
  })

  it('resolves a self-contradicting record to settled', () => {
    // Each signal alone must be enough to close it: saying "evidence due"
    // about a dispute that is over sends a merchant to gather documents for a
    // case nobody can answer.
    expect(isOrderDisputeOpen({ ...opened, status: 'lost' })).toBe(false)
    expect(isOrderDisputeOpen({ ...opened, closedAtMs: CLOSED_AT })).toBe(false)
    expect(isOrderDisputeOpen({ ...opened, outcome: 'lost' })).toBe(false)
  })

  it('is not open when there is no dispute at all', () => {
    expect(isOrderDisputeOpen(undefined)).toBe(false)
    expect(orderHasOpenDispute({})).toBe(false)
    expect(orderHasOpenDispute({ dispute: opened })).toBe(true)
    expect(orderHasOpenDispute({ dispute: lost })).toBe(false)
  })
})

describe('orderDisputeBlocksRefund (AGL-1809)', () => {
  it('blocks a refund while a chargeback is formally open', () => {
    // The bank has the funds and Stripe's refund API would answer
    // `charge_disputed`; a refund that went through would pay twice.
    expect(orderDisputeBlocksRefund({ dispute: opened })).toBe(true)
    expect(
      orderDisputeBlocksRefund({
        dispute: { ...opened, status: 'under_review' },
      }),
    ).toBe(true)
  })

  it('does not block a refund during an open inquiry', () => {
    // The OPPOSITE of a formal dispute: no funds have moved, and Stripe's own
    // docs name "issuing a full refund" as the way to resolve an inquiry
    // before it escalates. Blocking these would forbid the recommended exit.
    for (const status of ['warning_needs_response', 'warning_under_review']) {
      expect(
        `${status}: ${orderDisputeBlocksRefund({
          dispute: { ...opened, status },
        })}`,
      ).toBe(`${status}: false`)
    }
  })

  it('does not block once the dispute has settled', () => {
    // A won or closed dispute leaves the charge refundable again; a LOST one
    // is the status guard's business (the order is already `refunded`), not
    // this predicate's.
    expect(orderDisputeBlocksRefund({ dispute: won })).toBe(false)
    expect(orderDisputeBlocksRefund({ dispute: lost })).toBe(false)
    expect(
      orderDisputeBlocksRefund({
        dispute: {
          ...opened,
          status: 'warning_closed',
          outcome: 'warning_closed',
          closedAtMs: CLOSED_AT,
          reversedCents: 0,
        },
      }),
    ).toBe(false)
  })

  it('does not block an order with no dispute at all', () => {
    expect(orderDisputeBlocksRefund({})).toBe(false)
    expect(orderDisputeBlocksRefund({ dispute: undefined })).toBe(false)
  })

  it('fails closed on an open dispute in an unrecognised status', () => {
    // A status this code has never seen, still open by every signal. On the
    // question of sending money twice, unknown blocks — and a "starts with
    // warning" shortcut would have waved through a future `warning_*` state
    // that is not one of the two known-refundable inquiry phases.
    expect(
      orderDisputeBlocksRefund({
        dispute: { ...opened, status: 'prearbitration' },
      }),
    ).toBe(true)
    expect(
      orderDisputeBlocksRefund({
        dispute: { ...opened, status: 'warning_escalating' },
      }),
    ).toBe(true)
  })
})

describe('describeOrderDispute (AGL-1796)', () => {
  it('is null for an order with no dispute', () => {
    expect(describeOrderDispute({}, NOW)).toBeNull()
    // An order that was refunded the ordinary way carries no dispute record,
    // and must not acquire a badge from having reversed money.
    const refunded: Partial<HostOrder> = { refundedCents: 6200 }
    expect(describeOrderDispute(refunded, NOW)).toBeNull()
    expect(splitOrderReversal(refunded).chargedBackCents).toBe(0)
  })

  it('names the deadline and the days left while the case is open', () => {
    const badge = describeOrderDispute({ dispute: opened }, NOW)
    expect(badge?.tone).toBe('open')
    expect(badge?.label).toBe('Chargeback open')
    expect(badge?.evidenceDueByMs).toBe(DUE_BY)
    expect(badge?.evidenceDaysLeft).toBe(5)
    expect(badge?.detail).toContain('$62.00 disputed (product not received)')
    expect(badge?.detail).toContain('opened 2026-10-02')
    expect(badge?.detail).toContain('due to Stripe by 2026-10-16')
    expect(badge?.detail).toContain('5 days left')
  })

  it('rounds a part-day up rather than down to expired', () => {
    // Eight hours left is one day left, not zero. Flooring would print
    // "0 days left" on a case the merchant can still answer.
    const badge = describeOrderDispute(
      { dispute: opened },
      DUE_BY - 8 * 3_600_000,
    )
    expect(badge?.evidenceDaysLeft).toBe(1)
    // …and the singular, which the same case pins.
    expect(badge?.detail).toContain('1 day left')
    expect(badge?.detail).not.toContain('1 days left')
  })

  it('says so when the deadline has passed but the case is open', () => {
    const badge = describeOrderDispute({ dispute: opened }, DUE_BY + 86_400_000)
    expect(badge?.tone).toBe('open')
    expect(badge?.evidenceDaysLeft).toBe(-1)
    expect(badge?.detail).toContain('that deadline has passed')
    expect(badge?.detail).not.toContain('days left')
  })

  it('omits the deadline when Stripe sent none', () => {
    const badge = describeOrderDispute(
      { dispute: without(opened, 'evidenceDueByMs') },
      NOW,
    )
    expect(badge?.evidenceDueByMs).toBeUndefined()
    expect(badge?.evidenceDaysLeft).toBeUndefined()
    expect(badge?.detail).toContain('while the case is open')
    expect(badge?.detail).not.toContain('due to Stripe')
  })

  it('never offers a deadline on a settled dispute that still carries one', () => {
    // THE regression this guards. Stripe sends `evidence_details.due_by` on
    // the `closed` event too, so every settled record still has a deadline in
    // it; a badge keyed on that field would tell a merchant to submit evidence
    // for a case they already lost.
    for (const dispute of [lost, won]) {
      expect(dispute.evidenceDueByMs).toBe(DUE_BY)
      const badge = describeOrderDispute({ dispute }, NOW)
      expect(`${dispute.outcome}: ${badge?.evidenceDueByMs}`).toBe(
        `${dispute.outcome}: undefined`,
      )
      expect(badge?.detail).not.toContain('due to Stripe')
      expect(badge?.detail).not.toContain('days left')
    }
  })

  it('reports a lost dispute as money taken back', () => {
    const badge = describeOrderDispute({ dispute: lost }, NOW)
    expect(badge?.tone).toBe('lost')
    expect(badge?.label).toBe('Charged back')
    expect(badge?.detail).toContain('Dispute lost on 2026-10-20')
    expect(badge?.detail).toContain('$62.00 was taken back')
    expect(badge?.detail).toContain('(product not received)')
  })

  it('names both figures when the reversal was capped', () => {
    // AGL-1787 caps the reversal against what is LEFT, so an order already
    // refunded $17 loses only $45 of a $62 dispute. Printing $62 would
    // overstate what left the merchant's books.
    const badge = describeOrderDispute(
      { dispute: { ...lost, reversedCents: 4500 } },
      NOW,
    )
    expect(badge?.detail).toContain('$45.00 was taken back')
    expect(badge?.detail).toContain('of $62.00 disputed')
    expect(badge?.detail).toContain('already refunded')
  })

  it('reports a won dispute as costing nothing', () => {
    const badge = describeOrderDispute({ dispute: won }, NOW)
    expect(badge?.tone).toBe('won')
    expect(badge?.label).toBe('Dispute won')
    expect(badge?.detail).toContain('no money was reversed')
    expect(badge?.detail).not.toContain('taken back')
  })

  it('reports a closed inquiry without claiming a win', () => {
    const badge = describeOrderDispute(
      {
        dispute: {
          ...opened,
          status: 'warning_closed',
          outcome: 'warning_closed',
          closedAtMs: CLOSED_AT,
          reversedCents: 0,
        },
      },
      NOW,
    )
    expect(badge?.tone).toBe('settled')
    expect(badge?.label).toBe('Dispute closed')
    expect(badge?.detail).toContain('warning closed')
    expect(badge?.detail).toContain('no money was reversed')
  })

  it('drops the reason clause when Stripe sent none', () => {
    const badge = describeOrderDispute(
      { dispute: without(opened, 'reason') },
      NOW,
    )
    expect(badge?.detail).toContain('$62.00 disputed, opened')
    expect(badge?.detail).not.toContain('()')
  })
})

describe('summariseOpenDisputes (AGL-1796)', () => {
  it('is silent when nothing is open', () => {
    expect(summariseOpenDisputes([], NOW)).toEqual({ count: 0, overdue: false })
    // A settled dispute is not an alarm, however recently it settled.
    expect(
      summariseOpenDisputes([{ dispute: lost }, { dispute: won }, {}], NOW),
    ).toEqual({ count: 0, overdue: false })
  })

  it('counts only the open ones out of a mixed window', () => {
    const summary = summariseOpenDisputes(
      [
        {},
        { dispute: opened },
        { dispute: lost },
        { dispute: { ...opened, id: 'dp_second' } },
        { dispute: won },
      ],
      NOW,
    )
    expect(summary.count).toBe(2)
  })

  it('reports the TIGHTEST deadline, not the first or the last', () => {
    // Ordered latest-first so a summary that took `[0]` would report the
    // roomiest window and let the urgent one expire.
    const summary = summariseOpenDisputes(
      [
        { dispute: { ...opened, evidenceDueByMs: DUE_BY + 9 * 86_400_000 } },
        { dispute: { ...opened, evidenceDueByMs: DUE_BY - 3 * 86_400_000 } },
        { dispute: { ...opened, evidenceDueByMs: DUE_BY } },
      ],
      NOW,
    )
    expect(summary.count).toBe(3)
    expect(summary.soonestDueByMs).toBe(DUE_BY - 3 * 86_400_000)
    expect(summary.soonestDaysLeft).toBe(2)
    expect(summary.overdue).toBe(false)
  })

  it('flags overdue when any deadline has passed', () => {
    const summary = summariseOpenDisputes(
      [
        { dispute: { ...opened, evidenceDueByMs: DUE_BY } },
        { dispute: { ...opened, evidenceDueByMs: NOW - 86_400_000 } },
      ],
      NOW,
    )
    expect(summary.overdue).toBe(true)
    expect(summary.soonestDaysLeft).toBe(-1)
  })

  it('still counts an open dispute Stripe gave no deadline for', () => {
    const summary = summariseOpenDisputes(
      [{ dispute: without(opened, 'evidenceDueByMs') }],
      NOW,
    )
    expect(summary.count).toBe(1)
    expect(summary.soonestDueByMs).toBeUndefined()
    expect(summary.overdue).toBe(false)
  })
})

describe('splitOrderReversal (AGL-1796)', () => {
  it('attributes an ordinary refund to the merchant', () => {
    expect(splitOrderReversal({ refundedCents: 1700 })).toEqual({
      refundedCents: 1700,
      chargedBackCents: 0,
    })
  })

  it('attributes a lost chargeback to the bank', () => {
    expect(splitOrderReversal({ refundedCents: 6200, dispute: lost })).toEqual({
      refundedCents: 0,
      chargedBackCents: 6200,
    })
  })

  it('splits an order that was refunded AND charged back', () => {
    // $17 refunded by the merchant, then a $62 dispute lost and capped to the
    // remaining $45. Both land in `refundedCents` (AGL-1787), and only this
    // split can tell the merchant which was which.
    expect(
      splitOrderReversal({
        refundedCents: 6200,
        dispute: { ...lost, reversedCents: 4500 },
      }),
    ).toEqual({ refundedCents: 1700, chargedBackCents: 4500 })
  })

  it('attributes nothing to a dispute that was won', () => {
    // `reversedCents` is present and zero on a win — a presence test would
    // have credited the whole refund to the chargeback.
    expect(won.reversedCents).toBe(0)
    expect(splitOrderReversal({ refundedCents: 1700, dispute: won })).toEqual({
      refundedCents: 1700,
      chargedBackCents: 0,
    })
  })

  it('never reports a negative refund when the two fields disagree', () => {
    expect(splitOrderReversal({ refundedCents: 3300, dispute: lost })).toEqual({
      refundedCents: 0,
      chargedBackCents: 3300,
    })
  })

  it('is all zeroes for an order that reversed nothing', () => {
    expect(splitOrderReversal({})).toEqual({
      refundedCents: 0,
      chargedBackCents: 0,
    })
    expect(splitOrderReversal({ dispute: opened })).toEqual({
      refundedCents: 0,
      chargedBackCents: 0,
    })
  })
})
