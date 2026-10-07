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
const mockLayout = { split: false }

jest.mock('firebase/firestore', () => require('../testing/firestore-double').firestoreDouble.module)
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
jest.mock('@expo/vector-icons/Ionicons', () => () => null)
jest.mock('expo-print', () => ({ printAsync: jest.fn(async () => undefined) }))
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}))
jest.mock('expo-image-picker', () => ({}))
jest.mock('@aglyn/mobile-core', () => ({ getMobileConfig: () => ({}) }))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ canGoBack: () => false, goBack: jest.fn() }) }))
jest.mock('@aglyn/mobile-ui', () => {
  const actual = jest.requireActual('@aglyn/mobile-ui')
  return {
    ...actual,
    Screen: ({ children }: { children: unknown }) => children,
    useLayout: () => ({ ...actual.layoutFor(mockLayout.split ? 1024 : 390, 800), split: mockLayout.split }),
    SplitView: ({ list, detail }: { list: unknown; detail: unknown }) => {
      const { View } = jest.requireActual('react-native')
      const React = jest.requireActual('react')
      return mockLayout.split
        ? React.createElement(View, { testID: 'split-view' }, list, detail)
        : React.createElement(React.Fragment, null, list)
    },
  }
})

import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { createApiDouble, firestoreDouble as double } from '../testing/firestore-double'
import { pluginContext, renderScreen } from '../testing/render.spec-helpers'
import OrderScreen from './order-detail'
import OrdersScreen from './orders-screen'

const paid = {
  number: 1042,
  status: 'paid',
  channel: 'online',
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  lineItems: [
    { productId: 'p1', name: 'Mug', quantity: 2, unitAmountCents: 1500, productType: 'physical', requiresShipping: true },
  ],
  totals: { itemsCents: 3000, shippingCents: 500, taxCents: 0, discountCents: 0, totalCents: 3500, feeCents: 0 },
  paymentIntentId: 'pi_1',
  createdAtMs: 1_790_000_000_000,
}

function seed() {
  double.reset()
  double.setDoc('hosts/h1/settings/store', { currency: 'USD' })
  double.setCollection('hosts/h1/orders', [
    { id: 'o1', data: paid },
    { id: 'o2', data: { ...paid, number: 1043, customerName: 'Grace Hopper', status: 'fulfilled' } },
  ])
  double.setDoc('hosts/h1/orders/o1', paid)
}

/** Answers every confirm with its last button, as a person tapping "yes". */
const answerYes = () =>
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    buttons?.[buttons.length - 1]?.onPress?.()
  })

describe('the orders screens (AGL-3621)', () => {
  beforeEach(() => {
    seed()
    mockLayout.split = false
  })
  afterEach(() => jest.restoreAllMocks())

  it('lists orders and opens one as its own screen on a phone', async () => {
    const context = pluginContext(createApiDouble().client)
    await renderScreen(<OrdersScreen context={context} params={{}} />)
    expect(await screen.findByText('#1042 · Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('#1043 · Grace Hopper')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('order-o1'))
    expect(context.navigate).toHaveBeenCalledWith('commerce.order', { orderId: 'o1' })
  })

  it('asks Firestore for a status chip, rather than filtering the loaded rows', async () => {
    await renderScreen(<OrdersScreen context={pluginContext(createApiDouble().client)} params={{}} />)
    await screen.findByText('#1042 · Ada Lovelace')
    const before = double.queries.length
    await fireEvent.press(screen.getByTestId('orders-filter-unfulfilled'))
    await waitFor(() => expect(double.queries.length).toBeGreaterThan(before))
    expect(JSON.stringify(double.queries[double.queries.length - 1].constraints)).toContain('where')
  })

  it('shows the order beside the list on a tablet', async () => {
    mockLayout.split = true
    const context = pluginContext(createApiDouble().client)
    await renderScreen(<OrdersScreen context={context} params={{}} />)
    await fireEvent.press(await screen.findByTestId('order-o1'))
    expect(context.navigate).not.toHaveBeenCalled()
    expect(await screen.findByTestId('order-status')).toBeTruthy()
  })

  it('offers what a paid order allows, and refunds through the route under one attempt key', async () => {
    const api = createApiDouble()
    answerYes()
    await renderScreen(<OrderScreen context={pluginContext(api.client)} params={{ orderId: 'o1' }} />)
    expect(await screen.findByTestId('order-fulfill')).toBeTruthy()
    expect(screen.getByText('Order #1042')).toBeTruthy()
    expect(screen.getByTestId('order-print')).toBeTruthy()
    expect(screen.getByTestId('order-share')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('order-refund'))
    await fireEvent.press(await screen.findByTestId('refund-submit'))
    await waitFor(() => expect(api.calls.map((call) => call.path)).toContain('/api/commerce/refund'))
    const refund = api.calls.find((call) => call.path === '/api/commerce/refund')
    expect(refund?.init.body).toEqual({ hostId: 'h1', orderId: 'o1' })
    expect(refund?.init.idempotencyKey).toMatch(/^refund:/)
  })

  it('fulfills through the console route', async () => {
    const api = createApiDouble(() => ({ ok: true }))
    await renderScreen(<OrderScreen context={pluginContext(api.client)} params={{ orderId: 'o1' }} />)
    await fireEvent.press(await screen.findByTestId('order-fulfill'))
    await fireEvent.press(await screen.findByTestId('fulfill-submit'))
    await waitFor(() => expect(api.calls.map((call) => call.path)).toContain('/api/commerce/fulfill-order'))
    const fulfill = api.calls.find((call) => call.path === '/api/commerce/fulfill-order')
    expect(fulfill?.init.body).toMatchObject({ hostId: 'h1', orderId: 'o1', to: 'fulfilled' })
    expect(fulfill?.init.idempotencyKey).toBeTruthy()
  })

  it('prints the receipt', async () => {
    const print = jest.requireMock('expo-print').printAsync as jest.Mock
    await renderScreen(<OrderScreen context={pluginContext(createApiDouble().client)} params={{ orderId: 'o1' }} />)
    await fireEvent.press(await screen.findByTestId('order-print'))
    await waitFor(() => expect(print).toHaveBeenCalled())
    expect(print.mock.calls[0][0].html).toContain('1042')
  })
})
