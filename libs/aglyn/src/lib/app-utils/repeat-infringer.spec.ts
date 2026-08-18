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
 * AGL-1983: the §512(i) strike counter.
 *
 * The property this suite exists to defend is not that three strikes escalate
 * — that is one line and it is hard to get wrong. It is that a strike is
 * earned by the RIGHT event and comes off for the right ones. A counter that
 * incremented on receipt would let a competitor terminate a customer with
 * three emails; a counter that never decremented would leave a strike
 * standing after the very process that reversed the takedown, which is the
 * shape of unfairness that makes a policy read as unreasonably implemented —
 * the half of §512(i) providers actually lose on.
 */

import {
  STRIKE_FINAL_AT,
  STRIKE_TERMINATE_AT,
  STRIKE_WARN_AT,
  STRIKE_WITHDRAWAL_REASONS,
  countStandingStrikes,
  isStrikeWithdrawalReason,
  repeatInfringerVerdict,
  strikeEarnedBy,
  strikeRemovedBy,
} from './repeat-infringer'
import { ABUSE_REPORT_STATUSES } from './abuse-report'

describe('strikeEarnedBy', () => {
  it('counts an ACTIONED copyright notice and nothing else', () => {
    expect(strikeEarnedBy('dmca', 'actioned')).toBe(true)
  })

  it('does not count a notice nobody has adjudicated', () => {
    // The whole reason the counter hangs off `actioned` rather than receipt.
    // Anyone can file; a strike must mean a human looked and took content
    // down, or three strangers can close a paying account between them.
    expect(strikeEarnedBy('dmca', 'open')).toBe(false)
    expect(strikeEarnedBy('dmca', 'reviewing')).toBe(false)
  })

  it('does not count a notice staff rejected', () => {
    expect(strikeEarnedBy('dmca', 'dismissed')).toBe(false)
  })

  it('does not count a non-copyright takedown', () => {
    // The queue carries phishing, malware and spam too, and every one of them
    // can be `actioned`. §512(i) is about infringement — a phishing takedown
    // that fed this ledger would terminate accounts for the wrong reason
    // under a policy that says copyright.
    for (const category of ['phishing', 'malware', 'csam', 'spam', 'impersonation', 'other']) {
      expect(strikeEarnedBy(category, 'actioned')).toBe(false)
    }
  })

  it('never earns and removes on the same status', () => {
    // The pair must partition, or a single transition would both add and
    // remove a strike and the count would depend on call order.
    for (const status of ABUSE_REPORT_STATUSES) {
      expect(strikeEarnedBy('dmca', status) && strikeRemovedBy('dmca', status)).toBe(
        false,
      )
    }
  })
})

describe('strikeRemovedBy', () => {
  it('gives the strike back when staff dismiss a notice they had actioned', () => {
    expect(strikeRemovedBy('dmca', 'dismissed')).toBe(true)
  })

  it('gives it back when a report is reopened for another look', () => {
    expect(strikeRemovedBy('dmca', 'open')).toBe(true)
    expect(strikeRemovedBy('dmca', 'reviewing')).toBe(true)
  })

  it('does not touch strikes on a non-copyright report', () => {
    expect(strikeRemovedBy('phishing', 'dismissed')).toBe(false)
  })
})

describe('repeatInfringerVerdict', () => {
  it('says nothing about an account with a clean record', () => {
    const verdict = repeatInfringerVerdict(0)
    expect(verdict.level).toBe('none')
    expect(verdict.strikes).toBe(0)
    expect(verdict.decisionRequired).toBe(false)
  })

  it('escalates through warn and final before termination', () => {
    // Termination is never the first thing a customer hears. A subscriber who
    // does not know they are on a strike cannot correct their behaviour, and
    // a policy that only speaks at the end is one a court can call
    // unreasonably implemented.
    expect(repeatInfringerVerdict(STRIKE_WARN_AT).level).toBe('warn')
    expect(repeatInfringerVerdict(STRIKE_FINAL_AT).level).toBe('final')
    expect(repeatInfringerVerdict(STRIKE_TERMINATE_AT).level).toBe('terminate')
  })

  it('requires a recorded human decision ONLY at the threshold', () => {
    // This boolean is the thing that makes the counter a policy rather than a
    // number on a page: the admin route refuses to close a further copyright
    // report on the account while it is true. If it were true earlier it
    // would jam the queue on a first strike; if it were never true the
    // threshold would do nothing at all, which is precisely what §512(i)
    // declines to credit.
    expect(repeatInfringerVerdict(STRIKE_TERMINATE_AT - 1).decisionRequired).toBe(
      false,
    )
    expect(repeatInfringerVerdict(STRIKE_TERMINATE_AT).decisionRequired).toBe(true)
  })

  it('does not soften once the threshold is passed', () => {
    // A fourth strike must not read as less serious than the third — an
    // equality check instead of `>=` would wrap right back to `none`.
    for (const strikes of [STRIKE_TERMINATE_AT, 4, 9, 40]) {
      const verdict = repeatInfringerVerdict(strikes)
      expect(verdict.level).toBe('terminate')
      expect(verdict.decisionRequired).toBe(true)
    }
  })

  it('treats junk as a clean record rather than as a threshold', () => {
    // Failing towards `none` is the right direction for a garbage input: the
    // consequence at the other end is closing a paying customer's account,
    // and that must never be reachable by a NaN.
    for (const junk of [undefined, null, NaN, -3, 'three', {}]) {
      const verdict = repeatInfringerVerdict(junk)
      expect(verdict.level).toBe('none')
      expect(verdict.decisionRequired).toBe(false)
    }
  })

  it('always names a consequence in words', () => {
    // The string is quoted to the customer and shown to staff; an empty one
    // would make the queue's most serious row the least informative.
    for (const strikes of [0, 1, 2, 3, 7]) {
      expect(repeatInfringerVerdict(strikes).consequence.length).toBeGreaterThan(20)
    }
  })
})

describe('countStandingStrikes', () => {
  it('counts rows that have not been withdrawn', () => {
    expect(
      countStandingStrikes([{}, { withdrawnAt: null }, { withdrawnAt: 1 }]),
    ).toBe(2)
  })

  it('is zero for an account with no ledger at all', () => {
    expect(countStandingStrikes(null)).toBe(0)
    expect(countStandingStrikes(undefined)).toBe(0)
    expect(countStandingStrikes([])).toBe(0)
  })

  it('does not count a withdrawn strike, whatever the reason', () => {
    // A counter-noticed takedown that left its strike standing would count an
    // infringement the §512(g) process just declined to affirm.
    const ledger = STRIKE_WITHDRAWAL_REASONS.map((reason) => ({
      withdrawnAt: 1_700_000_000_000,
      withdrawnReason: reason,
    }))
    expect(countStandingStrikes(ledger)).toBe(0)
    expect(countStandingStrikes([...ledger, {}])).toBe(1)
  })

  it('keeps withdrawn rows countable as history', () => {
    // Withdrawal marks rather than deletes, because "did we know, and when"
    // is the question this whole queue exists to answer, and a lifted strike
    // is part of that answer.
    const ledger = [{ withdrawnAt: 1 }, {}]
    expect(ledger.length).toBe(2)
    expect(countStandingStrikes(ledger)).toBe(1)
  })
})

describe('isStrikeWithdrawalReason', () => {
  it('accepts each declared reason and refuses free text', () => {
    for (const reason of STRIKE_WITHDRAWAL_REASONS) {
      expect(isStrikeWithdrawalReason(reason)).toBe(true)
    }
    expect(isStrikeWithdrawalReason('because I said so')).toBe(false)
    expect(isStrikeWithdrawalReason(undefined)).toBe(false)
  })

  it('names the counter-notice route explicitly', () => {
    // The one reason that has to exist for AGL-1983 to be coherent: a
    // restoration under §512(g) reverses the takedown, so it must be able to
    // reverse the strike, and the ledger must record that THAT is why.
    expect([...STRIKE_WITHDRAWAL_REASONS]).toContain('counterNoticeRestored')
  })
})
