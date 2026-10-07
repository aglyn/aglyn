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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import CustomerNotificationsCard from './customer-notifications-card.component'
import OrderReceiptResend from './order-receipt-resend.component'

/**
 * The console half of AGL-3610: the store's notification switches and
 * "Resend receipt". Both must never offer a text channel the platform cannot
 * send, and the switches must write only their own key.
 */

let channels = { email: true, sms: false }
let storeDoc: Record<string, unknown> = {}
const mockFetch = jest.fn(async (_user: unknown, url: string, init?: RequestInit) => {
  if (!init?.method || init.method === 'GET') {
    return { ok: true, status: 200, json: async () => channels } as unknown as Response
  }
  const sent = { ok: true, channel: JSON.parse(String(init.body)).channel }
  return { ok: true, status: 200, json: async () => sent } as unknown as Response
})
const mockSetDoc = jest.fn(async (..._args: unknown[]) => undefined)
const mockSnack = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (user: unknown, url: string, init?: RequestInit) => mockFetch(user, url, init),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnack }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: (props: { header: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{props.header}</h2>
      {props.children}
    </section>
  ),
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: storeDoc, status: 'success', fromCache: false }),
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 't' } }),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}))

beforeEach(() => {
  channels = { email: true, sms: false }
  storeDoc = {}
  mockFetch.mockClear()
  mockSetDoc.mockClear()
  mockSnack.mockClear()
})

describe('CustomerNotificationsCard', () => {
  it('shows every moment on by default and hides texts when the platform cannot send them', async () => {
    render(<CustomerNotificationsCard hostId="host-1" />)
    for (const label of ['Order receipt', 'Order shipped', 'Order delivered', 'Refund issued', 'Order canceled']) {
      expect((screen.getByRole('switch', { name: new RegExp(label) }) as HTMLInputElement).checked).toBe(true)
    }
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(screen.queryByText('Also send as texts')).toBeNull()
  })

  it('writes only the switched key, merged', async () => {
    storeDoc = { buyerNotifications: { delivered: false } }
    render(<CustomerNotificationsCard hostId="host-1" />)
    expect((screen.getByRole('switch', { name: /Order delivered/ }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('switch', { name: /Order shipped/ }))
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled())
    expect(mockSetDoc).toHaveBeenCalledWith(
      'hosts/host-1/settings/store',
      { buyerNotifications: { shipped: false } },
      { merge: true },
    )
  })

  it('offers texts once the platform can send them', async () => {
    channels = { email: true, sms: true }
    render(<CustomerNotificationsCard hostId="host-1" />)
    expect(await screen.findByText('Also send as texts')).toBeTruthy()
  })
})

describe('OrderReceiptResend', () => {
  const order = { customerEmail: 'buyer@example.com', customerPhone: '+15555550100', status: 'paid' as const }

  it('resends by email to the buyer, with no text option on an install without SMS', async () => {
    render(<OrderReceiptResend hostId="host-1" orderId="order-1" order={order} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend receipt' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false),
    )
    expect(screen.queryByLabelText('Text')).toBeNull()
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('buyer@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(mockSnack).toHaveBeenCalledWith('Receipt sent', expect.anything()))
    const post = mockFetch.mock.calls.find(([, , init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[2]!.body))).toEqual({
      hostId: 'host-1',
      orderId: 'order-1',
      channel: 'email',
      to: 'buyer@example.com',
    })
  })

  it('offers a text to the order’s phone when SMS is configured', async () => {
    channels = { email: true, sms: true }
    render(<OrderReceiptResend hostId="host-1" orderId="order-1" order={order} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend receipt' }))
    fireEvent.click(await screen.findByLabelText('Text'))
    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('+15555550100')
  })

  it('is absent on an unpaid order', () => {
    render(<OrderReceiptResend hostId="host-1" orderId="order-1" order={{ ...order, status: 'pending' }} />)
    expect(screen.queryByRole('button', { name: 'Resend receipt' })).toBeNull()
  })
})
