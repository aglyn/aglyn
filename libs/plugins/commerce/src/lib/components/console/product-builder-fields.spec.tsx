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
 * The product editor's builder fields (AGL-4205): the free-mockup switch, a
 * picture and note for each variant's card, and a picture, note and combo
 * contents for each add-on choice.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type * as CommerceModel from '../../model'
import { ProductAddOnsFields, withChoiceCard } from './product-add-ons-fields.component'
import { ProductBuilderFields, withVariantCard } from './product-builder-fields.component'

const VARIANTS: CommerceModel.ProductVariant[] = [
  { id: 'small', options: { Size: '10x10' }, priceUsd: 900, imageUrl: 'https://cdn.example/s.jpg', note: 'Old' },
  { id: 'large', options: { Size: '10x20' }, priceUsd: 1400 },
]

describe('a variant’s card', () => {
  it('sets and clears the picture and note, never storing an empty value', () => {
    const next = withVariantCard(VARIANTS, 'large', { imageUrl: 'https://cdn.example/l.jpg', note: ' Fits a booth ' })
    expect(next[1]).toEqual({ ...VARIANTS[1], imageUrl: 'https://cdn.example/l.jpg', note: 'Fits a booth' })
    expect(next[0]).toBe(VARIANTS[0])
    const cleared = withVariantCard(VARIANTS, 'small', { imageUrl: null, note: '' })
    expect('imageUrl' in cleared[0]).toBe(false)
    expect('note' in cleared[0]).toBe(false)
  })
})

describe('a choice’s card', () => {
  const option: CommerceModel.ProductModifierOption = { id: 'kit', name: 'Weekend kit', priceCents: 19_900 }

  it('reads a combo’s contents one item per line, dropping blank lines', () => {
    expect(withChoiceCard(option, { includes: 'Side wall ×2\n\n  Weights ×4  \n' }).includes).toEqual([
      'Side wall ×2',
      'Weights ×4',
    ])
    expect('includes' in withChoiceCard({ ...option, includes: ['Bag'] }, { includes: ' \n ' })).toBe(false)
  })

  it('sets and clears the picture and note', () => {
    const set = withChoiceCard(option, { imageUrl: 'https://cdn.example/k.jpg', note: 'Windy days' })
    expect(set).toEqual({ ...option, imageUrl: 'https://cdn.example/k.jpg', note: 'Windy days' })
    expect(withChoiceCard(set, { imageUrl: null, note: '' })).toEqual(option)
  })
})

describe('the Product page section', () => {
  it('switches the free mockup on and says what it does', () => {
    const update = jest.fn()
    const { rerender } = render(
      <ProductBuilderFields variants={VARIANTS} mockupRequests={false} update={update} pick={undefined} />,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Offer a free mockup' }))
    expect(update).toHaveBeenCalledWith({ mockupRequests: true })
    rerender(<ProductBuilderFields variants={VARIANTS} mockupRequests update={update} pick={undefined} />)
    expect(screen.getByText(/shows Get a free mockup/)).toBeTruthy()
  })

  it('lists each variant with its picture and note, and saves a note as it is left', () => {
    const update = jest.fn()
    render(<ProductBuilderFields variants={VARIANTS} mockupRequests={false} update={update} pick={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'Change the picture for 10x10' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose the picture for 10x20' })).toBeTruthy()
    const note = screen.getByRole('textbox', { name: 'Note for 10x20' })
    fireEvent.blur(note, { target: { value: 'Fits a booth' } })
    const patch = update.mock.calls[0][0] as (product: CommerceModel.HostProduct) => Partial<CommerceModel.HostProduct>
    expect(patch({ variants: VARIANTS } as CommerceModel.HostProduct).variants?.[1].note).toBe('Fits a booth')
  })

  it('opens a choice’s picture and combo fields from the add-ons editor', () => {
    const update = jest.fn()
    render(
      <ProductAddOnsFields
        modifierGroups={[
          { id: 'g', name: 'Walls', min: 0, max: 1, online: true, options: [{ id: 'kit', name: 'Weekend kit', priceCents: 0 }] },
        ]}
        options={[]}
        variants={[{ id: 'default' }]}
        update={update}
        pick={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Picture & combo' }))
    fireEvent.blur(screen.getByRole('textbox', { name: 'Combo: what it includes' }), {
      target: { value: 'Side wall ×2\nCarry bag' },
    })
    expect(update).toHaveBeenLastCalledWith({
      modifierGroups: [
        {
          id: 'g',
          name: 'Walls',
          min: 0,
          max: 1,
          online: true,
          options: [{ id: 'kit', name: 'Weekend kit', priceCents: 0, includes: ['Side wall ×2', 'Carry bag'] }],
        },
      ],
    })
  })
})
