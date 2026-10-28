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
 * Card readers bought in person, waiting to be set up (AGL-4038): nothing
 * while there are none; otherwise each says what it still needs — the point
 * of sale plan first, then its store, then adding it on the store's POS
 * devices card — and Mark set up finishes one paired without a serial.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockWaiting = jest.fn()
const mockChoose = jest.fn()
const mockMark = jest.fn()

jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <section aria-label={String(header)}>{children}</section>
  ),
}))
jest.mock('@aglyn/shared-ui-jsx/components/blocked-control.component', () => ({
  BlockedControl: ({ children, blocked, reason }: { children: any; blocked: boolean; reason: string }) =>
    blocked ? <span title={reason}>{{ ...children, props: { ...children.props, disabled: true } }}</span> : children,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: { uid: 'uid-pat' } }) }))
jest.mock('./entitlement-gate.component', () => ({
  useCommerceEntitlement: () => ({ ready: true, entitled: false, planLabel: 'Pro', upgradeHref: '/billing' }),
  EntitlementUpsell: ({ children }: { children: ReactNode }) => <div role="note">{children}</div>,
}))
jest.mock('./pos/pos-hardware-api', () => ({
  PosHardwareRequestError: class extends Error {},
  posHardwareWaiting: (...args: unknown[]) => mockWaiting(...args),
  posHardwareChooseStore: (...args: unknown[]) => mockChoose(...args),
  posHardwareMarkSetUp: (...args: unknown[]) => mockMark(...args),
}))

import PosHardwareWaitingCard from './pos-hardware-waiting-card.component'

const ORDER = {
  id: 'hw_aaaaaaaaaaaaaaaaaaaa',
  number: 'HW-AAAAAA',
  status: 'delivered',
  lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 30_000, lineCents: 30_000 }],
  subtotalCents: 30_000,
  shippingCents: 0,
  shippingLabel: 'Handed over in person',
  taxCents: 0,
  totalCents: 30_000,
  tracking: null,
  createdAtMs: Date.UTC(2026, 9, 20),
  updatedAtMs: 0,
  source: 'in_person',
  hostId: '',
  serialsTaken: 0,
}
const STORES = [
  { hostId: 'host-1', name: 'Main Street', hasLocation: true, setupUrl: 'https://console.example.com/s1#pos-devices' },
  { hostId: 'host-2', name: 'Pop-up', hasLocation: false, setupUrl: 'https://console.example.com/s2#pos-devices' },
]

describe('Card readers to set up', () => {
  beforeEach(() => {
    for (const mock of [mockWaiting, mockChoose, mockMark]) mock.mockReset()
  })

  it('draws nothing while no reader waits', async () => {
    mockWaiting.mockResolvedValue({ posPlan: false, stores: [], orders: [] })
    const { container } = render(<PosHardwareWaitingCard hostId="host-1" />)
    await waitFor(() => expect(mockWaiting).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('asks for the point of sale plan first, and holds the store choice until then', async () => {
    mockWaiting.mockResolvedValue({ posPlan: false, stores: STORES, orders: [ORDER] })
    render(<PosHardwareWaitingCard hostId="host-1" />)
    expect(await screen.findByRole('note')).toHaveProperty('textContent', expect.stringMatching(/comes with the point of sale/))
    expect((screen.getByRole('button', { name: 'Choose' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('chooses the store, then sends the reader to its POS devices card, and marks it set up', async () => {
    mockWaiting
      .mockResolvedValueOnce({ posPlan: true, stores: STORES, orders: [ORDER] })
      .mockResolvedValue({ posPlan: true, stores: STORES, orders: [{ ...ORDER, hostId: 'host-2' }] })
    mockChoose.mockResolvedValue({ ok: true })
    mockMark.mockResolvedValue({ ok: true })
    render(<PosHardwareWaitingCard hostId="host-1" />)
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Which store is it for?' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Pop-up'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
    await waitFor(() => expect(mockChoose).toHaveBeenCalledWith({ uid: 'uid-pat' }, 'host-2', ORDER.id))
    const open = await screen.findByRole('link', { name: 'Open POS devices' })
    expect(open.getAttribute('href')).toBe('https://console.example.com/s2#pos-devices')
    expect(screen.getByText(/The first reader asks for the store’s address/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mark set up' }))
    await waitFor(() => expect(mockMark).toHaveBeenCalledWith({ uid: 'uid-pat' }, 'host-2', ORDER.id))
  })
})
