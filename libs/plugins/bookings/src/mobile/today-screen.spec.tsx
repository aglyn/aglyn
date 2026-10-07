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
import { fireEvent, render, screen } from '@testing-library/react-native'
import { firestoreDouble as double } from '../../../commerce/src/mobile/testing/firestore-double'
import BookingsTodayScreen from './today-screen'

jest.mock('firebase/firestore', () =>
  require('../../../commerce/src/mobile/testing/firestore-double').firestoreDouble.module,
)

const now = Date.now()

function reader(connected = true): MobileCardReader {
  return {
    state: { connected, kind: 'bluetooth', label: 'Stripe Reader M2', busy: false, testMode: true, prompt: null },
    collect: jest.fn(async () => ({ status: 'collected' as const, paymentIntentId: 'pi_1', amountCents: 5400, tipCents: 0 })),
    cancel: jest.fn(),
    manage: jest.fn(),
  }
}

function context(api: any, cardReader: MobileCardReader | null): MobilePluginContext {
  return {
    uid: 'u1',
    orgId: 'o1',
    hostId: 'h1',
    orgSlug: 'acme',
    hostSlug: 'shop',
    firestore: double.db,
    api,
    navigate: jest.fn(),
    openConsolePath: jest.fn(),
    cardReader,
    online: true,
  }
}

async function renderToday(ctx: MobilePluginContext) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(
    <QueryClientProvider client={client}>
      <BookingsTodayScreen params={{}} context={ctx} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  double.reset()
  double.setCollection('hosts/h1/bookings', [
    { id: 'b1', data: { serviceId: 's1', serviceName: 'Haircut', name: 'Ada', startsAtMs: now, endsAtMs: now + 3_600_000, status: 'confirmed' } },
    { id: 'b2', data: { serviceId: 's1', serviceName: 'Haircut', name: 'Bo', startsAtMs: now, status: 'confirmed', paidAmountCents: 5000 } },
  ])
  double.setDoc('hosts/h1/services/s1', { priceUsd: 50, priceDisplay: 'fixed' })
})

describe('the counter bookings (AGL-3618)', () => {
  it('charges a booking on the device’s reader through the bookings route', async () => {
    const calls: any[] = []
    const api = {
      request: jest.fn(async (path: string, init: any) => {
        calls.push({ path, init })
        if (init.body.action === 'start') {
          return { paymentIntentId: 'pi_1', clientSecret: 'pi_1_secret_x', amountCents: 5400, serviceCents: 5000, taxCents: 400 }
        }
        return { status: 'paid', amountCents: 5400 }
      }),
    }
    const device = reader()
    await renderToday(context(api, device))
    expect(await screen.findByText(/Bo$/)).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('booking-b1'))
    await fireEvent.press(await screen.findByTestId('booking-charge-card'))
    expect(await screen.findByTestId('booking-result')).toHaveTextContent(/Paid \$54\.00/)
    expect(calls.map((call) => [call.path, call.init.body.action])).toEqual([
      ['/api/bookings/in-person-payment', 'start'],
      ['/api/bookings/in-person-payment', 'settle'],
    ])
    expect(calls[0].init.body.amountCents).toBe(5000)
    expect(calls[0].init.idempotencyKey).toMatch(/^booking-pos:/)
    expect(device.collect).toHaveBeenCalledWith({ paymentIntentId: 'pi_1', clientSecret: 'pi_1_secret_x', amountCents: 5400 })
  })

  it('opens reader setup instead of charging with no reader connected', async () => {
    const api = { request: jest.fn() }
    const device = reader(false)
    await renderToday(context(api, device))
    await fireEvent.press(await screen.findByTestId('booking-b1'))
    await fireEvent.press(await screen.findByTestId('booking-charge-card'))
    expect(device.manage).toHaveBeenCalled()
    expect(api.request).not.toHaveBeenCalled()
  })
})
