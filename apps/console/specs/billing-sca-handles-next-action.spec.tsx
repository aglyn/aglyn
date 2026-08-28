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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * THE BANK CHALLENGE ON A NATIVELY PAID INVOICE.
 *
 * NO LIVE PAYMENT WAS MADE WRITING THIS: `fetch` is mocked throughout, the
 * browser Stripe instance is a double, and nothing here reaches Stripe. This
 * repo has recorded that localhost can run against the LIVE secret key, which
 * is why the whole path is exercised through doubles.
 *
 * ## The distinction being pinned
 *
 * `pay-invoice` confirms the invoice's PaymentIntent SERVER-side and reports
 * `requiresAction` only when Stripe answers `requires_action`. Two Stripe.js
 * methods look like they finish that, and only one does:
 *
 *   `handleNextAction({clientSecret})` — defined for an intent in exactly
 *       `requires_action`, and documented to throw on any other status. It
 *       runs the 3DS challenge and returns.
 *   `confirmPayment({clientSecret, …})` — CONFIRMS an intent, from Payment
 *       Element data or an explicit `confirmParams.payment_method`. This flow
 *       supplies neither: the card is the customer's saved default, attached
 *       by Stripe when the invoice was paid, and the intent is already past
 *       the status confirmation accepts.
 *
 * Reaching for the second is the plausible mistake, and it fails in the worst
 * possible place — only for customers whose issuer demands authentication,
 * only on a real card, and with the money still owed afterwards. Nothing
 * upstream goes red: the route answered correctly, the component ran, and the
 * customer sees a snackbar.
 *
 * ## Why these assertions are on the CALL
 *
 * What renders is not the subject. The subject is which method the component
 * hands the client secret to, so the double carries BOTH methods as spies —
 * if the double only had `handleNextAction`, calling `confirmPayment` would
 * throw a TypeError, and a suite asserting "the challenge did not run" would
 * pass for that reason rather than for the one it claims.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'tok' } }),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

/**
 * BOTH methods, always present. See the note above — this is the fixture
 * decision that keeps the negative assertions honest.
 */
const mockHandleNextAction = jest.fn(async () => ({
  paymentIntent: { status: 'succeeded' },
}))
const mockConfirmPayment = jest.fn(async () => ({
  paymentIntent: { status: 'succeeded' },
}))
jest.mock('../utils/browser-stripe', () => ({
  __esModule: true,
  getBrowserStripe: () =>
    Promise.resolve({
      handleNextAction: mockHandleNextAction,
      confirmPayment: mockConfirmPayment,
    }),
  browserStripeConfigured: () => true,
}))

import BillingOpenInvoicesCardComponent from '../components/billing/billing-open-invoices-card.component'

const INVOICE = {
  id: 'in_123',
  number: 'AGL-0007',
  status: 'open',
  amountDueCents: 4200,
  currency: 'usd',
  created: '2026-08-01T00:00:00.000Z',
  hostedInvoiceUrl: null,
  invoicePdf: null,
}

/** Every `action: 'pay'` body the component sent, so a control can prove it ran. */
let payBodies: any[] = []

const mockFetch = (pay: { status?: number; body: any }) => {
  payBodies = []
  ;(globalThis as any).fetch = jest.fn(async (_url: string, init: any = {}) => {
    const body = JSON.parse(String(init.body))
    if (body.action === 'get') {
      return { status: 200, json: async () => ({ invoices: [INVOICE] }) }
    }
    payBodies.push(body)
    return { status: pay.status ?? 200, json: async () => pay.body }
  })
}

/** Render, wait for the list, then press Pay now. */
const payTheInvoice = async () => {
  render(<BillingOpenInvoicesCardComponent orgId="org1" canManage />)
  const button = await screen.findByRole('button', { name: 'Pay now' })
  fireEvent.click(button)
}

beforeEach(() => {
  jest.clearAllMocks()
  payBodies = []
})

describe('an issuer that demands authentication', () => {
  it('is answered with handleNextAction, carrying the route’s client secret', async () => {
    mockFetch({
      body: { requiresAction: true, paymentClientSecret: 'pi_1_secret_abc' },
    })
    await payTheInvoice()
    await waitFor(() =>
      expect(mockHandleNextAction).toHaveBeenCalledWith({
        clientSecret: 'pi_1_secret_abc',
      }),
    )
    // The whole point. `confirmPayment` is present on the double and is not
    // the method this path may use.
    expect(mockConfirmPayment).not.toHaveBeenCalled()
  })

  it('surfaces a refused challenge rather than reporting the payment as submitted', async () => {
    mockHandleNextAction.mockResolvedValueOnce({
      error: { message: 'Your bank declined the authentication.' },
    } as never)
    mockFetch({
      body: { requiresAction: true, paymentClientSecret: 'pi_1_secret_abc' },
    })
    await payTheInvoice()
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Your bank declined the authentication.',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    // A challenge the customer failed must not also claim success — the money
    // is still owed.
    expect(mockEnqueueSnackbar).not.toHaveBeenCalledWith(
      expect.stringContaining('Payment submitted'),
      expect.anything(),
    )
  })
})

describe('CONTROLS — the challenge is driven by the answer, not by the click', () => {
  it('a payment needing no authentication runs NEITHER method', async () => {
    mockFetch({ body: { ok: true } })
    await payTheInvoice()
    // Non-vacuous: the pay request really was issued. Without this the two
    // negative assertions below would also pass if the button did nothing.
    await waitFor(() => expect(payBodies).toHaveLength(1))
    expect(payBodies[0]).toMatchObject({ action: 'pay', invoiceId: 'in_123' })
    expect(mockHandleNextAction).not.toHaveBeenCalled()
    expect(mockConfirmPayment).not.toHaveBeenCalled()
  })

  it('a requiresAction with no client secret runs NEITHER method', async () => {
    // There is nothing to challenge against. Guarding this is what keeps the
    // component from handing `undefined` to Stripe and reporting the throw as
    // a declined card.
    mockFetch({ body: { requiresAction: true } })
    await payTheInvoice()
    await waitFor(() => expect(payBodies).toHaveLength(1))
    expect(mockHandleNextAction).not.toHaveBeenCalled()
    expect(mockConfirmPayment).not.toHaveBeenCalled()
  })

  it('an invoice already settled is not charged again', async () => {
    mockFetch({ body: { alreadyPaid: true } })
    await payTheInvoice()
    await waitFor(() => expect(payBodies).toHaveLength(1))
    expect(mockHandleNextAction).not.toHaveBeenCalled()
    expect(mockConfirmPayment).not.toHaveBeenCalled()
  })
})

/**
 * The behavioral half above drives ONE of the two surfaces that finish a
 * server-confirmed intent. The other is the plan checkout on the billing
 * page, whose component is the whole billing screen and is not rendered here;
 * both are covered as source so that neither can regress alone.
 */
describe('every server-confirmed intent in the console is finished the same way', () => {
  const REPO_ROOT = resolve(__dirname, '../../..')
  const SITES = [
    'apps/console/components/billing/billing-open-invoices-card.component.tsx',
    'apps/console/app/(app)/[orgSlug]/billing/(sections)/page.tsx',
  ]
  const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

  it('PREMISE — both files exist and both handle a client secret', () => {
    // A path that stopped resolving would make every assertion below vacuous.
    for (const path of SITES) {
      expect(read(path)).toContain('paymentClientSecret')
    }
  })

  it('hands the secret to handleNextAction, never to confirmPayment', () => {
    for (const path of SITES) {
      const source = read(path)
      expect(source).toContain('stripe.handleNextAction({')
      expect(source).not.toMatch(/stripe\.confirmPayment\s*\(/)
    }
  })
})
