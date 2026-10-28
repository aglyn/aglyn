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
import { ProductKioskOfferField } from './product-kiosk-offer-field.component'

/*
 * "Offer on the kiosk" (AGL-4038): every product's own choice of whether the
 * self-service kiosk offers it, and for a product with options, which
 * variants. On by default; nothing about a kind of product.
 */
describe('the Offer on the kiosk choice', () => {
  const variants = [
    { id: 'small', options: { Size: 'Small' } },
    { id: 'large', options: { Size: 'Large' }, offerOnKiosk: false },
  ]

  it('is on for a product the kiosk offers, and turning it off writes `offerOnKiosk: false`', () => {
    const update = jest.fn()
    render(<ProductKioskOfferField offerOnKiosk variants={[{ id: 'default' }]} update={update} />)
    const toggle = screen.getByRole('switch', { name: 'Offer on the kiosk' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    // One variant: nothing to choose between.
    expect(screen.queryByText('Variants the kiosk offers')).toBeNull()
    fireEvent.click(toggle)
    expect(update).toHaveBeenCalledWith({ offerOnKiosk: false })
  })

  it('says, when off, that only the kiosk leaves it out', () => {
    render(<ProductKioskOfferField offerOnKiosk={false} variants={variants} update={jest.fn()} />)
    const toggle = screen.getByRole('switch', { name: 'Offer on the kiosk' }) as HTMLInputElement
    const help = document.getElementById(toggle.getAttribute('aria-describedby') ?? '')
    expect(help?.textContent).toBe('Left off the self-service kiosk. The register, the POS apps and your site still sell it.')
    expect(screen.queryByText('Variants the kiosk offers')).toBeNull()
  })

  it('lets each variant of a product with options be offered or not', () => {
    const update = jest.fn()
    render(<ProductKioskOfferField offerOnKiosk variants={variants} update={update} />)
    const small = screen.getByRole('checkbox', { name: 'Small' }) as HTMLInputElement
    const large = screen.getByRole('checkbox', { name: 'Large' }) as HTMLInputElement
    expect(small.checked).toBe(true)
    expect(large.checked).toBe(false)
    fireEvent.click(large)
    const patch = update.mock.calls[0][0]
    expect(typeof patch).toBe('function')
    expect(patch({ variants: [{ id: 'small', priceUsd: 2 }, { id: 'large', priceUsd: 3, offerOnKiosk: false }] })).toEqual({
      variants: [
        { id: 'small', priceUsd: 2 },
        { id: 'large', priceUsd: 3, offerOnKiosk: true },
      ],
    })
  })
})
