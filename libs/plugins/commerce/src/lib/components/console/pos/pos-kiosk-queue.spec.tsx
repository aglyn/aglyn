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

/** The register's queue of "pay at counter" kiosk orders (AGL-3623). */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockCalls: any[] = []
jest.mock('./pos-api', () => {
  const actual = jest.requireActual('./pos-api')
  return {
    ...actual,
    posKioskCall: async (_user: unknown, body: any) => {
      mockCalls.push(body)
      if (body.action === 'queue') {
        return {
          currency: 'usd',
          entries: [{ orderId: 'order-1', number: 42, queuedAtMs: 1, totalCents: 972, itemCount: 2 }],
        }
      }
      return {
        sale: { orderId: 'order-1', status: 'pending', totalCents: 972, paidCents: 0, dueCents: 972, tenderableCents: 972, tipCents: 0, payments: [] },
        lines: [{ productId: 'flat-white', name: 'Flat white', unitAmountCents: 450, quantity: 2 }],
      }
    },
  }
})

import { PosKioskQueue } from './pos-kiosk-queue.component'

beforeEach(() => {
  mockCalls.length = 0
})

it('lists queued kiosk orders and loads one into the register', async () => {
  const onTake = jest.fn()
  render(
    <PosKioskQueue
      user={{ uid: 'cashier-1' } as never}
      hostId="host-1"
      registerId="register-1"
      disabled={false}
      onTake={onTake}
      notify={jest.fn()}
    />,
  )
  expect(await screen.findByText('#42')).toBeTruthy()
  expect(screen.getByText('2 items · $9.72')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Take payment' }))
  await waitFor(() => expect(onTake).toHaveBeenCalled())
  expect(onTake.mock.calls[0][0]).toMatchObject({ orderId: 'order-1', dueCents: 972 })
  expect(mockCalls.find((call) => call.action === 'take')).toMatchObject({ registerId: 'register-1', orderId: 'order-1' })
})

it('cannot take a queued order while a sale is open', async () => {
  render(
    <PosKioskQueue
      user={{ uid: 'cashier-1' } as never}
      hostId="host-1"
      registerId="register-1"
      disabled
      onTake={jest.fn()}
      notify={jest.fn()}
    />,
  )
  expect(((await screen.findByRole('button', { name: 'Take payment' })) as HTMLButtonElement).disabled).toBe(true)
})
