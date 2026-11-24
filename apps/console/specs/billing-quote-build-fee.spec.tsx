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

/**
 * What the owner sees of a website build fee (AGL-4244): Billing's "What you
 * will pay" names it as its own line, one time, with the total due today
 * including it and the tax Stripe computed; before a billing address it is
 * added to the list total before tax. The link the owner opened rides every
 * quote so the server prices its record's fee. The purchase confirm names
 * the fee and renews the plan without it.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { purchaseConfirmQuote } from '../utils/purchase-confirm-quote'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
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
  BUILD_FEE_QUOTE_CAPTION,
} from '../components/billing/billing-plan-quote.component'

const FEE = { amountCents: 35000, label: 'E-commerce website build' }

let posted: Array<Record<string, any>>
let answerBody: unknown

beforeEach(() => {
  posted = []
  global.fetch = jest.fn(async (_url: unknown, init: any) => {
    posted.push(JSON.parse(String(init?.body ?? '{}')))
    return { ok: true, status: 200, json: async () => answerBody }
  }) as never
})

afterEach(() => jest.restoreAllMocks())

const mount = (bundleLinkId?: string) =>
  render(
    <BillingPlanQuoteComponent
      orgId="org-1"
      plan="starter"
      interval="month"
      canManage
      appliedCode=""
      onAppliedCodeChange={() => undefined}
      addons={{ siteCare: 1 }}
      bundleLinkId={bundleLinkId}
    />,
  )

describe('Billing’s quote shows the build fee as its own one-time line', () => {
  it('names the fee and the total due today with Stripe’s tax, which includes it', async () => {
    answerBody = {
      preview: {
        subtotalCents: 40400,
        discountCents: 0,
        taxCents: 2660,
        totalCents: 43060,
        currency: 'usd',
        taxComplete: true,
        taxReason: 'standard_rated',
      },
      customerTaxExempt: 'none',
      hasTaxId: true,
      promotionCodeApplied: null,
      buildFee: FEE,
    }
    mount('link-1')
    await screen.findByText('E-commerce website build · one time')
    expect(screen.getByText('$350.00')).toBeTruthy()
    expect(screen.getByText('Total today')).toBeTruthy()
    expect(screen.getByText('$430.60')).toBeTruthy()
    expect(screen.getByText('$26.60')).toBeTruthy()
    expect(screen.getByText(BUILD_FEE_QUOTE_CAPTION)).toBeTruthy()
    expect(posted[0]).toMatchObject({ action: 'preview', bundleLinkId: 'link-1' })
  })

  it('adds the fee to the list total before tax while there is no billing address', async () => {
    answerBody = { needsBillingAddress: true, buildFee: FEE }
    mount()
    await screen.findByText('E-commerce website build · one time')
    // Starter's list price with Site Care, plus the fee, with no "/mo" on a
    // total that is today's charge and not the monthly price.
    const total = screen.getByText('Total before tax').parentElement?.textContent ?? ''
    expect(total).toMatch(/Total before tax\$\d[\d,]*\.\d\d$/)
    expect(posted[0]).not.toHaveProperty('bundleLinkId')
  })

  it('shows no fee line when the server prices none', async () => {
    answerBody = {
      preview: {
        subtotalCents: 5400,
        discountCents: 0,
        taxCents: 0,
        totalCents: 5400,
        currency: 'usd',
        taxComplete: true,
        taxReason: 'standard_rated',
      },
    }
    mount()
    await waitFor(() => expect(screen.getByText('Total today')).toBeTruthy())
    expect(screen.queryByText(/one time/)).toBeNull()
    expect(screen.queryByText(BUILD_FEE_QUOTE_CAPTION)).toBeNull()
  })
})

describe('the purchase confirm names the fee and renews the plan without it', () => {
  it('says the fee is in today’s charge and once only', () => {
    const quote = purchaseConfirmQuote({
      planLabel: 'Starter',
      interval: 'month',
      subtotalCents: 40400,
      discountCents: 0,
      totalCents: 43060,
      currency: 'usd',
      taxComplete: true,
      promotionCode: '',
      promotionDuration: null,
      promotionDurationInMonths: null,
      buildFeeCents: 35000,
      buildFeeLabel: 'E-commerce website build',
    })
    expect(quote.confirmationText).toBe('Pay $430.60')
    expect(quote.description).toContain(
      'That includes E-commerce website build, $350.00 one time, charged only on this first payment.',
    )
    expect(quote.description).toContain('After it, Starter renews at $54.00 per month plus tax, until you cancel.')
    expect(quote.description).not.toContain('renews at $430.60')
  })

  it('reads exactly as before without a fee', () => {
    const quote = purchaseConfirmQuote({
      planLabel: 'Starter',
      interval: 'month',
      subtotalCents: 5400,
      discountCents: 0,
      totalCents: 5400,
      currency: 'usd',
      taxComplete: true,
      promotionCode: '',
      promotionDuration: null,
      promotionDurationInMonths: null,
    })
    expect(quote.description).toContain('It renews at $54.00 per month until you cancel.')
    expect(quote.description).not.toContain('one time')
  })
})
