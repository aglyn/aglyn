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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mockStatus = jest.fn()
jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: { uid: 'staff-1' } }) }))
jest.mock('./pos/pos-hardware-sale-api', () => ({
  posHardwareSaleStatus: (...args: unknown[]) => mockStatus(...args),
}))

import ProductHardwareSkuField from './product-hardware-sku-field.component'

/*
 * The platform's own store's "Point of sale hardware" choice (AGL-4038):
 * drawn only where the server says this store is the hardware seller, and
 * nothing at all anywhere else.
 */
describe('the Point of sale hardware choice', () => {
  beforeEach(() => mockStatus.mockReset())

  it('draws nothing on a store that is not the seller', async () => {
    mockStatus.mockResolvedValue({ seller: false })
    const { container } = render(<ProductHardwareSkuField hostId="host-1" hardwareSku={undefined} update={jest.fn()} />)
    await waitFor(() => expect(mockStatus).toHaveBeenCalledWith({ uid: 'staff-1' }, 'host-1'))
    expect(container.textContent).toBe('')
  })

  it('draws nothing when the store cannot be asked', async () => {
    mockStatus.mockRejectedValue(new Error('Not permitted'))
    const { container } = render(<ProductHardwareSkuField hostId="host-1" hardwareSku={undefined} update={jest.fn()} />)
    await waitFor(() => expect(mockStatus).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('on the seller store, names the item and writes its id', async () => {
    mockStatus.mockResolvedValue({
      seller: true,
      items: [
        { sku: 'stripe-reader-s710', name: 'Stripe Reader S710', kind: 'reader' },
        { sku: 'stripe-reader-m2', name: 'Stripe Reader M2', kind: 'reader' },
      ],
    })
    const update = jest.fn()
    render(<ProductHardwareSkuField hostId="host-seller" hardwareSku="stripe-reader-s710" update={update} />)
    const select = await screen.findByRole('combobox', { name: 'Point of sale hardware' })
    expect(select.textContent).toBe('Stripe Reader S710')
    fireEvent.mouseDown(select)
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Stripe Reader M2'))
    expect(update).toHaveBeenCalledWith({ hardwareSku: 'stripe-reader-m2' })
  })
})
