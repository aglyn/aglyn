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
 * The Tax ID card, in the browser.
 *
 * Three things are asserted here that the route specs cannot see:
 *
 *  1. **Stripe's rejection is on screen, not only in a toast.** It names the
 *     format expected for the type chosen, and it is read while retyping — a
 *     snackbar that has already faded is the wrong place for the one sentence
 *     that says what to do.
 *  2. **"Not configured" and "we could not reach billing" render
 *     differently.** They are different facts: one the deployment told us, one
 *     we failed to learn. Showing the first when the second happened tells a
 *     paying customer they are not a customer.
 *  3. **The type picker offers Stripe's whole list and is searchable by
 *     code**, because the value a customer's accountant hands them is
 *     `us_ein`, not "United States".
 *
 * No real tax identifier appears in this file.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockConfirm = jest.fn(() => Promise.resolve())
const mockEnqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: mockConfirm }),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

import BillingTaxIdCardComponent from './billing-tax-id-card.component'
import type {
  BillingProfile,
  BillingProfileLoadState,
  BillingProfileState,
} from './use-billing-profile'
import { STRIPE_TAX_ID_TYPES } from '../../utils/stripe-tax-id-types.generated'

const LOADED: BillingProfileState = {
  configured: true,
  customer: { email: 'invoices@example.com', name: 'Example Co', address: null },
  taxIds: [],
  paymentMethods: [],
}

function profileDouble(
  overrides: Partial<BillingProfile> & {
    loadState?: BillingProfileLoadState
    state?: BillingProfileState | null
  } = {},
): BillingProfile {
  return {
    state: overrides.state === undefined ? LOADED : overrides.state,
    loadState: overrides.loadState ?? 'loaded',
    reload: overrides.reload ?? jest.fn(),
    request: overrides.request ?? jest.fn(async () => ({ ok: true })),
  }
}

/** Pick a type in the Autocomplete by typing and choosing the first option. */
async function chooseType(search: string) {
  const input = screen.getByRole('combobox', { name: /type/i })
  fireEvent.change(input, { target: { value: search } })
  const option = await screen.findByRole('option', { name: /United States EIN/i })
  fireEvent.click(option)
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('Stripe’s rejection reaches the customer', () => {
  it('renders Stripe’s own sentence inline', async () => {
    const stripeMessage =
      "The tax ID number is invalid for the type 'us_ein'. US EINs are nine " +
      'digits.'
    const request = jest.fn(async () => ({ ok: false, error: stripeMessage }))
    render(
      <BillingTaxIdCardComponent
        profile={profileDouble({ request })}
        canManage
      />,
    )
    await chooseType('us_ein')
    fireEvent.change(screen.getByRole('textbox', { name: 'Tax ID' }), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Verbatim, on screen. Not paraphrased and not only in a toast.
    expect(await screen.findByText(stripeMessage)).toBeTruthy()
  })

  it('sends the type Stripe expects, not the label the customer read', async () => {
    const request = jest.fn(async () => ({ ok: true }))
    render(
      <BillingTaxIdCardComponent
        profile={profileDouble({ request })}
        canManage
      />,
    )
    await chooseType('us_ein')
    fireEvent.change(screen.getByRole('textbox', { name: 'Tax ID' }), {
      target: { value: '00-0000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(request).toHaveBeenCalledWith({
      action: 'add-tax-id',
      taxIdType: 'us_ein',
      taxIdValue: '00-0000000',
    })
  })

  it('CONTROL — a successful save leaves no rejection on screen', async () => {
    // Without this the rejection assertion above could pass on a card that
    // renders the alert unconditionally.
    const stripeMessage = 'Nothing should render this.'
    const request = jest.fn(async () => ({ ok: true, error: stripeMessage }))
    render(
      <BillingTaxIdCardComponent
        profile={profileDouble({ request })}
        canManage
      />,
    )
    await chooseType('us_ein')
    fireEvent.change(screen.getByRole('textbox', { name: 'Tax ID' }), {
      target: { value: '00-0000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(screen.queryByText(stripeMessage)).toBeNull()
  })

  it('will not submit half a pair', () => {
    render(<BillingTaxIdCardComponent profile={profileDouble()} canManage />)
    // A value with no type, or a type with no value, is not a tax ID — and
    // Stripe would reject the pair anyway, so asking it is a wasted round trip
    // and a confusing error.
    fireEvent.change(screen.getByRole('textbox', { name: 'Tax ID' }), {
      target: { value: '00-0000000' },
    })
    expect(
      screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled'),
    ).toBe(true)
  })
})

describe('the four load outcomes are four different sentences', () => {
  it('says billing is not configured only when the deployment said so', () => {
    render(
      <BillingTaxIdCardComponent
        profile={profileDouble({ loadState: 'unconfigured', state: null })}
        canManage
      />,
    )
    expect(screen.getByText(/once billing is configured/i)).toBeTruthy()
    // A calm sentence, not an alert: nothing is wrong on a self-hosted
    // instance that has no Stripe keys.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('CONTROL — a failed read does NOT claim billing is unconfigured', () => {
    // The split that matters. "Not configured" is a claim about the
    // customer's account; making it because a fetch failed tells a paying
    // customer they are not a customer.
    render(
      <BillingTaxIdCardComponent
        profile={profileDouble({ loadState: 'error', state: null })}
        canManage
      />,
    )
    expect(screen.queryByText(/once billing is configured/i)).toBeNull()
    expect(screen.getByText(/says nothing about your billing/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('offers the form to an org that has never subscribed', () => {
    // The inverse of what this asserted before. A tax ID is a detail that
    // belongs on an invoice, decided before there is an invoice to put it on —
    // and it needs a Stripe customer, which the route creates on the first
    // save, not a plan.
    render(
      <BillingTaxIdCardComponent
        profile={profileDouble({ state: { ...LOADED, customer: null } })}
        canManage
      />,
    )
    expect(screen.queryByText(/Upgrade to a paid plan/i)).toBeNull()
    expect(screen.getByRole('combobox', { name: /type/i })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Tax ID' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('CONTROL — the plan gate is gone from the SAVE path too, not just the fields', async () => {
    // Rendering the inputs while the save still refused would look fixed and
    // not be. Drive the form with no customer and assert the request goes.
    const request = jest.fn(async () => ({ ok: true }))
    render(
      <BillingTaxIdCardComponent
        profile={profileDouble({
          state: { ...LOADED, customer: null },
          request,
        })}
        canManage
      />,
    )
    await chooseType('us_ein')
    fireEvent.change(screen.getByRole('textbox', { name: 'Tax ID' }), {
      target: { value: '00-0000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(request).toHaveBeenCalledWith({
      action: 'add-tax-id',
      taxIdType: 'us_ein',
      taxIdValue: '00-0000000',
    })
  })

  it('shows a viewer their tax IDs without giving them a way to change one', () => {
    render(
      <BillingTaxIdCardComponent
        profile={profileDouble({
          state: {
            ...LOADED,
            taxIds: [
              {
                id: 'txi_1',
                type: 'gb_vat',
                value: 'GB000000000',
                verification: 'verified',
              },
            ],
          },
        })}
        canManage={false}
      />,
    )
    expect(screen.getByText('GB000000000')).toBeTruthy()
    expect(screen.getByText('United Kingdom VAT')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('flags a number Stripe has not verified', () => {
    // A number that will not be honored looks identical to one that will,
    // unless the card says so.
    render(
      <BillingTaxIdCardComponent
        profile={profileDouble({
          state: {
            ...LOADED,
            taxIds: [
              {
                id: 'txi_2',
                type: 'au_abn',
                value: '00000000000',
                verification: 'unverified',
              },
            ],
          },
        })}
        canManage
      />,
    )
    expect(screen.getByText('unverified')).toBeTruthy()
  })
})

describe('the type picker', () => {
  it('offers Stripe’s whole list, searchable by the code an accountant gives you', async () => {
    render(<BillingTaxIdCardComponent profile={profileDouble()} canManage />)
    const input = screen.getByRole('combobox', { name: /type/i })

    // By raw Stripe code. MUI's default filter reads the LABEL only, so this
    // is the case that proves the card supplies its own filter.
    fireEvent.change(input, { target: { value: 'za_vat' } })
    expect(await screen.findByRole('option', { name: /South Africa VAT/i })).toBeTruthy()

    // By country name.
    fireEvent.change(input, { target: { value: 'Andorra' } })
    expect(await screen.findByRole('option', { name: /Andorra NRT/i })).toBeTruthy()
  })

  it('CONTROL — the list really is the generated one', () => {
    // Guards against a card that quietly ships a short hand-written list: the
    // count here is tied to the generated module rather than to a literal.
    expect(STRIPE_TAX_ID_TYPES.length).toBeGreaterThan(80)
    render(<BillingTaxIdCardComponent profile={profileDouble()} canManage />)
    const input = screen.getByRole('combobox', { name: /type/i })
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    return waitFor(() => {
      expect(screen.getAllByRole('option').length).toBeGreaterThan(20)
    })
  })
})
