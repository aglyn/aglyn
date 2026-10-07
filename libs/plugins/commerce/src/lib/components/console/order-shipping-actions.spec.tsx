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
 * The orders card's shipping header actions (AGL-3613).
 *
 * - Export for shipping opens the export dialog on the chosen preset and the
 *   orders still to ship, after asking the server to stamp the open orders;
 *   Import tracking opens the import wizard on the tracking resource. Each
 *   shows only when the launcher admits the person.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'

const mockFetch = jest.fn()
const mockLauncher = {
  openExport: jest.fn(),
  openImport: jest.fn(),
  close: jest.fn(),
  can: jest.fn((_action: string, _target: unknown) => true),
}
let mockHasLauncher = true

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-admin' } }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/transfer-launcher-context', () => ({
  useTransferLauncher: () => (mockHasLauncher ? mockLauncher : null),
}))

import { OrderShippingActions, ORDERS_TO_SHIP_FILTER } from './order-shipping-actions.component'

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  mockFetch.mockReset()
  mockLauncher.openExport.mockReset()
  mockLauncher.openImport.mockReset()
  mockLauncher.can.mockReset()
  mockLauncher.can.mockImplementation(() => true)
  mockHasLauncher = true
})

describe('orders card shipping actions', () => {
  it('opens the export on the chosen preset and the orders still to ship, after stamping open orders', async () => {
    mockFetch.mockResolvedValueOnce(json(200, { ok: true, stamped: 0 }))
    render(<OrderShippingActions hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Export for shipping' }))
    await act(async () => {
      fireEvent.click(screen.getByText('Pirate Ship'))
    })
    const posted = mockFetch.mock.calls.find((entry) => entry[2]?.method === 'POST')
    expect(posted?.[1]).toBe('/api/commerce/orders-shipping-prepare')
    expect(JSON.parse(posted?.[2].body)).toEqual({ hostId: 'host-1' })
    expect(mockLauncher.openExport).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'commerce.orders',
        hostId: 'host-1',
        preset: 'pirate-ship',
        filter: { label: ORDERS_TO_SHIP_FILTER.label, value: ORDERS_TO_SHIP_FILTER.value },
      }),
    )
  })

  it('still opens the export when the stamp fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'))
    render(<OrderShippingActions hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Export for shipping' }))
    await act(async () => {
      fireEvent.click(screen.getByText('EasyPost'))
    })
    expect(mockLauncher.openExport).toHaveBeenCalledWith(expect.objectContaining({ preset: 'easypost' }))
  })

  it('opens the tracking import', () => {
    render(<OrderShippingActions hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Import tracking' }))
    expect(mockLauncher.openImport).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'commerce.tracking', scope: 'host', hostId: 'host-1' }),
    )
  })

  it('shows only what the launcher admits, and nothing off the console shell', () => {
    mockLauncher.can.mockImplementation((action: string) => action === 'export')
    const { unmount } = render(<OrderShippingActions hostId="host-1" />)
    expect(screen.queryByRole('button', { name: 'Import tracking' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Export for shipping' })).toBeTruthy()
    unmount()
    mockHasLauncher = false
    const { container } = render(<OrderShippingActions hostId="host-1" />)
    expect(container.textContent).toBe('')
  })
})
