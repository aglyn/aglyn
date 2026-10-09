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
import type { CourierConnectionView, CourierOrderView, CourierRunView } from '../model/couriers'
import { forgetCourierConnection, type CouriersApi } from './couriers-api'
import { CouriersCard } from './couriers-card.component'
import { OrderCourierWidget, type CourierZoneOrder } from './order-courier-widget.component'
import { QueueCourierButton } from './queue-courier-button.component'

/**
 * The couriers console widgets (AGL-3695), with the API faked: nothing draws
 * where couriers are not offered, the card connects keys, and the order's
 * panel quotes, books under one attempt key and cancels.
 */

jest.mock('./couriers-api', () => ({
  ...jest.requireActual('./couriers-api'),
  useCouriersApi: () => null,
}))
const mockSnack = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))
const mockConfirm = jest.fn(async () => undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

const keysView = (configured: boolean) => ({
  configured,
  developerId: configured ? 'dev-1' : null,
  keyId: configured ? 'key-1' : null,
  lastTestOk: configured,
  lastTestAtMs: configured ? 1 : null,
  lastError: null,
})

const connection = (overrides: Partial<CourierConnectionView> = {}): CourierConnectionView => ({
  provider: 'doordash',
  providerLabel: 'DoorDash',
  live: keysView(true),
  test: keysView(false),
  pickupPhone: null,
  pickupNote: null,
  webhookUrl: 'https://console.example/api/couriers/webhooks/doordash?site=h',
  webhookTokenSet: true,
  updatedAtMs: 1,
  ...overrides,
})

const run = (overrides: Partial<CourierRunView> = {}): CourierRunView => ({
  provider: 'doordash',
  providerLabel: 'DoorDash',
  deliveryRef: 'aglyn-o-1',
  state: 'requested',
  stateLabel: 'Courier requested',
  pending: false,
  trackingUrl: 'https://doordash.com/t/1',
  etaMs: null,
  pickupEtaMs: null,
  feeCents: 975,
  currency: 'usd',
  reason: null,
  testMode: false,
  cancelRequested: false,
  createdAtMs: Date.now(),
  updatedAtMs: Date.now(),
  ...overrides,
})

const empty: CourierOrderView = { orderId: 'o', quote: null, run: null, history: [] }

const PROVIDERS = [{ id: 'doordash' as const, label: 'DoorDash', product: 'DoorDash Drive', portal: 'https://developer.doordash.com/portal' }]

function api(overrides: Partial<CouriersApi> = {}): CouriersApi {
  return {
    connection: jest.fn(async () => ({ available: true, providers: PROVIDERS, connection: connection() })),
    connect: jest.fn(async () => ({ connection: connection(), webhookToken: 'tok-once' })),
    test: jest.fn(async () => connection()),
    settings: jest.fn(async () => connection()),
    webhookToken: jest.fn(async () => ({ connection: connection(), webhookToken: 'tok-new' })),
    disconnect: jest.fn(async () => undefined),
    order: jest.fn(async () => empty),
    quote: jest.fn(async () => ({
      ...empty,
      quote: {
        provider: 'doordash' as const,
        providerLabel: 'DoorDash',
        feeCents: 975,
        currency: 'usd',
        pickupEtaMs: null,
        dropoffEtaMs: null,
        expiresAtMs: Date.now() + 300_000,
        testMode: false,
      },
    })),
    dispatch: jest.fn(async () => ({ ...empty, run: run() })),
    cancel: jest.fn(async () => ({ ...empty, run: run({ state: 'cancelled', stateLabel: 'Canceled' }) })),
    refresh: jest.fn(async () => ({ ...empty, run: run() })),
    ...overrides,
  }
}

const deliveryOrder = (overrides: Partial<CourierZoneOrder> = {}): CourierZoneOrder => ({
  id: 'o',
  number: '#1042',
  status: 'paid',
  testMode: false,
  fulfillmentMethod: 'local_delivery',
  localDelivery: { status: 'scheduled', courier: null },
  ...overrides,
})

beforeEach(() => {
  forgetCourierConnection('h')
  mockSnack.mockClear()
  mockConfirm.mockClear()
})

describe('CouriersCard (AGL-3695)', () => {
  it('draws nothing where couriers are not offered', async () => {
    const fake = api({ connection: jest.fn(async () => ({ available: false, providers: [], connection: null })) })
    const { container } = render(<CouriersCard hostId="h" api={fake} />)
    await waitFor(() => expect(fake.connection).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('connects the keys entered and shows the webhook token once', async () => {
    const fake = api({ connection: jest.fn(async () => ({ available: true, providers: PROVIDERS, connection: null })) })
    render(<CouriersCard hostId="h" api={fake} />)
    const connect = await screen.findByRole('button', { name: 'Connect DoorDash' })
    expect((connect as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText(/doesn’t charge, collect or mark up/)).toHaveLength(1)
    fireEvent.change(screen.getAllByLabelText('Developer ID')[0], { target: { value: 'dev-1' } })
    fireEvent.change(screen.getAllByLabelText('Key ID')[0], { target: { value: 'key-1' } })
    fireEvent.change(screen.getAllByLabelText('Signing secret')[0], { target: { value: 'secret-secret-secret' } })
    fireEvent.click(connect)
    await waitFor(() =>
      expect(fake.connect).toHaveBeenCalledWith('doordash', {
        live: { developerId: 'dev-1', keyId: 'key-1', signingSecret: 'secret-secret-secret' },
      }),
    )
    expect(await screen.findByDisplayValue('tok-once')).toBeTruthy()
    expect(screen.getByDisplayValue('https://console.example/api/couriers/webhooks/doordash?site=h')).toBeTruthy()
  })
})

describe('OrderCourierWidget (AGL-3695)', () => {
  it('draws nothing on a shipped order', async () => {
    const fake = api()
    const { container } = render(
      <OrderCourierWidget hostId="h" order={deliveryOrder({ fulfillmentMethod: 'shipping', localDelivery: null })} api={fake} />,
    )
    expect(container.innerHTML).toBe('')
    expect(fake.connection).not.toHaveBeenCalled()
  })

  it('quotes, then books under one attempt key', async () => {
    const fake = api()
    render(<OrderCourierWidget hostId="h" order={deliveryOrder()} api={fake} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Get a DoorDash quote' }))
    expect(await screen.findByText(/\$9\.75, charged to your DoorDash account/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send courier' }))
    await waitFor(() => expect(fake.dispatch).toHaveBeenCalledWith('o', expect.stringMatching(/^[A-Za-z0-9_-]{8,}$/)))
    expect(await screen.findByText('Courier requested')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Track the courier' }).getAttribute('href')).toBe('https://doordash.com/t/1')
  })

  it('keeps the attempt key after a lost answer, so a retry finds the same booking', async () => {
    const dispatch = jest
      .fn()
      .mockRejectedValueOnce(new Error('DoorDash did not answer'))
      .mockResolvedValueOnce({ ...empty, run: run() })
    const fake = api({ dispatch })
    render(<OrderCourierWidget hostId="h" order={deliveryOrder()} api={fake} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Get a DoorDash quote' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send courier' }))
    expect(await screen.findByText('DoorDash did not answer')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send courier' }))
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
    expect(dispatch.mock.calls[0][1]).toBe(dispatch.mock.calls[1][1])
  })

  it('cancels the courier after confirming', async () => {
    const fake = api({ order: jest.fn(async () => ({ ...empty, run: run({ state: 'assigned', stateLabel: 'Courier on the way to the store' }) })) })
    render(<OrderCourierWidget hostId="h" order={deliveryOrder()} api={fake} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel courier' }))
    await waitFor(() => expect(fake.cancel).toHaveBeenCalledWith('o'))
    expect(mockConfirm).toHaveBeenCalled()
  })

  it('says a test-mode order needs the test key', async () => {
    const fake = api()
    render(<OrderCourierWidget hostId="h" order={deliveryOrder({ testMode: true })} api={fake} />)
    expect(await screen.findByText(/Add your DoorDash test keys/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Get a DoorDash quote' })).toBeNull()
  })
})

describe('QueueCourierButton (AGL-3695)', () => {
  it('offers "Send a courier" on a waiting delivery and opens the panel', async () => {
    const fake = api()
    render(<QueueCourierButton hostId="h" order={deliveryOrder()} api={fake} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send a courier' }))
    expect(await screen.findByText('Courier for #1042')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Get a DoorDash quote' })).toBeTruthy()
  })

  it('links the courier’s tracking while one is on it', async () => {
    const fake = api()
    render(
      <QueueCourierButton
        hostId="h"
        order={deliveryOrder({
          localDelivery: {
            status: 'out_for_delivery',
            courier: { providerLabel: 'DoorDash', state: 'picked_up', trackingUrl: 'https://doordash.com/t/1', etaMs: null },
          },
        })}
        api={fake}
      />,
    )
    expect((await screen.findByRole('link', { name: 'Track DoorDash' })).getAttribute('href')).toBe('https://doordash.com/t/1')
  })

  it('draws nothing on a delivered order', async () => {
    const fake = api()
    const { container } = render(
      <QueueCourierButton hostId="h" order={deliveryOrder({ localDelivery: { status: 'delivered', courier: null } })} api={fake} />,
    )
    await waitFor(() => expect(fake.connection).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
