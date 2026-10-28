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

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { registerCustomerDisplayHost } from '@aglyn/aglyn/plugin-manager/plugin-customer-display'

const mockStatus = jest.fn()
const mockTerms = jest.fn()
const mockOnDisplay = jest.fn()
const mockAccept = jest.fn()
jest.mock('./pos-hardware-sale-api', () => ({
  posHardwareTermsStatus: (...args: unknown[]) => mockStatus(...args),
  posHardwareTerms: (...args: unknown[]) => mockTerms(...args),
  posHardwareTermsOnDisplay: (...args: unknown[]) => mockOnDisplay(...args),
  posHardwareAcceptTerms: (...args: unknown[]) => mockAccept(...args),
}))

import { PosHardwareSaleTerms, POS_HARDWARE_TERMS_POLL_MS, POS_HARDWARE_TERMS_SIGN_HREF } from './pos-hardware-sale-terms.component'

const user = { uid: 'cashier-1' } as never
const TERMS = {
  version: 'v20',
  sections: '4.26–4.32',
  url: 'https://example.com/legal/terms',
  summary: ['We are the seller of this hardware.', 'You may return it within 30 days.'],
}

describe('the terms of sale at the register (AGL-4038)', () => {
  beforeEach(() => {
    for (const mock of [mockStatus, mockTerms, mockOnDisplay, mockAccept]) mock.mockReset()
    mockStatus.mockResolvedValue({ acceptance: null })
    mockTerms.mockResolvedValue(TERMS)
  })

  it('hands the tablet over: the summary, the link, and Accept only once the box is ticked', async () => {
    mockAccept.mockResolvedValue({ ok: true, acceptance: { method: 'tablet', atMs: Date.now(), version: 'v20', sections: '4.26–4.32' } })
    const notify = jest.fn()
    render(<PosHardwareSaleTerms user={user} hostId="host-seller" saleOrderId="sale-1" notify={notify} />)
    // No display here: only the tablet, and the booth sign.
    expect(screen.queryByRole('button', { name: 'Show on display' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Print the booth sign' }).getAttribute('href')).toBe(POS_HARDWARE_TERMS_SIGN_HREF)
    fireEvent.click(screen.getByRole('button', { name: 'Accept on this tablet' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('We are the seller of this hardware.')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'example.com/legal/terms' })).toBeTruthy()
    const accept = within(dialog).getByRole('button', { name: 'Accept' }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(accept)
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith(user, 'host-seller', 'sale-1'))
    expect(await screen.findByText(/Terms of sale accepted on this tablet/)).toBeTruthy()
  })

  it('puts the terms on the paired display through core’s seam and waits for the buyer there', async () => {
    jest.useFakeTimers()
    const show = jest.fn(async () => true)
    const close = jest.fn(async () => true)
    const withdraw = registerCustomerDisplayHost({ show, close })
    mockOnDisplay.mockResolvedValue({ ok: true })
    const notify = jest.fn()
    try {
      render(<PosHardwareSaleTerms user={user} hostId="host-seller" saleOrderId="sale-1" notify={notify} />)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show on display' }))
      })
      expect(mockOnDisplay).toHaveBeenCalledWith(user, 'host-seller', 'sale-1')
      expect(show).toHaveBeenCalledWith({ pluginId: 'commerce', path: '/hardware-terms', params: { order: 'sale-1' } })
      expect(screen.getByText(/Waiting for the buyer/)).toBeTruthy()
      mockStatus.mockResolvedValue({ acceptance: { method: 'display', atMs: Date.now(), version: 'v20', sections: '4.26–4.32' } })
      await act(async () => {
        jest.advanceTimersByTime(POS_HARDWARE_TERMS_POLL_MS)
      })
      await act(async () => undefined)
      expect(notify).toHaveBeenCalledWith('The buyer accepted the terms of sale on the display.', 'success')
      expect(screen.getByText(/accepted on the customer display/)).toBeTruthy()
    } finally {
      withdraw()
      jest.useRealTimers()
    }
  })
})
