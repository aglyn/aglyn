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
 * Shipping settings must say which destinations the merchant's zones leave
 * uncovered (AGL-1791).
 *
 * AGL-1721 made checkout REFUSE a destination no zone covers — the honest
 * outcome, and the merchant never chose it. What makes this a beta-blocking
 * gap rather than a cosmetic one is that the refusal happens on the
 * storefront while the only page that could explain it said nothing, so the
 * first signal a merchant gets is a shopper telling them the store would not
 * take an order.
 *
 * The assertions that matter are the NEGATIVE ones. A coverage line is easy
 * to make appear; the expensive failure is warning a merchant who is fine —
 * a store that ships nothing at all, or one whose rest-of-world zone already
 * reaches everywhere. Each of those is pinned here alongside the warning, and
 * the card is driven through the form (typing a zone, clicking the fix)
 * rather than by handing the component a settings object, so what is checked
 * is what a merchant would see.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import ShippingSettingsCard from './shipping-settings-card.component'

/** Mutable so each spec seeds the listener before rendering. */
const listener: { shipping: unknown } = { shipping: undefined }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({
    data: { shipping: listener.shipping },
    status: 'success',
    fromCache: false,
  }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
}))

/** The card's text, joined, so a claim can be asserted absent as well. */
const cardText = () => document.body.textContent ?? ''

beforeEach(() => {
  jest.clearAllMocks()
  listener.shipping = undefined
})

describe('ShippingSettingsCard coverage (AGL-1791)', () => {
  it('names the destinations checkout turns away, and offers the fix', () => {
    listener.shipping = {
      zones: [{ id: 'us', name: 'Domestic', countries: ['US'] }],
      rates: [
        {
          id: 'std',
          zoneId: 'us',
          name: 'Standard',
          kind: 'flat',
          amountCents: 799,
        },
      ],
    }
    render(<ShippingSettingsCard hostId="host-1" />)

    const warning = screen.getByRole('alert')
    expect(warning.textContent).toContain('turns away 5 of the 6 destinations')
    // The countries by name, not by code: a merchant reading this page is
    // being told which orders they are losing.
    expect(warning.textContent).toContain(
      'Canada, United Kingdom, Australia, Germany, France',
    )
    // A warning with no action is noise, so the one-click fix rides on it.
    expect(
      screen.getByRole('button', { name: 'Add rest-of-world zone' }),
    ).toBeTruthy()
  })

  it('stays quiet for a merchant who ships nowhere', () => {
    // The store that has never configured shipping is NOT misconfigured:
    // `planCheckoutShipping` refuses nobody when no rate resolves anywhere.
    // Warning here would fire on every store selling downloads.
    render(<ShippingSettingsCard hostId="host-1" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(cardText()).toContain('charges no shipping and turns nobody away')
    expect(cardText()).not.toContain('turns away')
  })

  it('stays quiet for a rest-of-world zone that reaches everywhere', () => {
    listener.shipping = {
      zones: [{ id: 'world', name: 'Everywhere', countries: ['*'] }],
      rates: [
        {
          id: 'any',
          zoneId: 'world',
          name: 'Standard',
          kind: 'flat',
          amountCents: 999,
        },
      ],
    }
    render(<ShippingSettingsCard hostId="host-1" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(cardText()).toContain(
      'Checkout can price shipping to every destination',
    )
    // One '*' zone asks the shopper nothing, so the extra-step note is wrong
    // here — and it is the note most likely to be shown unconditionally.
    expect(cardText()).not.toContain('Rates differ by destination')
  })

  it('says when the zones added a checkout step the merchant never chose', () => {
    listener.shipping = {
      zones: [
        { id: 'us', name: 'Domestic', countries: ['US'] },
        { id: 'world', name: 'Everywhere else', countries: ['*'] },
      ],
      rates: [
        {
          id: 'std',
          zoneId: 'us',
          name: 'Standard',
          kind: 'flat',
          amountCents: 799,
        },
        {
          id: 'intl',
          zoneId: 'world',
          name: 'International',
          kind: 'flat',
          amountCents: 2999,
        },
      ],
    }
    render(<ShippingSettingsCard hostId="host-1" />)
    // Nobody is refused, so there is nothing to warn about...
    expect(screen.queryByRole('alert')).toBeNull()
    // ...but every shopper is now asked where the parcel is going.
    expect(cardText()).toContain('Rates differ by destination')
  })

  it('points at the missing rate when a rest-of-world zone is already saved', () => {
    // The gap a merchant is least likely to find: a specific zone with no
    // rates SUPPRESSES the '*' fallback, so naming Europe and pricing nothing
    // on it refuses Europe. Adding another '*' zone would not help, so the
    // card must not offer that button.
    listener.shipping = {
      zones: [
        { id: 'eu', name: 'Europe', countries: ['DE', 'FR'] },
        { id: 'world', name: 'Everywhere else', countries: ['*'] },
      ],
      rates: [
        {
          id: 'any',
          zoneId: 'world',
          name: 'Standard',
          kind: 'flat',
          amountCents: 999,
        },
      ],
    }
    render(<ShippingSettingsCard hostId="host-1" />)
    const warning = screen.getByRole('alert')
    expect(warning.textContent).toContain('Germany, France')
    expect(warning.textContent).toContain('missing is a rate on the zone')
    expect(
      screen.queryByRole('button', { name: 'Add rest-of-world zone' }),
    ).toBeNull()
  })

  it('follows the form as it is typed, before anything is saved', () => {
    // The whole point of computing off `current`: a merchant widening a zone
    // sees the answer move under their hands, not after a round trip.
    listener.shipping = {
      zones: [{ id: 'us', name: 'Domestic', countries: ['US'] }],
      rates: [
        {
          id: 'std',
          zoneId: 'us',
          name: 'Standard',
          kind: 'flat',
          amountCents: 799,
        },
      ],
    }
    render(<ShippingSettingsCard hostId="host-1" />)
    expect(screen.getByRole('alert').textContent).toContain('Canada')

    fireEvent.change(screen.getByLabelText('Countries'), {
      target: { value: 'US, CA, GB, AU, DE, FR' },
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(cardText()).toContain(
      'Checkout can price shipping to every destination',
    )
  })

  it('adds a rest-of-world ZONE only, leaving the price to the merchant', () => {
    listener.shipping = {
      zones: [{ id: 'us', name: 'Domestic', countries: ['US'] }],
      rates: [
        {
          id: 'std',
          zoneId: 'us',
          name: 'Standard',
          kind: 'flat',
          amountCents: 799,
        },
      ],
    }
    render(<ShippingSettingsCard hostId="host-1" />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Add rest-of-world zone' }),
    )

    const zones = screen.getAllByLabelText('Countries') as HTMLInputElement[]
    expect(zones.map((input) => input.value)).toEqual(['US', '*'])
    // A rate defaulted here would post at a price nobody chose, and a blank
    // flat rate resolves to FREE — so the warning correctly persists until
    // the merchant prices the new zone, and the button is gone.
    expect(screen.getByRole('alert').textContent).toContain(
      'missing is a rate on the zone',
    )
    expect(
      screen.queryByRole('button', { name: 'Add rest-of-world zone' }),
    ).toBeNull()
  })
})
