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

import { fireEvent, render, screen, within } from '@testing-library/react'
import { ProductRegisterFields, ProductSellOnlineField } from './product-register-fields.component'

/*
 * The product editor's "Sell online" switch (AGL-4060), beside the register's
 * quick key: on by default, and when off it says where the product still
 * sells and where it no longer shows.
 */
describe('the Sell online switch', () => {
  it('is on for a product that sells online, and turning it off writes `sellOnline: false`', () => {
    const update = jest.fn()
    render(<ProductSellOnlineField sellOnline update={update} />)
    const toggle = screen.getByRole('switch', { name: 'Sell online' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect(update).toHaveBeenCalledWith({ sellOnline: false })
  })

  it('says, when off, that the product sells in person only and has no page online', () => {
    const update = jest.fn()
    render(<ProductSellOnlineField sellOnline={false} update={update} />)
    const toggle = screen.getByRole('switch', { name: 'Sell online' }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    const help = document.getElementById(toggle.getAttribute('aria-describedby') ?? '')
    expect(help?.textContent).toMatch(/^In person only: sold at the register, the kiosk, the \w+ POS apps/)
    fireEvent.click(toggle)
    expect(update).toHaveBeenCalledWith({ sellOnline: true })
  })

  it('sits beside the quick key in the register settings', () => {
    render(<ProductRegisterFields posQuickKey={false} sellOnline update={jest.fn()} />)
    expect(screen.getByRole('switch', { name: 'Quick key at the register' })).toBeTruthy()
    expect((screen.getByRole('switch', { name: 'Sell online' }) as HTMLInputElement).checked).toBe(true)
  })
})

/*
 * "Reviews on your site" (AGL-4060): only for a product sold in person only,
 * shown marked "Sold in store" by default, and hidden when the store chooses.
 */
describe('the Reviews on your site choice', () => {
  it('is not offered while the product sells online, whose reviews are on its own page', () => {
    render(<ProductSellOnlineField sellOnline update={jest.fn()} />)
    expect(screen.queryByLabelText('Reviews on your site')).toBeNull()
  })

  it('shows them, marked Sold in store, by default', () => {
    render(<ProductSellOnlineField sellOnline={false} update={jest.fn()} />)
    const choice = screen.getByRole('combobox', { name: 'Reviews on your site' })
    expect(choice.textContent).toBe('Show, marked Sold in store')
    expect(screen.getByText(/marked “Sold in store”, with no link to a product page/)).toBeTruthy()
  })

  it('writes `inStoreReviews: hide` when the store keeps them off the site, and says what that means', () => {
    const update = jest.fn()
    const { rerender } = render(<ProductSellOnlineField sellOnline={false} update={update} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Reviews on your site' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Hide'))
    expect(update).toHaveBeenCalledWith({ inStoreReviews: 'hide' })
    rerender(<ProductSellOnlineField sellOnline={false} inStoreReviews="hide" update={update} />)
    expect(screen.getByRole('combobox', { name: 'Reviews on your site' }).textContent).toBe('Hide')
    expect(screen.getByText(/appear nowhere on your site/)).toBeTruthy()
  })

  it('reaches the register settings with the product’s own choice', () => {
    render(
      <ProductRegisterFields
        posQuickKey={false}
        sellOnline={false}
        inStoreReviews="hide"
        update={jest.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Reviews on your site' }).textContent).toBe('Hide')
  })
})
