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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { POS_DISPLAY_TOKEN_HEADER, POS_DISPLAY_TOKEN_KEY } from './pos-display/pos-display-api'
import { PosHardwareTermsPage, posHardwareTermsNavigation, POS_HARDWARE_TERMS_DONE_MS } from './pos-hardware-terms-page.component'
import { PosHardwareTermsSignPage } from './pos-hardware-terms-sign-page.component'
import { posHardwareTermsAddress } from '../../model/pos-hardware-terms'

const calls: Array<{ body: Record<string, unknown>; token: string | null }> = []
let answers: Record<string, { status: number; body: unknown }> = {}

beforeEach(() => {
  calls.length = 0
  window.localStorage.setItem(POS_DISPLAY_TOKEN_KEY, 'display-token')
  answers = {
    'hardware-terms': {
      status: 200,
      body: {
        version: 'v20',
        sections: '4.26–4.32',
        url: 'https://example.com/legal/terms',
        summary: ['We are the seller of this hardware.'],
        items: ['1 × Stripe Reader S710'],
        acceptance: null,
      },
    },
    'accept-hardware-terms': { status: 200, body: { ok: true } },
  }
  ;(global as any).fetch = jest.fn(async (_url: string, init: any) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    calls.push({ body, token: init?.headers?.[POS_DISPLAY_TOKEN_HEADER] ?? null })
    const answer = answers[String(body.action)] ?? { status: 404, body: {} }
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body }
  })
  window.history.pushState({}, '', '/kiosk/commerce/hardware-terms?order=sale-1&return=%2Fkiosk%2Fcommerce%2Fpos-display')
})

describe('the terms of sale on the customer display (AGL-4038)', () => {
  it('shows the sale and the summary, accepts with the box ticked, and goes back to the register', async () => {
    jest.useFakeTimers()
    const leave = jest.spyOn(posHardwareTermsNavigation, 'leave').mockImplementation(() => undefined)
    try {
      render(<PosHardwareTermsPage pluginId="commerce" path="/hardware-terms" />)
      expect(await screen.findByText('We are the seller of this hardware.')).toBeTruthy()
      expect(screen.getByText('1 × Stripe Reader S710')).toBeTruthy()
      expect(calls[0]).toEqual({ body: { action: 'hardware-terms', order: 'sale-1' }, token: 'display-token' })
      const accept = screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement
      expect(accept.disabled).toBe(true)
      fireEvent.click(screen.getByRole('checkbox'))
      await act(async () => {
        fireEvent.click(accept)
      })
      expect(calls[1]?.body).toEqual({ action: 'accept-hardware-terms', order: 'sale-1', accept: true })
      expect(screen.getByText('Thank you')).toBeTruthy()
      act(() => {
        jest.advanceTimersByTime(POS_HARDWARE_TERMS_DONE_MS)
      })
      expect(leave).toHaveBeenCalledWith('/kiosk/commerce/pos-display')
    } finally {
      leave.mockRestore()
      jest.useRealTimers()
    }
  })

  it('goes straight back when the register moved on', async () => {
    answers['hardware-terms'] = { status: 409, body: { error: 'That screen has moved on.' } }
    const leave = jest.spyOn(posHardwareTermsNavigation, 'leave').mockImplementation(() => undefined)
    render(<PosHardwareTermsPage pluginId="commerce" path="/hardware-terms" />)
    await waitFor(() => expect(leave).toHaveBeenCalledWith('/kiosk/commerce/pos-display'))
    leave.mockRestore()
  })
})

describe('the booth sign (AGL-4038)', () => {
  it('states the terms the sale is made under, where they are, and that paying is agreeing', () => {
    render(<PosHardwareTermsSignPage pluginId="commerce" path="/hardware-terms-sign" />)
    expect(screen.getByText(new RegExp(`${posHardwareTermsAddress().replace(/[.]/g, '\\.')}, Sections 4\\.26–4\\.32`))).toBeTruthy()
    expect(screen.getByText(/By paying for card reader hardware here, you agree to those terms/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
  })
})
