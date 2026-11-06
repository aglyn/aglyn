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
 * The Hardware card (AGL-4038): drawn not at all while the deployment has
 * not opened the shop, nor to a viewer who may not run the register; with
 * the shop open it offers the priced items, totals the basket, starts
 * Checkout with the basket and the chosen speed, and lists the site's orders
 * with their status and tracking.
 *
 * ANYONE CAN BUY (AGL-4038): a workspace without the point of sale buys
 * like any other, and is prompted to add it, above the shop and, once an
 * order from the card has arrived, naming it. The prompt never switches
 * Check out off; only the buy key does.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

let catalogAnswer: any
let ordersAnswer: any
/** Whether the workspace's plan lacks the point of sale, as the shared lock answers it. */
let posLocked = false
const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = []
const assign = jest.fn()

jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header, HeaderProps }: { children: ReactNode; header: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <section aria-label={String(header)}>
      {HeaderProps?.action}
      {children}
    </section>
  ),
}))
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => ({
  ListTable: ({ rows, columns }: { rows: any[]; columns: any[] }) => (
    <table>
      <tbody>
        {rows.map((row) => (
          <tr key={row.$id} data-testid="order-row">
            {columns.map((column) => (
              <td key={column.field}>
                {column.renderCell
                  ? column.renderCell({ row })
                  : column.valueGetter
                    ? column.valueGetter(undefined, row)
                    : column.valueFormatter
                      ? column.valueFormatter(row[column.field])
                      : String(row[column.field] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: { uid: 'uid-1' } }) }))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url, body, headers: init?.headers ?? {} })
    const answer =
      body?.action === 'catalog'
        ? catalogAnswer
        : body?.action === 'orders'
          ? ordersAnswer
          : body?.action === 'checkout'
            ? { url: 'https://checkout.stripe.com/c/pay/cs_test_1', orderId: 'hw_0123456789abcdef0123' }
            : {}
    return { ok: true, status: 200, json: async () => answer }
  },
}))

jest.mock('./entitlement-gate.component', () => ({
  useCommerceEntitlement: (_hostId: string, feature: string) => ({
    ready: true,
    entitled: feature !== 'pos' || !posLocked,
    locked: feature === 'pos' && posLocked,
    planLabel: 'Pro',
    upgradeHref: '/acme/billing#plans',
  }),
  EntitlementUpsell: ({ children, planLabel, upgradeHref }: { children: ReactNode; planLabel?: string; upgradeHref?: string }) => (
    <div role="note" aria-label="Plan prompt">
      {children}
      {planLabel ? ` Included from ${planLabel}.` : null}
      <a href={upgradeHref}>{'Upgrade'}</a>
    </div>
  ),
}))

jest.mock('./pos/pos-hardware-api', () => ({
  ...jest.requireActual('./pos/pos-hardware-api'),
  openPosHardwareCheckout: (url: string) => assign(url),
}))

import PosHardwareCard from './pos-hardware-card.component'

const OPEN_CATALOG = {
  available: true,
  offers: [
    { sku: 'stripe-reader-s710', kind: 'reader', name: 'Stripe Reader S710', use: 'Handheld for events and parking lots', unitCents: 13_000 },
    { sku: 'stripe-reader-m2', kind: 'reader', name: 'Stripe Reader M2', use: 'Pairs by Bluetooth', unitCents: 7_670 },
  ],
  shipping: [
    { method: 'standard', label: 'Standard shipping', cents: 1_000 },
    { method: 'express', label: 'Express shipping', cents: 2_500 },
  ],
  automaticTax: true,
  shipCountries: ['US'],
}

beforeEach(() => {
  calls.length = 0
  assign.mockClear()
  catalogAnswer = OPEN_CATALOG
  ordersAnswer = { orders: [] }
  posLocked = false
})

/** An order from the card, or bought from the platform's own store, at `status`. */
function hardwareOrder(number: string, status: string, source: 'online' | 'in_person' = 'online') {
  return {
    id: `hw_${number.toLowerCase().replace(/[^a-z0-9]/g, '')}00000000000000`,
    number,
    status,
    source,
    lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 13_000, lineCents: 13_000 }],
    subtotalCents: 13_000,
    shippingCents: 1_000,
    shippingLabel: 'Standard shipping',
    taxCents: 0,
    totalCents: 14_000,
    tracking: null,
    createdAtMs: 1,
    updatedAtMs: 2,
  }
}

/** Ticks the terms of sale and business use (AGL-4038). */
function acceptTerms() {
  fireEvent.click(screen.getByRole('checkbox', { name: /I accept the/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /for use in my business/ }))
}

describe('the Hardware card', () => {
  it('draws nothing while the shop is not open and nothing was bought', async () => {
    catalogAnswer = { available: false }
    const { container } = render(<PosHardwareCard hostId="host-1" canManagePos />)
    await waitFor(() => expect(calls.some((call) => call.body?.action === 'catalog')).toBe(true))
    // The orders are still asked for: a reader bought in person (AGL-4038)
    // is the workspace's purchase history whether or not the shop is open.
    await waitFor(() => expect(calls.some((call) => call.body?.action === 'orders')).toBe(true))
    expect(container.textContent).toBe('')
  })

  it('shows a reader bought in person with the shop closed, and asks for its return with a reason (AGL-4038)', async () => {
    catalogAnswer = { available: false }
    ordersAnswer = {
      orders: [
        {
          id: 'hw_0123456789abcdef0123',
          number: 'HW-012345',
          status: 'registered',
          lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 30_000, lineCents: 30_000 }],
          subtotalCents: 30_000,
          shippingCents: 0,
          shippingLabel: 'Handed over in person',
          taxCents: 2_475,
          totalCents: 32_475,
          tracking: null,
          createdAtMs: 1_000,
          updatedAtMs: 1_000,
          source: 'in_person',
          returnRequest: null,
        },
      ],
    }
    render(<PosHardwareCard hostId="host-1" canManagePos />)
    fireEvent.click(await screen.findByRole('button', { name: 'Request a return' }))
    expect(screen.queryByRole('button', { name: 'Check out' })).toBeNull()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/the return shipping is yours to pay/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Why are you returning it?'), { target: { value: 'Not needed after all' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request return' }))
    await waitFor(() =>
      expect(calls.find((call) => call.body?.action === 'request-return')?.body).toEqual({
        action: 'request-return',
        hostId: 'host-1',
        orderId: 'hw_0123456789abcdef0123',
        reason: 'Not needed after all',
      }),
    )
  })

  it('draws nothing, and asks nothing, for a viewer who may neither run the register nor buy hardware', () => {
    const { container } = render(<PosHardwareCard hostId="host-1" canManagePos={false} />)
    expect(container.textContent).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('opens the shop, the orders and Check out to a member who may buy hardware without the register (AGL-4047)', async () => {
    render(<PosHardwareCard hostId="host-1" canManagePos={false} canBuyHardware />)
    await waitFor(() => expect(screen.getByText('Stripe Reader S710')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('No hardware orders yet.')).toBeTruthy())
    fireEvent.mouseDown(screen.getAllByRole('combobox', { name: /Quantity/ })[0])
    fireEvent.click(within(screen.getByRole('listbox')).getByText('1'))
    acceptTerms()
    fireEvent.click(screen.getByRole('button', { name: 'Check out' }))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(calls.find((call) => call.body?.action === 'checkout')).toBeTruthy()
  })

  it('offers the priced items with an empty order list', async () => {
    render(<PosHardwareCard hostId="host-1" canManagePos />)
    await waitFor(() => expect(screen.getByText('Stripe Reader S710')).toBeTruthy())
    expect(screen.getByText('$130.00')).toBeTruthy()
    expect(screen.getByText('No hardware orders yet.')).toBeTruthy()
    expect(screen.getByText('Calculated at checkout')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Check out' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the shop with Check out disabled and the reason to someone without the buy key (AGL-4047)', async () => {
    render(<PosHardwareCard hostId="host-1" canManagePos canBuyHardware={false} />)
    await waitFor(() => expect(screen.getByText('Stripe Reader S710')).toBeTruthy())
    fireEvent.mouseDown(screen.getAllByRole('combobox', { name: /Quantity/ })[0])
    fireEvent.click(within(screen.getByRole('listbox')).getByText('2'))
    const checkout = screen.getByRole('button', { name: 'Check out' }) as HTMLButtonElement
    expect(checkout.disabled).toBe(true)
    expect(screen.getByLabelText(/Buy point of sale hardware/)).toBeTruthy()
    fireEvent.click(checkout)
    expect(calls.find((call) => call.body?.action === 'checkout')).toBeUndefined()
  })

  it('keeps Check out off, with the reason, until the terms of sale and business use are both ticked (AGL-4038)', async () => {
    render(<PosHardwareCard hostId="host-1" canManagePos />)
    await waitFor(() => expect(screen.getByText('Stripe Reader S710')).toBeTruthy())
    fireEvent.mouseDown(screen.getAllByRole('combobox', { name: /Quantity/ })[0])
    fireEvent.click(within(screen.getByRole('listbox')).getByText('1'))
    const button = () => screen.getByRole('button', { name: 'Check out' }) as HTMLButtonElement
    expect(button().disabled).toBe(true)
    expect(screen.getByLabelText(/Accept the hardware terms of sale/)).toBeTruthy()
    const link = screen.getByRole('link', { name: /hardware terms of sale \(Terms, Sections 4\.26–4\.32\)/ })
    expect(link.getAttribute('href')).toMatch(/\/legal\/terms$/)
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the/ }))
    expect(button().disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /for use in my business/ }))
    expect(button().disabled).toBe(false)
    fireEvent.click(button())
    await waitFor(() => expect(assign).toHaveBeenCalled())
  })

  it('totals the basket and starts Checkout with the basket and speed', async () => {
    render(<PosHardwareCard hostId="host-1" canManagePos />)
    await waitFor(() => expect(screen.getByText('Stripe Reader S710')).toBeTruthy())
    fireEvent.mouseDown(screen.getAllByRole('combobox', { name: /Quantity/ })[0])
    fireEvent.click(within(screen.getByRole('listbox')).getByText('2'))
    const summary = screen.getByLabelText('Order summary')
    await waitFor(() => expect(within(summary).getByText('$260.00')).toBeTruthy())
    expect(within(summary).getByText('$270.00')).toBeTruthy()
    acceptTerms()
    fireEvent.click(screen.getByRole('button', { name: 'Check out' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'))
    const checkout = calls.find((call) => call.body?.action === 'checkout')
    expect(checkout?.body).toEqual({
      action: 'checkout',
      hostId: 'host-1',
      lines: [{ sku: 'stripe-reader-s710', quantity: 2 }],
      shippingMethod: 'standard',
      hardwareTerms: { accepted: true, businessUse: true },
    })
    expect(checkout?.headers['Idempotency-Key']).toBeTruthy()
  })

  it('lists the site’s orders with their status and tracking link', async () => {
    ordersAnswer = {
      orders: [
        {
          id: 'hw_0123456789abcdef0123',
          number: 'HW-012345',
          status: 'shipped',
          lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 13_000, lineCents: 13_000 }],
          subtotalCents: 13_000,
          shippingCents: 1_000,
          shippingLabel: 'Standard shipping',
          taxCents: 0,
          totalCents: 14_000,
          tracking: { carrier: 'UPS', number: '1Z999', url: 'https://www.ups.com/track?tracknum=1Z999' },
          createdAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    }
    render(<PosHardwareCard hostId="host-1" canManagePos />)
    await waitFor(() => expect(screen.getAllByTestId('order-row')).toHaveLength(1))
    const row = screen.getByTestId('order-row')
    expect(within(row).getByText('HW-012345')).toBeTruthy()
    expect(within(row).getByText('Shipped')).toBeTruthy()
    expect(within(row).getByRole('link', { name: '1Z999' }).getAttribute('href')).toBe(
      'https://www.ups.com/track?tracknum=1Z999',
    )
  })

  describe('without the point of sale on the plan (AGL-4038)', () => {
    beforeEach(() => {
      posLocked = true
    })

    it('prompts to add it, naming what it adds, and still checks out', async () => {
      render(<PosHardwareCard hostId="host-1" canManagePos canBuyHardware />)
      await waitFor(() => expect(screen.getByText('Stripe Reader S710')).toBeTruthy())
      const prompt = screen.getByRole('note', { name: 'Plan prompt' })
      expect(prompt.textContent).toContain('You can buy readers on any plan.')
      expect(prompt.textContent).toContain(
        'registers that ring up sales, card payments on your readers, cash with change due, receipts and shift reports',
      )
      expect(prompt.textContent).toContain('Included from Pro.')
      expect(within(prompt).getByRole('link', { name: 'Upgrade' }).getAttribute('href')).toBe('/acme/billing#plans')
      fireEvent.mouseDown(screen.getAllByRole('combobox', { name: /Quantity/ })[0])
      fireEvent.click(within(screen.getByRole('listbox')).getByText('1'))
      acceptTerms()
      const checkout = screen.getByRole('button', { name: 'Check out' }) as HTMLButtonElement
      expect(checkout.disabled).toBe(false)
      fireEvent.click(checkout)
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'))
    })

    it('names an order from the card once it has arrived, and not one bought in person, which the setup card prompts', async () => {
      ordersAnswer = {
        orders: [
          hardwareOrder('HW-AAAAAA', 'delivered'),
          hardwareOrder('HW-BBBBBB', 'shipped'),
          hardwareOrder('HW-CCCCCC', 'delivered', 'in_person'),
        ],
      }
      render(<PosHardwareCard hostId="host-1" canManagePos />)
      await waitFor(() => expect(screen.getAllByTestId('order-row')).toHaveLength(3))
      const prompts = screen.getAllByRole('note', { name: 'Plan prompt' })
      expect(prompts).toHaveLength(1)
      expect(prompts[0].textContent).toContain('HW-AAAAAA has arrived. To take payments with it, add the point of sale:')
      expect(prompts[0].textContent).not.toContain('HW-BBBBBB')
      expect(prompts[0].textContent).not.toContain('HW-CCCCCC')
    })

    it('names an arrived order with the shop closed too', async () => {
      catalogAnswer = { available: false }
      ordersAnswer = { orders: [hardwareOrder('HW-AAAAAA', 'registered'), hardwareOrder('HW-DDDDDD', 'delivered')] }
      render(<PosHardwareCard hostId="host-1" canManagePos />)
      await waitFor(() => expect(screen.getAllByTestId('order-row')).toHaveLength(2))
      expect(screen.getByRole('note', { name: 'Plan prompt' }).textContent).toContain(
        'HW-AAAAAA, HW-DDDDDD have arrived. To take payments with them, add the point of sale:',
      )
    })

    it('still refuses Check out, naming the permission, to someone without the buy key', async () => {
      render(<PosHardwareCard hostId="host-1" canManagePos canBuyHardware={false} />)
      await waitFor(() => expect(screen.getByText('Stripe Reader S710')).toBeTruthy())
      fireEvent.mouseDown(screen.getAllByRole('combobox', { name: /Quantity/ })[0])
      fireEvent.click(within(screen.getByRole('listbox')).getByText('1'))
      acceptTerms()
      const checkout = screen.getByRole('button', { name: 'Check out' }) as HTMLButtonElement
      expect(checkout.disabled).toBe(true)
      expect(screen.getByLabelText(/Buy point of sale hardware/)).toBeTruthy()
      fireEvent.click(checkout)
      expect(calls.find((call) => call.body?.action === 'checkout')).toBeUndefined()
    })
  })

  it('prompts nobody whose plan includes the point of sale', async () => {
    ordersAnswer = { orders: [hardwareOrder('HW-AAAAAA', 'delivered')] }
    render(<PosHardwareCard hostId="host-1" canManagePos />)
    await waitFor(() => expect(screen.getAllByTestId('order-row')).toHaveLength(1))
    expect(screen.queryByRole('note', { name: 'Plan prompt' })).toBeNull()
  })
})
