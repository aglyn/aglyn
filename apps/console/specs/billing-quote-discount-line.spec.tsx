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
 * The quote card's figures reconcile.
 *
 * With a 97% code applied the card rendered a $25.00 subtotal, $0.05 of tax
 * and a $0.80 total, and no line that explained the gap. Stripe's `subtotal`
 * is PRE-discount and its `total` is POST-discount, so the three numbers could
 * not be made to add up by any arithmetic available to the reader — and this
 * is the card whose entire purpose is to state what a plan costs before
 * anything is charged.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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

/** 97% off $25.00, taxed on what remains. The live case. */
const DISCOUNTED = {
  preview: {
    subtotalCents: 2500,
    discountCents: 2425,
    taxCents: 5,
    totalCents: 80,
    currency: 'usd',
    taxComplete: true,
    taxReason: 'standard_rated',
  },
  customerTaxExempt: 'none',
  hasTaxId: true,
  promotionCodeApplied: 'LAUNCH97',
  promotionCodeDuration: 'once',
  promotionCodeDurationInMonths: null,
}

/** Payloads served in order; the last one repeats for any further call. */
let served: unknown[]
function serve(...payloads: unknown[]) {
  served = payloads
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => (served.length > 1 ? served.shift() : served[0]),
  })) as never
}

afterEach(() => jest.restoreAllMocks())

function mount(
  appliedCode = '',
  onAppliedCodeChange: (code: string) => void = () => undefined,
) {
  return render(
    <BillingPlanQuoteComponent
      orgId="org-1"
      plan="starter"
      interval="month"
      canManage
      appliedCode={appliedCode}
      onAppliedCodeChange={onAppliedCodeChange}
    />,
  )
}

describe('the discount line', () => {
  it('names the discount, so the rows add up', async () => {
    serve(DISCOUNTED)
    mount('LAUNCH97')
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    // The row, labelled with the code that caused it.
    expect(screen.getByText('Discount (LAUNCH97)')).toBeTruthy()
    expect(screen.getByText('−$24.25')).toBeTruthy()
    // And the three figures it reconciles are all still on screen.
    expect(screen.getByText('$25.00')).toBeTruthy()
    expect(screen.getByText('$0.05')).toBeTruthy()
    expect(screen.getByText('$0.80')).toBeTruthy()
  })

  it('is absent when nothing was discounted', async () => {
    // A zero discount row on every undiscounted quote would be noise, and an
    // always-present "−$0.00" reads as a coupon that failed.
    serve({
      ...DISCOUNTED,
      preview: { ...DISCOUNTED.preview, discountCents: 0, totalCents: 2505 },
      promotionCodeApplied: null,
    })
    mount()
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(screen.queryByText(/^Discount/)).toBeNull()
  })

  it('is absent on a payload that carries no discount field at all', async () => {
    // `?? 0` is the honest reading of a payload without the field: no row,
    // rather than a row invented out of `subtotal - total`.
    const { discountCents, ...preview } = DISCOUNTED.preview
    void discountCents
    serve({ ...DISCOUNTED, preview, promotionCodeApplied: null })
    mount()
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(screen.queryByText(/^Discount/)).toBeNull()
  })
})

describe('an applied code can be taken back off', () => {
  it('re-quotes with no code, and reports what the server answered', async () => {
    // Apply is disabled on an empty box, so before this there was no gesture
    // that removed a code — which stopped mattering as a display nuisance and
    // started mattering as money the moment the code reached the charge.
    const changes: string[] = []
    serve(DISCOUNTED, {
      ...DISCOUNTED,
      preview: { ...DISCOUNTED.preview, discountCents: 0, totalCents: 2505 },
      promotionCodeApplied: null,
      promotionCodeDuration: null,
    })
    mount('LAUNCH97', (code: string) => void changes.push(code))
    await waitFor(() => expect(screen.getByText('Discount (LAUNCH97)')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(changes).toContain(''))
    // The page's copy is cleared by the SERVER's `promotionCodeApplied`, so a
    // removal that Stripe did not honor cannot leave the page believing the
    // discount is gone while the charge still carries it.
    expect(changes[changes.length - 1]).toBe('')
  })

  it('offers no Remove button when no code is applied', async () => {
    serve({ ...DISCOUNTED, promotionCodeApplied: null })
    mount()
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })
})
