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
 * The product editor's check-in section (AGL-4043): "Needs check-in", the
 * people one item admits, and a per-variant override.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { ProductCheckInFields } from './product-check-in-fields.component'

const VARIANTS = [
  { id: 'adult', options: { Ticket: 'Adult' }, priceUsd: 40 },
  { id: 'spectator', options: { Ticket: 'Spectator' }, priceUsd: 5 },
]

describe('the check-in fields', () => {
  it('turns check-in on for every item, one person each', () => {
    const update = jest.fn()
    render(<ProductCheckInFields checkIn={undefined} variants={VARIANTS} update={update} />)
    fireEvent.click(screen.getByLabelText('Needs check-in'))
    expect(update).toHaveBeenCalledWith({ checkIn: { enabled: true, headcount: 1 } })
  })

  it('takes the people per item, kept to a whole number from 1 to 50', () => {
    const update = jest.fn()
    render(<ProductCheckInFields checkIn={{ enabled: true, headcount: 1 }} variants={VARIANTS} update={update} />)
    const field = screen.getByLabelText('People per item')
    fireEvent.change(field, { target: { value: '4' } })
    expect(update).toHaveBeenLastCalledWith({ checkIn: { enabled: true, headcount: 4 } })
    fireEvent.change(field, { target: { value: '500' } })
    expect(update).toHaveBeenLastCalledWith({ checkIn: { enabled: true, headcount: 50 } })
  })

  it('lets one variant opt out, keeping the others on the product’s setting', () => {
    const update = jest.fn()
    render(<ProductCheckInFields checkIn={{ enabled: true, headcount: 1 }} variants={VARIANTS} update={update} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Spectator' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('No check-in'))
    // Written against the draft as it stands, so a price typed meanwhile survives.
    const patch = update.mock.calls[0][0]
    const draft = { variants: [VARIANTS[0], { ...VARIANTS[1], priceUsd: 6 }] }
    expect(patch(draft)).toEqual({
      variants: [VARIANTS[0], { ...VARIANTS[1], priceUsd: 6, checkIn: { enabled: false } }],
    })
  })

  it('shows no per-variant choice for a product with one variant', () => {
    render(
      <ProductCheckInFields checkIn={{ enabled: true }} variants={[{ id: 'default' }]} update={jest.fn()} />,
    )
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
