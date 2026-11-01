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

import { fireEvent, render, screen } from '@testing-library/react'

/**
 * What the buyer reads before paying (AGL-4049): the money first, and exactly
 * one way forward, or a plain line about who can take it.
 */

jest.mock('@aglyn/shared-ui-jsx/stripe/lazy-stripe', () => ({
  LazyBillingCardForm: (props: { clientSecret: string }) => <div>{`card form ${props.clientSecret}`}</div>,
  LazyBillingAddressForm: () => <div>{'address form'}</div>,
}))

import { MarketplacePayPanel, type MarketplacePayPanelProps, type PayStep } from './marketplace-pay-panel.component'

const QUOTE = {
  listingName: 'Studio North',
  amountCents: 1200,
  taxCents: 79,
  totalCents: 1279,
  card: { type: 'card', brand: 'visa', last4: '4242' },
  canPay: true,
}

function panel(step: PayStep, over: Partial<MarketplacePayPanelProps> = {}) {
  const props: MarketplacePayPanelProps = {
    step,
    listingName: 'Studio North',
    busy: false,
    error: null,
    billingHref: '/acme/billing',
    onPay: jest.fn(),
    onCardSaved: jest.fn(),
    onAddressSaved: jest.fn(),
    onCancel: jest.fn(),
    ...over,
  }
  render(<MarketplacePayPanel {...props} />)
  return props
}

describe('someone who can pay', () => {
  it('shows the price, the tax, the total and the card, with Pay and Cancel', () => {
    const props = panel({ kind: 'confirm', quote: QUOTE })
    for (const line of ['Buy Studio North', '$12.00', '$0.79', '$12.79']) {
      expect(screen.getByText(line)).toBeTruthy()
    }
    expect(screen.getByText(/Charged to VISA •••• 4242/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $12.79' }))
    expect(props.onPay).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('cannot press Pay twice while it is paying', () => {
    panel({ kind: 'confirm', quote: QUOTE }, { busy: true })
    expect((screen.getByRole('button', { name: 'Paying…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says why the last attempt did not go through, beside the way to change the card', () => {
    panel({ kind: 'confirm', quote: QUOTE }, { error: 'Your card was declined.' })
    expect(screen.getByRole('alert').textContent).toContain('Your card was declined.')
    expect(screen.getByRole('button', { name: 'Open Billing' }).getAttribute('href')).toBe('/acme/billing')
    expect(screen.getByRole('button', { name: 'Pay $12.79' })).toBeTruthy()
  })
})

describe('someone who may see the price but not charge the card', () => {
  const step: PayStep = { kind: 'confirm', quote: { ...QUOTE, canPay: false, card: null } }

  it('keeps the money on screen', () => {
    panel(step)
    for (const line of ['$12.00', '$0.79', '$12.79']) expect(screen.getByText(line)).toBeTruthy()
  })

  it('offers no Pay button and names no card', () => {
    panel(step)
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull()
    expect(screen.queryByText(/Charged to/)).toBeNull()
  })

  it('says who can buy it, in words, naming the permission, with no link they could not use', () => {
    const props = panel(step)
    const notice = screen.getByRole('alert')
    expect(notice.textContent).toContain('Ask someone who manages billing to buy it.')
    expect(notice.textContent).toContain('"Manage billing"')
    expect(screen.queryByRole('button', { name: 'Open Billing' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('what stands in the way', () => {
  it('keeps the price beside a card this person cannot add', () => {
    panel({ kind: 'ask-billing', need: 'card_required', amountCents: 1200 })
    expect(screen.getByText('$12.00')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('needs a card on file')
    expect(screen.getByRole('alert').textContent).toContain('"Manage billing"')
  })

  it('says it is an address when it is', () => {
    panel({ kind: 'ask-billing', need: 'billing_address_required', amountCents: null })
    expect(screen.getByRole('alert').textContent).toContain('needs a billing address')
  })

  it('waits for the secret before it draws the card form', async () => {
    panel({ kind: 'card', clientSecret: null })
    expect(screen.getByText('Add a card to buy Studio North')).toBeTruthy()
    expect(screen.queryByText(/card form/)).toBeNull()
  })

  it('draws the card form with its secret, and the address form', async () => {
    panel({ kind: 'card', clientSecret: 'seti_secret' })
    expect(await screen.findByText('card form seti_secret')).toBeTruthy()
    panel({ kind: 'address' })
    expect(await screen.findByText('address form')).toBeTruthy()
  })
})
