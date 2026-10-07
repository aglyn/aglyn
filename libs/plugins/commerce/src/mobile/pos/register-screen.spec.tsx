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

import type { MobileCardReader, MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { firestoreDouble as double } from '../testing/firestore-double'
import PosRegisterScreen from './register-screen'

jest.mock('firebase/firestore', () => require('../testing/firestore-double').firestoreDouble.module)

const BAG = { name: 'Tote bag', status: 'active', deletedAt: null, posQuickKey: true, variants: [{ id: 'default', priceUsd: 12 }] }
const LATTE = {
  name: 'Latte',
  status: 'active',
  deletedAt: null,
  variants: [
    { id: 'v-s', options: { Size: 'Small' }, priceUsd: 3.5 },
    { id: 'v-l', options: { Size: 'Large' }, priceUsd: 4.25 },
  ],
}

function routes() {
  const calls: Array<{ path: string; init: any }> = []
  const api = {
    request: jest.fn(async (path: string, init: any = {}) => {
      calls.push({ path, init })
      if (path === '/api/commerce/pos-payment' && init.query?.action === 'context') {
        return { settings: { tippingEnabled: false, tipPercentages: [] }, terminal: { available: true, testMode: true }, readers: [] }
      }
      if (path === '/api/commerce/pos-order') {
        return { orderId: 'o1', totals: { subtotalCents: 1200, taxCents: 99, totalCents: 1299 }, dueCents: 1299 }
      }
      if (init.body?.action === 'cash') {
        return {
          sale: { orderId: 'o1', status: 'paid', totalCents: 1299, paidCents: 1299, dueCents: 0, tenderableCents: 0, payments: [{ id: 'c1', method: 'cash', amountCents: 1299, status: 'succeeded', changeCents: 701 }] },
          paymentId: 'c1',
          completed: true,
        }
      }
      return { sale: { orderId: 'o1', status: 'paid', payments: [] } }
    }),
  }
  return { api, calls }
}

function contextWith(api: any, overrides: Partial<MobilePluginContext> = {}): MobilePluginContext {
  return {
    uid: 'u1',
    orgId: 'org1',
    hostId: 'h1',
    orgSlug: 'acme',
    hostSlug: 'shop',
    firestore: double.db,
    api,
    navigate: jest.fn(),
    openConsolePath: jest.fn(),
    online: true,
    ...overrides,
  }
}

async function renderRegister(context: MobilePluginContext) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(
    <QueryClientProvider client={client}>
      <PosRegisterScreen params={{}} context={context} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  double.reset()
  double.setCollection('hosts/h1/registers', [{ id: 'r1', data: { name: 'Front counter', locationId: 'loc1' } }])
  double.setCollection('hosts/h1/products', [
    { id: 'p-bag', data: BAG },
    { id: 'p-latte', data: LATTE },
  ])
})

describe('the register (AGL-3618)', () => {
  it('rings an item up, opens the sale on the server and takes cash', async () => {
    const { api, calls } = routes()
    await renderRegister(contextWith(api))
    await fireEvent.press(await screen.findByTestId('grid-all'))
    await fireEvent.press(await screen.findByTestId('pos-item-p-bag'))
    expect(await screen.findByText('1 item')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('cart-bar'))
    await fireEvent.press(screen.getAllByTestId('cart-charge')[0])

    await screen.findByTestId('pos-checkout')
    const open = calls.find((call) => call.path === '/api/commerce/pos-order')!
    expect(open.init.body).toMatchObject({ hostId: 'h1', registerId: 'r1', locationId: 'loc1', payment: 'open', lines: [{ productId: 'p-bag', quantity: 1 }] })
    expect(open.init.idempotencyKey).toMatch(/^pos-open:/)
    expect(screen.getByText('$12.99')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('tender-cash'))
    await fireEvent.press(await screen.findByTestId('cash-2000'))
    expect(await screen.findByTestId('checkout-change')).toHaveTextContent(/Change due: \$7\.01/)
    const cash = calls.find((call) => call.init.body?.action === 'cash')!
    expect(cash.init).toMatchObject({ body: { orderId: 'o1', tenderedCents: 2000, tipCents: 0 } })
    expect(cash.init.idempotencyKey).toMatch(/^pos-app:/)

    await fireEvent.press(screen.getByTestId('receipt-none'))
    expect(await screen.findByTestId('register-toast')).toHaveTextContent(/Sale complete/)
    expect(screen.getByText('No items')).toBeTruthy()
  })

  it('asks for an option before ringing up a product that has them', async () => {
    const { api } = routes()
    await renderRegister(contextWith(api))
    await fireEvent.press(await screen.findByTestId('grid-all'))
    await fireEvent.press(await screen.findByTestId('pos-item-p-latte'))
    expect(await screen.findByTestId('item-sheet')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('variant-v-l'))
    expect(screen.getByTestId('item-add')).toHaveTextContent('Add · $4.25')
    await fireEvent.press(screen.getByTestId('item-add'))
    expect(await screen.findByText('1 item')).toBeTruthy()
  })

  it('shows the merchant’s quick keys first', async () => {
    const { api } = routes()
    await renderRegister(contextWith(api))
    await screen.findByTestId('pos-item-p-bag')
    const quick = double.queries.find((entry) =>
      (entry.constraints as Array<{ path?: unknown }>).some((constraint) => constraint.path === 'posQuickKey'),
    )
    expect(quick?.path).toBe('hosts/h1/products')
  })

  it('holds the charge offline and keeps the basket', async () => {
    const { api, calls } = routes()
    await renderRegister(contextWith(api, { online: false }))
    expect(await screen.findByTestId('register-offline')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('grid-all'))
    await fireEvent.press(await screen.findByTestId('pos-item-p-bag'))
    await fireEvent.press(screen.getByTestId('cart-bar'))
    expect(screen.getAllByTestId('cart-charge')[0]).toBeDisabled()
    expect(calls.some((call) => call.path === '/api/commerce/pos-order')).toBe(false)
  })

  it('pays on the device’s reader and lets the server record it', async () => {
    const { api, calls } = routes()
    api.request.mockImplementation(async (path: string, init: any = {}) => {
      calls.push({ path, init })
      if (init.query?.action === 'context') return { settings: {}, terminal: { available: true, testMode: true }, readers: [] }
      if (path === '/api/commerce/pos-order') return { orderId: 'o1', totals: { totalCents: 1200 }, dueCents: 1200 }
      const payment = { id: 'pay1', method: 'card_present', amountCents: 1200, status: 'pending' }
      if (init.body?.action === 'card-present-sdk') {
        return { sale: { orderId: 'o1', status: 'pending', totalCents: 1200, dueCents: 1200, tenderableCents: 0, payments: [payment] }, paymentId: 'pay1', clientSecret: 'pi_1_secret_x', paymentIntentId: 'pi_1' }
      }
      return {
        sale: { orderId: 'o1', status: 'paid', totalCents: 1200, paidCents: 1200, dueCents: 0, tenderableCents: 0, payments: [{ ...payment, status: 'succeeded' }] },
        paymentId: 'pay1',
        completed: true,
      }
    })
    const reader: MobileCardReader = {
      state: { connected: true, kind: 'tapToPay', label: 'Tap to Pay', busy: false, testMode: true, prompt: null },
      collect: jest.fn(async () => ({ status: 'collected' as const, paymentIntentId: 'pi_1', amountCents: 1200, tipCents: 0 })),
      cancel: jest.fn(),
      manage: jest.fn(),
    }
    await renderRegister(contextWith(api, { cardReader: reader }))
    await fireEvent.press(await screen.findByTestId('grid-all'))
    await fireEvent.press(await screen.findByTestId('pos-item-p-bag'))
    await fireEvent.press(screen.getByTestId('cart-bar'))
    await fireEvent.press(screen.getAllByTestId('cart-charge')[0])
    await fireEvent.press(await screen.findByTestId('tender-device'))
    await waitFor(() => expect(screen.getByTestId('receipt-none')).toBeTruthy())
    expect(reader.collect).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'pi_1', amountCents: 1200 }))
    expect(calls.map((call) => call.init.body?.action).filter(Boolean)).toEqual(['card-present-sdk', 'status'])
  })
})
