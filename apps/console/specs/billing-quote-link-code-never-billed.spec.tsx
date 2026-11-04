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
 * A proposal's code survives a workspace that has never been billed (AGL-4157).
 *
 * Staff build a client's workspace and propose a plan with a code. Until the
 * owner adds a card the workspace has no Stripe customer, so the card's first
 * quote is answered with "needs billing details" and no price. That quote used
 * to report no code, which spent the link's code: the card showed the list
 * price, and the card-and-address dialog quoted and bought without it.
 *
 * Mounted the way the Billing page mounts it: the page's card with the link's
 * code, and then the dialog's quote, which reads the code the page holds.
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

/** The page: it owns the applied code, and opens the dialog's quote. */
function Billing({ coupon, dialog }: { coupon: string; dialog: boolean }) {
  const [appliedCode, setAppliedCode] = useState('')
  return (
    <>
      <output data-testid="held-code">{appliedCode}</output>
      <section aria-label="card">
        <BillingPlanQuoteComponent
          orgId="org-1"
          plan="pro"
          interval="year"
          canManage
          appliedCode={appliedCode}
          onAppliedCodeChange={setAppliedCode}
          initialCoupon={coupon}
        />
      </section>
      {dialog ? (
        <section aria-label="dialog">
          <BillingPlanQuoteComponent
            orgId="org-1"
            plan="pro"
            interval="year"
            canManage
            appliedCode={appliedCode}
            onAppliedCodeChange={setAppliedCode}
          />
        </section>
      ) : null}
    </>
  )
}

const LIST = bundleListPriceCents({ plan: 'pro', interval: 'year', addons: {} })

describe('a never-billed workspace keeps the link’s code (AGL-4157)', () => {
  it('shows the code, what it takes off, and the total after it', async () => {
    answers = [
      {
        status: 200,
        body: {
          needsBillingDetails: true,
          promotionCodeApplied: 'ELITE40',
          promotionCodeDuration: 'forever',
          promotionCodeDurationInMonths: null,
          promotionCodePercentOff: 40,
          promotionCodeAmountOffUsd: null,
        },
      },
    ]
    render(<Billing coupon="ELITE40" dialog={false} />)
    await waitFor(() => expect(screen.getByText('Discount (ELITE40)')).toBeTruthy())
    expect(posted[0]).toMatchObject({ action: 'preview', plan: 'pro', promotionCode: 'ELITE40' })
    const off = Math.round(LIST * 0.4)
    expect(screen.getByText(`−${money(off)}`)).toBeTruthy()
    expect(screen.getByText(`${money(LIST - off)}/yr`)).toBeTruthy()
    expect(screen.getByText('Code ELITE40 applies for as long as you subscribe.')).toBeTruthy()
    // And the page holds it, which is what the purchase sends.
    expect(screen.getByTestId('held-code').textContent).toBe('ELITE40')
  })

  it('carries the code into the dialog’s quote once the address is on file', async () => {
    answers = [
      {
        status: 200,
        body: {
          needsBillingDetails: true,
          promotionCodeApplied: 'ELITE40',
          promotionCodeDuration: 'forever',
          promotionCodePercentOff: 40,
        },
      },
      {
        status: 200,
        body: {
          preview: {
            subtotalCents: LIST,
            discountCents: Math.round(LIST * 0.4),
            taxCents: 0,
            totalCents: LIST - Math.round(LIST * 0.4),
            currency: 'usd',
            taxComplete: true,
            taxReason: 'not_collecting',
          },
          promotionCodeApplied: 'ELITE40',
          promotionCodeDuration: 'forever',
        },
      },
    ]
    const view = render(<Billing coupon="ELITE40" dialog={false} />)
    await waitFor(() => expect(screen.getByTestId('held-code').textContent).toBe('ELITE40'))
    view.rerender(<Billing coupon="ELITE40" dialog />)
    await waitFor(() => expect(posted).toHaveLength(2))
    // The dialog never saw the link, only the code the page holds.
    expect(posted[1]).toMatchObject({ action: 'preview', promotionCode: 'ELITE40' })
    await waitFor(() =>
      expect(screen.getByText('Code ELITE40 applied — the total above already includes it.')).toBeTruthy(),
    )
    expect(screen.getByTestId('held-code').textContent).toBe('ELITE40')
  })

  it('states a discount that ends with the price it ends at, and no “/yr” on the first charge', async () => {
    answers = [
      {
        status: 200,
        body: {
          needsBillingAddress: true,
          promotionCodeApplied: 'FIRSTYEAR',
          promotionCodeDuration: 'once',
          promotionCodeAmountOffUsd: 100,
        },
      },
    ]
    render(<Billing coupon="FIRSTYEAR" dialog={false} />)
    await waitFor(() => expect(screen.getByText('Discount (FIRSTYEAR)')).toBeTruthy())
    expect(screen.getByText(money(LIST - 10000))).toBeTruthy()
    expect(
      screen.getByText(
        `Code FIRSTYEAR applies to the first charge only; after it, ${money(LIST)}/yr.`,
      ),
    ).toBeTruthy()
  })

  it('leaves a code Stripe refuses off with a notice, and holds none', async () => {
    answers = [
      { status: 400, body: { error: 'We do not recognize the code “NOPE”.' } },
      { status: 200, body: { needsBillingDetails: true } },
    ]
    render(<Billing coupon="NOPE" dialog={false} />)
    await waitFor(() => expect(screen.getByText(/The code NOPE from your link/)).toBeTruthy())
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1].promotionCode).toBe('')
    expect(screen.getByText(`${money(LIST)}/yr`)).toBeTruthy()
    expect(screen.queryByText(/^Discount/)).toBeNull()
    expect(screen.getByTestId('held-code').textContent).toBe('')
  })
})

describe('listDiscountCents', () => {
  it('takes a percentage of the whole total', () => {
    expect(listDiscountCents(58800, { percentOff: 40 })).toBe(23520)
  })
  it('takes an amount off, never more than the total', () => {
    expect(listDiscountCents(58800, { amountOffUsd: 100 })).toBe(10000)
    expect(listDiscountCents(5000, { amountOffUsd: 100 })).toBe(5000)
  })
  it('takes nothing without terms', () => {
    expect(listDiscountCents(58800, {})).toBe(0)
  })
})
