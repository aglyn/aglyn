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
 * THE OVERAGE GUARDS AND THE LADDER (AGL-3011).
 *
 * The arithmetic that decides how much a workspace may owe and when it is
 * refused, exercised without a database or a network. The suite that matters
 * most is "the bound holds even if a charge never runs" — that property is
 * the reason the design exists, and it is a property of THIS function rather
 * than of the charge path, so it is provable here.
 */

import {
  AI_OVERAGE_CEILING_LADDER_USD,
  AI_OVERAGE_THRESHOLD_USD,
  AI_OVERAGE_UNPAID_LIMIT_USD,
  aiOverageCardOnFile,
  aiOverageEffectiveCeilingUsd,
  aiOverageQualifyingMonth,
  aiOverageStandingCeilingUsd,
  aiOverageStep,
  EMPTY_AI_OVERAGE_STANDING,
  readAiOverageStanding,
  type AiOverageStanding,
} from './ai-overage-standing'
import {
  aiOverageNextChargeUsd,
  aiOverageRefusal,
  aiOverageRefusalStatus,
  aiOverageRefusalText,
  aiOverageReservationRefusal,
} from './ai-overage-gate'

const NOW = new Date('2026-09-16T12:00:00.000Z')

function standing(overrides: Partial<AiOverageStanding> = {}): AiOverageStanding {
  return { ...EMPTY_AI_OVERAGE_STANDING, ...overrides }
}

/** A workspace with a card and nothing wrong with it. */
function healthy(overrides: Partial<AiOverageStanding> = {}): AiOverageStanding {
  return standing({ paymentMethodType: 'card', ...overrides })
}

describe('the ladder', () => {
  it('starts every workspace at the first rung, Advanced and Agency included', () => {
    // The $150 start for the two largest plans was an option in the design
    // and was not taken. The ladder is not plan-aware AT ALL, which is what
    // makes that true by construction rather than by a table nobody reads.
    expect(aiOverageStandingCeilingUsd(healthy(), NOW)).toBe(50)
    expect(AI_OVERAGE_CEILING_LADDER_USD).toEqual([50, 150, 500])
  })

  it('rises one rung per qualifying month and stops at the top', () => {
    expect(aiOverageStep(healthy({ qualifyingMonths: [] }))).toBe(0)
    expect(aiOverageStep(healthy({ qualifyingMonths: ['2026-08'] }))).toBe(1)
    expect(aiOverageStep(healthy({ qualifyingMonths: ['2026-07', '2026-08'] }))).toBe(2)
    expect(
      aiOverageStep(
        healthy({ qualifyingMonths: ['2026-05', '2026-06', '2026-07', '2026-08'] }),
      ),
    ).toBe(2)
    expect(
      aiOverageStandingCeilingUsd(healthy({ qualifyingMonths: ['2026-08'] }), NOW),
    ).toBe(150)
    expect(
      aiOverageStandingCeilingUsd(
        healthy({ qualifyingMonths: ['2026-07', '2026-08'] }),
        NOW,
      ),
    ).toBe(500)
  })

  it('counts a later month with a real payment, and never the first one', () => {
    const first = healthy({ firstPaidMonth: null })
    // The month a workspace subscribes is the baseline, not a step. Counting
    // it would start everybody one rung up on the day they paid once.
    expect(
      aiOverageQualifyingMonth(first, {
        month: '2026-09',
        amountPaidCents: 4900,
        paidOutOfBand: false,
      }),
    ).toBeNull()
    const later = healthy({ firstPaidMonth: '2026-08' })
    expect(
      aiOverageQualifyingMonth(later, {
        month: '2026-09',
        amountPaidCents: 4900,
        paidOutOfBand: false,
      }),
    ).toBe('2026-09')
    // The same month is not a later month.
    expect(
      aiOverageQualifyingMonth(later, {
        month: '2026-08',
        amountPaidCents: 4900,
        paidOutOfBand: false,
      }),
    ).toBeNull()
  })

  it('refuses a payment that is not evidence money moved', () => {
    const later = healthy({ firstPaidMonth: '2026-08' })
    // Marked paid by hand in the Dashboard. A staff action, not a payment.
    expect(
      aiOverageQualifyingMonth(later, {
        month: '2026-09',
        amountPaidCents: 4900,
        paidOutOfBand: true,
      }),
    ).toBeNull()
    // Fully credited: an invoice, but no money.
    expect(
      aiOverageQualifyingMonth(later, {
        month: '2026-09',
        amountPaidCents: 0,
        paidOutOfBand: false,
      }),
    ).toBeNull()
  })

  it('lets a staff override outrank the ladder until it expires', () => {
    const override = {
      ceilingUsd: 2_000,
      reason: 'migration week',
      setBy: 'staff-1',
      setAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    }
    expect(aiOverageStandingCeilingUsd(healthy({ staffOverride: override }), NOW)).toBe(
      2_000,
    )
    const expired = { ...override, expiresAt: new Date(NOW.getTime() - 1).toISOString() }
    expect(aiOverageStandingCeilingUsd(healthy({ staffOverride: expired }), NOW)).toBe(50)
    // An expiry that does not parse EXPIRES the override. A ceiling that was
    // meant to end and cannot say when must not outlive its reason.
    const unparseable = { ...override, expiresAt: 'next tuesday' }
    expect(aiOverageStandingCeilingUsd(healthy({ staffOverride: unparseable }), NOW)).toBe(
      50,
    )
  })

  it('binds on the LOWER of the workspace ceiling and Aglyn’s', () => {
    const two = healthy({ qualifyingMonths: ['2026-07', '2026-08'] }) // $500
    expect(aiOverageEffectiveCeilingUsd({ assistOverage: { capUsd: 20 } }, two, NOW)).toBe(
      20,
    )
    expect(aiOverageEffectiveCeilingUsd({}, two, NOW)).toBe(500)
    expect(
      aiOverageEffectiveCeilingUsd({ assistOverage: { capUsd: 900 } }, healthy(), NOW),
    ).toBe(50)
  })
})

describe('reading a stored standing', () => {
  it('tells "no card" apart from "nobody has looked"', () => {
    // The distinction the whole card rule rests on. A workspace with no
    // document has never been observed and must not be refused for it.
    expect(aiOverageCardOnFile(readAiOverageStanding(null))).toBeUndefined()
    expect(
      aiOverageCardOnFile(readAiOverageStanding({ paymentMethodType: null })),
    ).toBe(false)
    expect(
      aiOverageCardOnFile(readAiOverageStanding({ paymentMethodType: 'card' })),
    ).toBe(true)
    expect(
      aiOverageCardOnFile(readAiOverageStanding({ paymentMethodType: 'us_bank_account' })),
    ).toBe(false)
  })

  it('drops values that do not narrow rather than coercing them', () => {
    const read = readAiOverageStanding({
      qualifyingMonths: ['2026-08', 'nope', '2026-08', 42],
      staffOverride: { ceilingUsd: 'lots', reason: 'x', setBy: 'y' },
      pause: { reason: 'because' },
      lastDisputeAt: 17,
    })
    expect(read.qualifyingMonths).toEqual(['2026-08'])
    // A NaN ceiling would be a ceiling every comparison passes.
    expect(read.staffOverride).toBeNull()
    // An unrecognized pause reason is no pause — a pause whose reason cannot
    // be rendered is a workspace stopped with nothing to tell it.
    expect(read.pause).toBeNull()
    expect(read.lastDisputeAt).toBeNull()
  })
})

describe('the four guards', () => {
  it('admits a healthy workspace inside its ceiling', () => {
    expect(
      aiOverageRefusal({ overageUsd: 12, paidUsd: 0, standing: healthy(), now: NOW }),
    ).toBeNull()
  })

  it('refuses without a card, and abstains when nobody has looked', () => {
    expect(
      aiOverageRefusal({
        overageUsd: 1,
        paidUsd: 0,
        standing: standing({ paymentMethodType: null }),
        now: NOW,
      })?.capReason,
    ).toBe('no-card')
    // Never observed: the card guard says nothing, and $1 of overage is
    // admitted. The bound below does not depend on this guard.
    expect(
      aiOverageRefusal({ overageUsd: 1, paidUsd: 0, standing: standing(), now: NOW }),
    ).toBeNull()
  })

  it('refuses while accrual is paused, whatever paused it', () => {
    for (const reason of ['charge_failed', 'past_due', 'dispute', 'staff'] as const) {
      expect(
        aiOverageRefusal({
          overageUsd: 1,
          paidUsd: 0,
          standing: healthy({ pause: { reason, invoiceId: null, since: null } }),
          now: NOW,
        })?.capReason,
      ).toBe('paused')
    }
  })

  it('refuses AT the month’s ceiling, not past it', () => {
    const at = aiOverageRefusal({
      overageUsd: 50,
      paidUsd: 50,
      standing: healthy(),
      now: NOW,
    })
    expect(at?.capReason).toBe('limit')
    expect(at?.limitUsd).toBe(50)
    expect(
      aiOverageRefusal({
        overageUsd: 49.99,
        paidUsd: 49.99,
        standing: healthy(),
        now: NOW,
      }),
    ).toBeNull()
  })

  it('names the actionable guard when two hold at once', () => {
    // Paused AND over the unpaid limit is the ordinary shape of a workspace
    // whose charge failed. "Pay the invoice" beats "wait".
    expect(
      aiOverageRefusal({
        overageUsd: 80,
        paidUsd: 0,
        standing: healthy({
          pause: { reason: 'charge_failed', invoiceId: 'in_1', since: null },
        }),
        now: NOW,
      })?.capReason,
    ).toBe('paused')
  })
})

describe('the bound holds even if a charge never runs', () => {
  /*
   * THE POINT OF THE WHOLE DESIGN.
   *
   * Everything about charging — the threshold, the invoice, the webhook, the
   * sweep — exists to keep a paying workspace WORKING. None of it is what
   * bounds the money. The bound is this comparison, and these cases model
   * every way the charge path can be absent: never switched on, switched on
   * and broken, switched on and merely slow.
   */
  const noChargeEverRan = { paidUsd: 0 }

  it('refuses at the unpaid limit with nothing ever charged', () => {
    const refusal = aiOverageRefusal({
      overageUsd: AI_OVERAGE_UNPAID_LIMIT_USD,
      ...noChargeEverRan,
      // Top of the ladder, so the CEILING cannot be what refuses. Only the
      // unpaid balance can be, which is what this suite is about.
      standing: healthy({ qualifyingMonths: ['2026-07', '2026-08'] }),
      now: NOW,
    })
    expect(refusal?.capReason).toBe('settling')
    expect(refusal?.limitUsd).toBe(50)
    expect(refusal?.unpaidUsd).toBe(50)
  })

  it('admits one cent under it and refuses at it', () => {
    const under = aiOverageRefusal({
      overageUsd: 49.99,
      ...noChargeEverRan,
      standing: healthy({ qualifyingMonths: ['2026-07', '2026-08'] }),
      now: NOW,
    })
    expect(under).toBeNull()
  })

  it('is unaffected by how far past the limit the month ran', () => {
    // A burst that landed 10x the limit in flight is still refused, and is
    // still refused for the same reason — the guard does not degrade into
    // silence once it is a long way past.
    expect(
      aiOverageRefusal({
        overageUsd: 500,
        ...noChargeEverRan,
        standing: healthy({
          staffOverride: {
            ceilingUsd: 100_000,
            reason: 'ceiling out of the way',
            setBy: 's',
            setAt: null,
            expiresAt: null,
          },
        }),
        now: NOW,
      })?.capReason,
    ).toBe('settling')
  })

  it('lets a workspace keep going exactly as fast as it pays', () => {
    // Paid $50 of $80 accrued: $30 outstanding, under the limit, admitted.
    expect(
      aiOverageRefusal({
        overageUsd: 80,
        paidUsd: 50,
        standing: healthy({ qualifyingMonths: ['2026-07', '2026-08'] }),
        now: NOW,
      }),
    ).toBeNull()
    // Paid $50 of $100: $50 outstanding again, refused again.
    expect(
      aiOverageRefusal({
        overageUsd: 100,
        paidUsd: 50,
        standing: healthy({ qualifyingMonths: ['2026-07', '2026-08'] }),
        now: NOW,
      })?.capReason,
    ).toBe('settling')
  })

  it('is twice the threshold, so a healthy workspace never meets it', () => {
    // One charge in flight plus one accruing is inside the bound. A
    // workspace only reaches it when charges stop settling.
    expect(AI_OVERAGE_UNPAID_LIMIT_USD).toBe(AI_OVERAGE_THRESHOLD_USD * 2)
  })
})

describe('what the workspace is told', () => {
  it('always says the included credits still work', () => {
    for (const capReason of ['no-card', 'paused', 'limit', 'settling'] as const) {
      const text = aiOverageRefusalText({ capReason, limitUsd: 50, unpaidUsd: 50 })
      expect(text).toContain('included credits still work')
    }
  })

  it('answers 402 where the workspace can act and 429 where it can only wait', () => {
    expect(aiOverageRefusalStatus('no-card')).toBe(402)
    expect(aiOverageRefusalStatus('paused')).toBe(402)
    expect(aiOverageRefusalStatus('customer')).toBe(402)
    expect(aiOverageRefusalStatus('limit')).toBe(429)
    expect(aiOverageRefusalStatus('settling')).toBe(429)
  })

  it('quotes the figure that refused', () => {
    expect(aiOverageRefusalText({ capReason: 'limit', limitUsd: 150, unpaidUsd: 0 })).toContain(
      '$150.00',
    )
    expect(
      aiOverageRefusalText({ capReason: 'settling', limitUsd: 50, unpaidUsd: 62.5 }),
    ).toContain('$62.50')
  })

  it('leaves the workspace’s OWN ceiling to the sentence it already had', () => {
    // `assistOverageCapRefusalText` names the control by its console label.
    // Answering here too would be two sentences for one control.
    expect(
      aiOverageReservationRefusal({ refusedBy: 'cap', capReason: 'customer' }),
    ).toBeNull()
    expect(aiOverageRefusalText({ capReason: 'customer', limitUsd: 1, unpaidUsd: 0 })).toBeNull()
  })

  it('answers nothing for a refusal that was not a ceiling', () => {
    expect(aiOverageReservationRefusal({ refusedBy: 'messages' })).toBeNull()
    expect(aiOverageReservationRefusal({ refusedBy: 'band' })).toBeNull()
    expect(aiOverageReservationRefusal({ refusedBy: null })).toBeNull()
    // `cap` with no reason is a refusal from before this shipped; it must
    // fall through to the sentence that door already gave.
    expect(aiOverageReservationRefusal({ refusedBy: 'cap' })).toBeNull()
  })

  it('carries the door’s status with the door’s sentence', () => {
    const paused = aiOverageReservationRefusal({
      refusedBy: 'cap',
      capReason: 'paused',
      overageLimitUsd: 50,
      overageUnpaidUsd: 40,
    })
    expect(paused?.status).toBe(402)
    expect(paused?.text).toContain('paused')
    const settling = aiOverageReservationRefusal({
      refusedBy: 'cap',
      capReason: 'settling',
      overageLimitUsd: 50,
      overageUnpaidUsd: 50,
    })
    expect(settling?.status).toBe(429)
  })
})

describe('what the overage card says about the next charge', () => {
  it('counts down to the threshold and never past zero', () => {
    expect(aiOverageNextChargeUsd(0, 0)).toBe(AI_OVERAGE_THRESHOLD_USD)
    expect(aiOverageNextChargeUsd(10, 0)).toBe(15)
    expect(aiOverageNextChargeUsd(30, 25)).toBe(20)
    expect(aiOverageNextChargeUsd(60, 25)).toBe(0)
  })
})
