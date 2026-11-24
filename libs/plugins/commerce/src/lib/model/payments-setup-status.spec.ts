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
 *
 * @jest-environment node
 */

import {
  paymentsDeadlineText,
  paymentsRequirementsNotice,
  paymentsReturnResult,
} from './payments-setup-status'

const NOW = Date.UTC(2026, 10, 24)
const LATER = Date.UTC(2026, 11, 15, 12)

describe('paymentsRequirementsNotice (AGL-4245)', () => {
  const base = {
    stripeAccountId: 'acct_1',
    stripeDetailsSubmitted: true,
    stripeChargesEnabled: true,
    stripeRequirementsDueCount: 2,
    stripeRequirementsDeadlineMs: LATER,
  }

  it('names the deadline and payouts while payments still work', () => {
    expect(paymentsRequirementsNotice(base, { now: NOW, locale: 'en-US' })).toEqual({
      severity: 'warning',
      text: `Stripe needs more details by ${paymentsDeadlineText(LATER, 'en-US')} to keep payouts running.`,
      continueSetup: true,
    })
  })

  it('says payments when card payments are already off', () => {
    expect(
      paymentsRequirementsNotice({ ...base, stripeChargesEnabled: false }, { now: NOW })?.text,
    ).toMatch(/to keep taking payments\.$/)
  })

  it('is an error, with no date, once something is past due', () => {
    const notice = paymentsRequirementsNotice(
      { ...base, stripeRequirementsPastDueCount: 1 },
      { now: NOW },
    )
    expect(notice?.severity).toBe('error')
    expect(notice?.text).toBe('Stripe needs more details to keep payouts running.')
  })

  it('says nothing before the owner has been through Stripe’s form, or with nothing due', () => {
    expect(paymentsRequirementsNotice({ ...base, stripeDetailsSubmitted: false })).toBeNull()
    expect(paymentsRequirementsNotice({ ...base, stripeRequirementsDueCount: 0 })).toBeNull()
    expect(paymentsRequirementsNotice(null)).toBeNull()
  })
})

describe('paymentsReturnResult (AGL-4245)', () => {
  it('ready', () => {
    expect(paymentsReturnResult({ stripePayoutsEnabled: true }, true)).toMatchObject({
      severity: 'success',
      continueSetup: false,
    })
  })
  it('payments on, payouts still being checked', () => {
    expect(paymentsReturnResult({ stripePayoutsEnabled: false }, true)).toMatchObject({
      severity: 'info',
      continueSetup: false,
    })
  })
  it('form sent, Stripe still checking', () => {
    expect(paymentsReturnResult({ stripeDetailsSubmitted: true }, false)).toMatchObject({
      severity: 'info',
      continueSetup: false,
    })
  })
  it('left part way: still needs a few details, with continue', () => {
    expect(paymentsReturnResult({ stripeDetailsSubmitted: false }, false)).toEqual({
      severity: 'warning',
      text: 'Stripe still needs a few details before your store can take payments.',
      continueSetup: true,
    })
  })
})
