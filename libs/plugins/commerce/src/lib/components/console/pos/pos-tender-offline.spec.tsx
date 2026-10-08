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

import { fireEvent, render, screen } from '@testing-library/react'
import { PosTenderPanel } from './pos-tender-panel.component'

/**
 * An open sale when the connection drops (AGL-3625): every tender on it is
 * the server's, so the card reader, the typed card, the QR link, the gift
 * card, store credit and the room charge are all off, and a sale that has taken nothing
 * can be rung again as an offline cash sale.
 */

jest.mock('@aglyn/shared-ui-jsx', () => ({ useConfirmationContext: () => ({ confirm: jest.fn() }) }))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({ authorizedFetch: jest.fn() }))

const SALE = {
  orderId: 'o1',
  status: 'pending',
  totalCents: 2592,
  paidCents: 0,
  dueCents: 2592,
  tenderableCents: 2592,
  tipCents: 0,
  payments: [],
}

const CONTEXT = {
  settings: { tippingEnabled: false, tipPercentages: [], receiptDefault: 'ask', displayMessage: '', displayMarketingOptIn: false },
  terminal: { available: true, testMode: true },
  readers: [{ id: 'r1', label: 'Counter', registerId: 'front', status: 'online', livemode: false }],
  publishableKey: 'pk_test_x',
  smsReceipts: false,
  credits: [{ providerId: 'loyalty', label: 'Rewards', lookup: true }],
} as const

const display = { connected: false, asking: null, show: jest.fn(), ask: jest.fn(), pairingCode: jest.fn() }

function panel(props: { offline: boolean; onSellOffline?: () => void; payments?: unknown[] }) {
  return render(
    <PosTenderPanel
      user={{ uid: 'u1' } as never}
      hostId="shop"
      registerId="front"
      sale={{ ...SALE, payments: (props.payments ?? []) as never }}
      context={CONTEXT as never}
      stays={[{ $id: 's1' }]}
      display={display as never}
      onSale={() => undefined}
      onVoided={() => undefined}
      notify={() => undefined}
      offline={props.offline}
      {...(props.onSellOffline ? { onSellOffline: props.onSellOffline } : {})}
    />,
  )
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

it('turns every tender off while offline and offers the basket as an offline cash sale', () => {
  const sellOffline = jest.fn()
  panel({ offline: true, onSellOffline: sellOffline })
  for (const name of ['Cash', 'Card reader', 'Type card', 'Card (QR)', 'Gift card', 'Rewards', 'Room', 'Void sale']) {
    expect(button(name).disabled).toBe(true)
  }
  expect(screen.getByText(/gift cards, store credit and room charges are off/)).toBeTruthy()
  fireEvent.click(button('Sell for cash offline'))
  expect(sellOffline).toHaveBeenCalled()
})

it('does not offer an offline sale once a payment is on the open one', () => {
  panel({
    offline: true,
    onSellOffline: jest.fn(),
    payments: [{ id: 'p1', method: 'cash', amountCents: 500, status: 'succeeded' }],
  })
  expect(screen.queryByRole('button', { name: 'Sell for cash offline' })).toBeNull()
  expect(screen.getByText(/finishes when the connection returns/)).toBeTruthy()
})

it('leaves every tender on while online', () => {
  panel({ offline: false })
  for (const name of ['Cash', 'Card reader', 'Type card', 'Card (QR)', 'Gift card', 'Rewards', 'Room']) {
    expect(button(name).disabled).toBe(false)
  }
  expect(screen.queryByText(/are off/)).toBeNull()
})
