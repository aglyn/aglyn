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
 * The tax ID is asked for BEFORE the charge it changes.
 *
 * A business tax ID is an input to what Stripe charges — it is what makes
 * reverse charge apply. The card that collects one sits further down the same
 * page, and nothing pointed a customer at it on the way to subscribing. A
 * VAT-registered business therefore paid VAT that a registration on file would
 * have zeroed, and found the field afterwards, by which time the invoice was
 * issued.
 *
 * The prompt deliberately does NOT promise the tax will drop: whether a
 * registration changes the outcome is Stripe's determination and depends on
 * jurisdiction. It raises the question at the only moment the answer can still
 * affect the charge.
 */

import { render, screen, waitFor } from '@testing-library/react'

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

import BillingPlanQuoteComponent from '../components/billing/billing-plan-quote.component'

/** A taxed quote — the state where a tax ID could matter. */
const TAXED = {
  preview: {
    subtotalCents: 2500,
    taxCents: 165,
    totalCents: 2665,
    currency: 'usd',
    taxComplete: true,
    taxReason: 'standard_rated',
  },
  customerTaxExempt: 'none',
  hasTaxId: false,
}

function serve(payload: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })) as never
}

const PROMPT = /Registered for VAT, GST or a similar business tax/i

afterEach(() => jest.restoreAllMocks())

describe('the tax ID prompt', () => {
  it('appears on a taxed quote when no tax ID is on file', async () => {
    serve(TAXED)
    render(
      <BillingPlanQuoteComponent
        orgId="org-1"
        plan="starter"
        interval="month"
        canManage
        appliedCode=""
        onAppliedCodeChange={() => undefined}
      />,
    )
    await waitFor(() => expect(screen.getByText(PROMPT)).toBeTruthy())
    // And it says WHEN it stops helping, which is the actionable half.
    expect(screen.getByText(PROMPT).textContent).toMatch(
      /after it is on file/i,
    )
  })

  it('does NOT appear once a tax ID is on file', async () => {
    serve({ ...TAXED, hasTaxId: true })
    render(
      <BillingPlanQuoteComponent
        orgId="org-1"
        plan="starter"
        interval="month"
        canManage
        appliedCode=""
        onAppliedCodeChange={() => undefined}
      />,
    )
    await waitFor(() => expect(screen.getByText(/Subtotal/)).toBeTruthy())
    expect(screen.queryByText(PROMPT)).toBeNull()
  })

  it('does NOT appear when reverse charge already applied', async () => {
    // Nagging a business that has already got the treatment is how a prompt
    // becomes noise people learn to skip.
    serve({
      ...TAXED,
      preview: { ...TAXED.preview, taxCents: 0, taxReason: 'reverse_charge' },
    })
    render(
      <BillingPlanQuoteComponent
        orgId="org-1"
        plan="starter"
        interval="month"
        canManage
        appliedCode=""
        onAppliedCodeChange={() => undefined}
      />,
    )
    await waitFor(() => expect(screen.getByText(/reverse charge/i)).toBeTruthy())
    expect(screen.queryByText(PROMPT)).toBeNull()
  })

  it('does NOT appear while the tax is still unknown', async () => {
    // With no address there is no tax yet, so there is nothing a tax ID could
    // be said to change. The missing address is the thing to fix first.
    serve({ needsBillingAddress: true })
    render(
      <BillingPlanQuoteComponent
        orgId="org-1"
        plan="starter"
        interval="month"
        canManage
        appliedCode=""
        onAppliedCodeChange={() => undefined}
      />,
    )
    await waitFor(() =>
      expect(screen.getByText(/Add your billing address/i)).toBeTruthy(),
    )
    expect(screen.queryByText(PROMPT)).toBeNull()
  })

  it('CONTROL — it promises nothing about the amount', async () => {
    // Whether a registration changes the outcome is Stripe's determination
    // and depends on jurisdiction. A prompt that says "this will remove the
    // tax" is a claim we cannot make and would be wrong in most countries.
    serve(TAXED)
    render(
      <BillingPlanQuoteComponent
        orgId="org-1"
        plan="starter"
        interval="month"
        canManage
        appliedCode=""
        onAppliedCodeChange={() => undefined}
      />,
    )
    const said = (await screen.findByText(PROMPT)).textContent ?? ''
    expect(said).not.toMatch(/will remove|will be zero|no tax will/i)
    expect(said).toMatch(/in some countries/i)
  })
})
