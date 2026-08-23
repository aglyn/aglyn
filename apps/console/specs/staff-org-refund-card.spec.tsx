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

/**
 * The refund card on the staff org page (AGL-2486).
 *
 * NO LIVE REFUND WAS ISSUED WRITING THIS: `fetch` is mocked throughout and
 * nothing here reaches Stripe. This repo has recorded that localhost runs
 * against the LIVE secret key, which is why the whole path is exercised
 * through doubles.
 *
 * What these pin is the part of a money-moving control that is easy to get
 * subtly wrong and impossible to notice afterwards: that a DECLINED
 * confirmation posts nothing at all, that the confirmation actually NAMES the
 * amount, currency and charge rather than asking "are you sure", and that the
 * fee Stripe keeps is stated before the click rather than discovered in a
 * reconciliation later.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

const mockConfirm = jest.fn()
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
  CardDisplay: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useStaffRole: () => mockRole,
}))

/** Reassigned per test — the card's copy now depends on the viewer's role. */
let mockRole: string | null = 'super'

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => ({}),
}))

import StaffOrgRefundCard, {
  parseRefundAmountCents,
  remainingRefundableCents,
} from '../components/staff-org-refund-card.component'

const CHARGE = {
  id: 'ch_1',
  amountCents: 5000,
  refundedCents: 1000,
  currency: 'usd',
  created: '2026-08-01T00:00:00.000Z',
  description: 'Pro plan',
  invoiceId: 'in_1',
  invoiceNumber: 'AGL-0001',
  disputed: false,
  paid: true,
  feeCents: 175,
}

let postBodies: any[]

const mockFetch = (over: Record<string, unknown> = {}) => {
  postBodies = []
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ charges: [CHARGE], hasCustomer: true, ...over }),
      }
    }
    postBodies.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        refundId: 're_1',
        amountCents: 4000,
        currency: 'usd',
        feeRetainedCents: 175,
      }),
    }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRole = 'super'
  mockFetch()
  mockConfirm.mockResolvedValue(undefined)
})

/** Selects the charge and a reason — the minimum a refund needs. */
const arm = async () => {
  render(<StaffOrgRefundCard orgId="org-1" />)
  await screen.findByText('ch_1')
  fireEvent.mouseDown(screen.getByLabelText('Charge to refund'))
  fireEvent.click(await screen.findByText(/AGL-0001 —/))
  fireEvent.mouseDown(screen.getByLabelText('Reason'))
  fireEvent.click(await screen.findByText('Billing error on our side'))
}

describe('StaffOrgRefundCard (AGL-2486)', () => {
  describe('the amount helpers', () => {
    it('reads dollars as integer cents', () => {
      expect(parseRefundAmountCents('12.34')).toBe(1234)
      expect(parseRefundAmountCents(' 5 ')).toBe(500)
      // Floating point: 19.99 * 100 is 1998.9999999999998 unrounded, and a
      // truncation there is a refund a cent short of what was displayed.
      expect(parseRefundAmountCents('19.99')).toBe(1999)
    })

    it('rejects an unusable entry rather than coercing it to zero', () => {
      // `Number('') === 0` is the coercion that would turn an empty box into
      // a zero-amount refund request. Both empty and nonsense answer null so
      // the caller has to decide, and the caller reads null as "the whole
      // remainder" only for a box the operator never touched.
      expect(parseRefundAmountCents('')).toBeNull()
      expect(parseRefundAmountCents('  ')).toBeNull()
      expect(parseRefundAmountCents('abc')).toBeNull()
      expect(parseRefundAmountCents('-5')).toBeNull()
      expect(parseRefundAmountCents('0')).toBeNull()
    })

    it('subtracts what is already refunded', () => {
      expect(remainingRefundableCents(CHARGE as any)).toBe(4000)
      expect(
        remainingRefundableCents({ ...CHARGE, refundedCents: 5000 } as any),
      ).toBe(0)
      // Never negative: an over-refunded charge (a Stripe-side adjustment)
      // must read as nothing left, not as a negative amount to send.
      expect(
        remainingRefundableCents({ ...CHARGE, refundedCents: 9000 } as any),
      ).toBe(0)
    })
  })

  describe('what the operator sees before clicking', () => {
    it('states the fee Stripe keeps, in the charge list', async () => {
      render(<StaffOrgRefundCard orgId="org-1" />)
      // $1.75 is the real fee off the balance transaction, not an estimate —
      // the number an operator can reconcile against Stripe.
      expect(await screen.findByText('$1.75 USD')).toBeTruthy()
    })

    it('warns that a refund is a loss, not a reversal', async () => {
      render(<StaffOrgRefundCard orgId="org-1" />)
      expect(
        await screen.findByText(/does not return its processing fee/i),
      ).toBeTruthy()
    })

    it('says "could not read" rather than "nothing to refund" on a Stripe failure', async () => {
      // AGL-940. An empty list here would send staff away believing there was
      // nothing to refund.
      mockFetch({ charges: [], stripeError: 'Invalid API key' })
      render(<StaffOrgRefundCard orgId="org-1" />)
      expect(await screen.findByText(/not "nothing to refund"/i)).toBeTruthy()
    })
  })

  describe('the confirmation', () => {
    it('names the amount, currency, charge and invoice', async () => {
      await arm()
      fireEvent.click(screen.getByRole('button', { name: /Refund/ }))
      await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
      const options = mockConfirm.mock.calls[0][0]
      // "Are you sure?" confirms nothing an operator can check against the
      // Stripe dashboard. All four facts have to be in the dialog.
      expect(options.description).toContain('$40.00 USD')
      expect(options.description).toContain('ch_1')
      expect(options.description).toContain('AGL-0001')
      expect(options.description).toMatch(/1\.75/)
      expect(options.title).toContain('$40.00 USD')
    })

    it('posts NOTHING when the confirmation is declined', async () => {
      mockConfirm.mockRejectedValue(new Error('cancelled'))
      await arm()
      fireEvent.click(screen.getByRole('button', { name: /Refund/ }))
      await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
      // The whole reason the confirmation exists. A declined dialog that
      // still fired the request would be worse than none, because it looks
      // safe.
      expect(postBodies).toHaveLength(0)
    })
  })

  describe('the request', () => {
    it('sends the charge, the reason and a per-attempt idempotency key', async () => {
      await arm()
      fireEvent.click(screen.getByRole('button', { name: /Refund/ }))
      await waitFor(() => expect(postBodies).toHaveLength(1))
      expect(postBodies[0]).toMatchObject({
        orgId: 'org-1',
        chargeId: 'ch_1',
        // Defaults to what is actually left, not to what was captured.
        amountCents: 4000,
      })
      expect(postBodies[0].reason).toBeTruthy()
      expect(postBodies[0].idempotencyKey).toBeTruthy()
    })

    it('mints a DIFFERENT key per attempt', async () => {
      // Two partial refunds on one charge are two real refunds. A key derived
      // from the charge or the amount would silently swallow the second.
      await arm()
      const button = screen.getByRole('button', { name: /Refund/ })
      fireEvent.click(button)
      await waitFor(() => expect(postBodies).toHaveLength(1))
      fireEvent.mouseDown(screen.getByLabelText('Reason'))
      fireEvent.click(await screen.findByText('Goodwill or retention'))
      fireEvent.click(screen.getByRole('button', { name: /Refund/ }))
      await waitFor(() => expect(postBodies).toHaveLength(2))
      expect(postBodies[0].idempotencyKey).not.toBe(postBodies[1].idempotencyKey)
    })

    it('will not submit without a reason', async () => {
      render(<StaffOrgRefundCard orgId="org-1" />)
      await screen.findByText('ch_1')
      fireEvent.mouseDown(screen.getByLabelText('Charge to refund'))
      fireEvent.click(await screen.findByText(/AGL-0001 —/))
      expect(
        screen.getByRole('button', { name: /Refund/ }).hasAttribute('disabled'),
      ).toBe(true)
      expect(postBodies).toHaveLength(0)
    })

    it('will not submit "Other" until the note says what', async () => {
      render(<StaffOrgRefundCard orgId="org-1" />)
      await screen.findByText('ch_1')
      fireEvent.mouseDown(screen.getByLabelText('Charge to refund'))
      fireEvent.click(await screen.findByText(/AGL-0001 —/))
      fireEvent.mouseDown(screen.getByLabelText('Reason'))
      fireEvent.click(await screen.findByText(/^Other/))
      const button = screen.getByRole('button', { name: /Refund/ })
      expect(button.hasAttribute('disabled')).toBe(true)
      fireEvent.change(screen.getByLabelText(/Note \(required\)/), {
        target: { value: 'Chargeback avoidance' },
      })
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Refund/ }).hasAttribute('disabled'),
        ).toBe(false),
      )
    })

    it('refuses an amount larger than what is left', async () => {
      await arm()
      fireEvent.change(screen.getByLabelText('Amount'), {
        target: { value: '50' },
      })
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Refund/ }).hasAttribute('disabled'),
        ).toBe(true),
      )
      expect(postBodies).toHaveLength(0)
    })
  })

  it('reports the fee in the success message, not just the amount', async () => {
    await arm()
    fireEvent.click(screen.getByRole('button', { name: /Refund/ }))
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    const [message] = mockEnqueueSnackbar.mock.calls.at(-1) as [string, unknown]
    expect(message).toContain('$40.00 USD')
    expect(message).toMatch(/1\.75/)
  })
})

/**
 * The boundary is legible BEFORE an amount is typed (AGL-2486).
 *
 * Issuing is no longer `super`-only: support may refund up to a cap and
 * escalates above it. That makes the gate amount-dependent, and an
 * amount-dependent gate discovered on submit is the worst of both — the
 * operator does the whole form, then learns their role could never have done
 * it. Every assertion here is about something visible before the Refund
 * button is reachable.
 */
describe('the card states the operator’s own ceiling first (AGL-2486)', () => {
  /** A charge big enough that a capped role cannot refund all of it. */
  const BIG = { ...CHARGE, amountCents: 60000, refundedCents: 0 }

  const renderWith = async (
    role: string,
    authority: Record<string, unknown>,
    charge = CHARGE,
  ) => {
    mockRole = role
    postBodies = []
    ;(globalThis as any).fetch = jest.fn(async (_url: string, init: any = {}) => {
      if ((init.method ?? 'GET') === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            charges: [charge],
            hasCustomer: true,
            authority: { role, ...authority },
          }),
        }
      }
      postBodies.push(JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    })
    render(<StaffOrgRefundCard orgId="org-1" />)
    await screen.findByText(charge.id)
  }

  const capped = {
    authority: 'capped',
    perRefundCapCents: 15000,
    windowCapCents: 50000,
    windowCents: 0,
    windowCount: 0,
  }

  it('tells a capped role both ceilings without being asked', async () => {
    await renderWith('support', capped)
    expect(screen.getByText(/\$150\.00 per refund/)).toBeTruthy()
    expect(screen.getByText(/\$500\.00 in a rolling 24 hours/)).toBeTruthy()
    expect(screen.getByText(/needs the super staff role/)).toBeTruthy()
  })

  it('counts down the remaining daily allowance rather than restating the cap', async () => {
    // A sentence that always said "$500.00 is left" would be a constant
    // wearing the costume of a reading.
    await renderWith('support', { ...capped, windowCents: 32000 })
    expect(screen.getByText(/\$180\.00 of that is left/)).toBeTruthy()
  })

  it('says the charge is bigger than the role, on the row itself', async () => {
    await renderWith('support', capped, BIG)
    fireEvent.mouseDown(screen.getByLabelText('Charge to refund'))
    expect(
      screen.getByText(/your role can refund \$150\.00 of it/),
    ).toBeTruthy()
  })

  it('blocks an over-cap amount with the sentence the SERVER would have said', async () => {
    await renderWith('support', capped, BIG)
    fireEvent.mouseDown(screen.getByLabelText('Charge to refund'))
    fireEvent.click(screen.getByRole('option', { name: /AGL-0001/ }))
    fireEvent.change(screen.getByLabelText('Amount'), {
      target: { value: '400' },
    })
    await waitFor(() =>
      expect(
        // The amount-specific half, which only the refusal carries — the
        // standing allowance sentence above the form names the cap too, and
        // matching that instead would have passed without the refusal ever
        // being rendered.
        screen.getByText(/\$400\.00 needs the super staff role/),
      ).toBeTruthy(),
    )
    expect(
      screen.getByRole('button', { name: /Refund/ }).hasAttribute('disabled'),
    ).toBe(true)
    expect(postBodies).toHaveLength(0)
  })

  it('leaves an UNDER-cap amount enabled for the same role', async () => {
    // The direction that matters most: the change exists so support can
    // issue the ordinary refund without escalating.
    await renderWith('support', capped, BIG)
    fireEvent.mouseDown(screen.getByLabelText('Charge to refund'))
    fireEvent.click(screen.getByRole('option', { name: /AGL-0001/ }))
    fireEvent.change(screen.getByLabelText('Amount'), {
      target: { value: '120' },
    })
    fireEvent.mouseDown(screen.getByLabelText('Reason'))
    fireEvent.click(screen.getByRole('option', { name: /Billing error/ }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Refund/ }).hasAttribute('disabled'),
      ).toBe(false),
    )
  })

  it('tells a super role it has no ceiling, and does not invent one', async () => {
    await renderWith('super', {
      authority: 'super',
      perRefundCapCents: null,
      windowCapCents: null,
      windowCents: 0,
      windowCount: 0,
    })
    expect(screen.getByText(/can refund any amount/)).toBeTruthy()
    expect(screen.queryByText(/rolling 24 hours/)).toBeNull()
  })

  it('says so when the remaining allowance could not be read', async () => {
    // Never rendered as a FULL allowance — that would produce exactly the
    // refused-after-filling-in-the-form experience the card exists to avoid.
    await renderWith('support', { ...capped, windowCents: null })
    expect(
      screen.getByText(/remaining 24-hour allowance could not be read/),
    ).toBeTruthy()
  })
})
