/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * The Billing card with a code limited to the plan's base price (AGL-4159).
 *
 * Before Stripe has figures (no card or no address yet) the card works the
 * discount out from the list prices (AGL-4157). A base-price code comes off
 * the plan's own price there, never the add-ons beside it, which is what
 * Stripe will do with it; the sentence under the total says it covers the
 * base price, how long for, what the subscription renews at, and that add-ons
 * and usage past the plan's limits still bill.
 *
 * And a code limited to another plan is left off with the plan it is for, both
 * when a link carried it and when the page already held it from another plan.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { bundleListPriceCents } from '@aglyn/aglyn/app-utils/bundle-intent'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
const mockEnqueue = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueue }),
}))
const mockUser = { uid: 'u-1', getIdToken: async () => 'tok' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))
jest.mock('@aglyn/aglyn', () => ({
  parseLockdownRefusal: () => null,
}))
jest.mock('../components/lockdown-notice.component', () => ({
  __esModule: true,
  default: () => null,
}))

import BillingPlanQuoteComponent, {
  codeDurationSentence,
  listDiscountCents,
} from '../components/billing/billing-plan-quote.component'

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  )
}

/** Every request body a quote posted, in order. */
let posted: Array<Record<string, any>>
/** Answers served in order; the last one repeats. */
let answers: Array<{ status: number; body: unknown }>

beforeEach(() => {
  posted = []
  mockEnqueue.mockClear()
  global.fetch = jest.fn(async (_url: unknown, init: any) => {
    posted.push(JSON.parse(String(init?.body ?? '{}')))
    const next = answers.length > 1 ? answers.shift()! : answers[0]
    return { ok: next.status < 400, status: next.status, json: async () => next.body }
  }) as never
})

afterEach(() => jest.restoreAllMocks())

/** The Billing page: it owns the applied code the purchase sends. */
function Billing({
  plan,
  coupon,
  held = '',
}: {
  plan: string
  coupon?: string
  held?: string
}) {
  const [appliedCode, setAppliedCode] = useState(held)
  return (
    <>
      <output data-testid="held-code">{appliedCode}</output>
      <BillingPlanQuoteComponent
        orgId="org-1"
        plan={plan}
        interval="month"
        canManage
        appliedCode={appliedCode}
        onAppliedCodeChange={setAppliedCode}
        initialCoupon={coupon}
        addons={{ siteCare: 1 }}
      />
    </>
  )
}

const PLAN = bundleListPriceCents({ plan: 'starter', interval: 'month', addons: {} })
const BUNDLE = bundleListPriceCents({ plan: 'starter', interval: 'month', addons: { siteCare: 1 } })

describe('a base-price code before Stripe has figures', () => {
  it('comes off the plan’s price only, and the add-on still bills', async () => {
    expect(BUNDLE).toBeGreaterThan(PLAN)
    answers = [
      {
        status: 200,
        body: {
          needsBillingDetails: true,
          promotionCodeApplied: 'PARTNER',
          promotionCodeDuration: 'repeating',
          promotionCodeDurationInMonths: 24,
          promotionCodePercentOff: 100,
          promotionCodeAmountOffUsd: null,
          promotionCodeBasePriceOnly: true,
        },
      },
    ]
    render(<Billing plan="starter" coupon="PARTNER" />)
    await waitFor(() => expect(screen.getByText('Discount (PARTNER)')).toBeTruthy())
    // 100% of the plan, not of the bundle: the add-on is what is left.
    expect(screen.getByText(`−${money(PLAN)}`)).toBeTruthy()
    expect(screen.getByText(money(BUNDLE - PLAN))).toBeTruthy()
    expect(
      screen.getByText(
        `Code PARTNER covers the plan’s base price for the first 24 months; after that, ` +
          `${money(BUNDLE)}/mo. Add-ons and usage past the plan’s limits bill as usual.`,
      ),
    ).toBeTruthy()
    expect(screen.getByTestId('held-code').textContent).toBe('PARTNER')
  })
})

describe('a code limited to another plan', () => {
  it('is left off a link with the plan it is for', async () => {
    answers = [
      {
        status: 400,
        body: { error: 'This code is for the Starter plan.', promotionCodeRefusal: 'plan' },
      },
      { status: 200, body: { needsBillingDetails: true } },
    ]
    render(<Billing plan="pro" coupon="PARTNER" />)
    await waitFor(() =>
      expect(
        screen.getByText(
          'The code PARTNER from your link was left off. This code is for the Starter plan.',
        ),
      ).toBeTruthy(),
    )
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1].promotionCode).toBe('')
    expect(screen.getByTestId('held-code').textContent).toBe('')
  })

  it('is dropped, with a notice, when the page carries it onto another plan', async () => {
    answers = [
      {
        status: 400,
        body: { error: 'This code is for the Starter plan.', promotionCodeRefusal: 'plan' },
      },
      { status: 200, body: { needsBillingDetails: true } },
    ]
    // The page holds the code from the Starter quote; the owner picked Pro.
    render(<Billing plan="pro" held="PARTNER" />)
    await waitFor(() =>
      expect(
        screen.getByText('The code PARTNER was left off. This code is for the Starter plan.'),
      ).toBeTruthy(),
    )
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[0].promotionCode).toBe('PARTNER')
    expect(posted[1].promotionCode).toBe('')
    // Not held any more, so the purchase cannot send it for Pro.
    expect(screen.getByTestId('held-code').textContent).toBe('')
  })

  it('keeps a carried code any other refusal leaves, as before', async () => {
    answers = [{ status: 400, body: { error: 'We do not recognize the code “OLD”.' } }]
    render(<Billing plan="pro" held="OLD" />)
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalled())
    expect(posted).toHaveLength(1)
    expect(screen.queryByText(/was left off/)).toBeNull()
  })
})

describe('listDiscountCents for a base-price code', () => {
  it('takes the percentage of the plan’s price, not the bundle', () => {
    expect(listDiscountCents(3400, { percentOff: 100, basePriceOnly: true, planCents: 2500 })).toBe(
      2500,
    )
    expect(listDiscountCents(3400, { percentOff: 40, basePriceOnly: true, planCents: 2500 })).toBe(
      1000,
    )
  })
  it('takes an amount off the plan’s price, never more than it', () => {
    expect(
      listDiscountCents(3400, { amountOffUsd: 100, basePriceOnly: true, planCents: 2500 }),
    ).toBe(2500)
  })
  it('is the whole bundle for a whole-subscription code', () => {
    expect(listDiscountCents(3400, { percentOff: 100, planCents: 2500 })).toBe(3400)
  })
})

describe('codeDurationSentence', () => {
  it('says what a base-price code does not cover, on every duration', () => {
    expect(codeDurationSentence('P', 'forever', null, '$25.00/mo', true)).toBe(
      'Code P covers the plan’s base price for as long as you subscribe. Add-ons and ' +
        'usage past the plan’s limits bill as usual.',
    )
    expect(codeDurationSentence('P', 'once', null, '$25.00/mo', true)).toBe(
      'Code P covers the plan’s base price on the first charge only; after it, ' +
        '$25.00/mo. Add-ons and usage past the plan’s limits bill as usual.',
    )
  })
  it('makes no claim about usage for a whole-subscription code', () => {
    expect(codeDurationSentence('P', 'repeating', 3, '$25.00/mo')).toBe(
      'Code P applies for the first 3 months; after that, $25.00/mo.',
    )
    expect(codeDurationSentence('P', 'forever', null, '$25.00/mo')).not.toMatch(/usage/)
  })
})
