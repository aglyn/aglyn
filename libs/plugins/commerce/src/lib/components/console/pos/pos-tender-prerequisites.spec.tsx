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

import { render, screen } from '@testing-library/react'
import { PosTenderPanel } from './pos-tender-panel.component'

/**
 * A register on a workspace whose Stripe account cannot charge: every card
 * tender stays on screen, disabled with the reason, and a notice links to the
 * Payments page. Cash, gift cards, store credit and room charges are not card
 * payments and keep working.
 */

let mockPayments: Record<string, unknown> = {}
jest.mock('@aglyn/shared-ui-jsx', () => ({ useConfirmationContext: () => ({ confirm: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx/components/app-link', () => ({
  AppLink: (props: { href: string; children: unknown }) => <a href={props.href}>{props.children as never}</a>,
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({ authorizedFetch: jest.fn() }))
jest.mock('@aglyn/tenant-feature-instance', () => ({ useMerchantPayments: () => mockPayments }))

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

const display = { connected: false, asking: null, show: jest.fn(), ask: jest.fn() }

function panel(props: { offline: boolean; onSellOffline?: () => void; payments?: unknown[] } = { offline: false }) {
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
const REASON = 'Connect Stripe to take card payments.'

it('disables every card tender with the reason and links to Payments when Stripe is not connected', () => {
  mockPayments = {
    state: 'not-connected',
    settled: true,
    ready: false,
    blocked: true,
    reason: REASON,
    href: '/acme/hosts/shop/products/payments',
  }
  panel()
  for (const name of ['Card reader', 'Type card', 'Card (QR)']) {
    expect(button(name).disabled).toBe(true)
    expect(screen.getAllByLabelText(REASON).length).toBeGreaterThan(0)
  }
  for (const name of ['Cash', 'Gift card', 'Rewards', 'Room']) {
    expect(button(name).disabled).toBe(false)
  }
  expect(screen.getByText(/Connect Stripe to take card payments\. Cash, gift cards and store credit work without it\./)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open Payments' }).getAttribute('href')).toBe(
    '/acme/hosts/shop/products/payments',
  )
})

it('says nothing while the answer is still loading', () => {
  mockPayments = { state: 'pending', settled: false, ready: false, blocked: false, reason: null, href: null }
  panel()
  expect(button('Type card').disabled).toBe(false)
  expect(screen.queryByText(/Connect Stripe/)).toBeNull()
})

it('leaves the card tenders alone once Stripe can charge', () => {
  mockPayments = { state: 'ready', settled: true, ready: true, blocked: false, reason: null, href: null }
  panel()
  for (const name of ['Card reader', 'Type card', 'Card (QR)']) {
    expect(button(name).disabled).toBe(false)
  }
  expect(screen.queryByRole('link', { name: 'Open Payments' })).toBeNull()
})
