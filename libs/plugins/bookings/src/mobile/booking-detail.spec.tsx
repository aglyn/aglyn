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
jest.mock('firebase/firestore', () => require('./testing/firestore-double').firestoreDouble.module)
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
jest.mock('@expo/vector-icons/Ionicons', () => () => null)
jest.mock('@aglyn/mobile-ui', () => ({
  ...jest.requireActual('@aglyn/mobile-ui'),
  Screen: ({ children }: { children: unknown }) => children,
}))

import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import BookingScreen from './booking-detail'
import { formatDay } from './data/calendar'
import { createApiDouble, firestoreDouble as double } from './testing/firestore-double'
import { pluginContext, renderScreen } from './testing/render.spec-helpers'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
// A Monday well ahead of now, so the booking is upcoming and its service open.
const monday = (() => {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const ahead = new Date(start.getTime() + 2 * DAY)
  return ahead.getTime() + ((8 - ahead.getUTCDay()) % 7) * DAY
})()

const SERVICE = { name: 'Haircut', durationMinutes: 60, timezone: 'UTC', windows: { 1: [{ start: 9 * 60, end: 13 * 60 }] } }

function seed(booking: Record<string, unknown>) {
  double.reset()
  double.setDoc('hosts/h1', { timeZone: 'UTC' })
  double.setCollection('hosts/h1/services', [{ id: 's1', data: SERVICE }])
  double.setCollection('hosts/h1/bookings', [{ id: 'b1', data: booking }])
  double.setDoc('hosts/h1/bookings/b1', booking)
}

const booking = (extra: Record<string, unknown> = {}) => ({
  serviceId: 's1',
  serviceName: 'Haircut',
  name: 'Alex',
  email: 'alex@example.com',
  status: 'confirmed',
  timezone: 'UTC',
  startsAtMs: monday + 10 * HOUR,
  endsAtMs: monday + 11 * HOUR,
  ...extra,
})

/** Answers every confirm with its last button, as a person tapping "yes". */
function answerYes() {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    buttons?.[buttons.length - 1]?.onPress?.()
  })
}

describe('a booking’s detail (AGL-3621)', () => {
  afterEach(() => jest.restoreAllMocks())

  it('checks the guest in through the member route', async () => {
    seed(booking())
    const api = createApiDouble()
    await renderScreen(<BookingScreen context={pluginContext(api.client)} params={{ bookingId: 'b1' }} />)
    await fireEvent.press(await screen.findByTestId('booking-check-in'))
    await waitFor(() =>
      expect(api.calls).toEqual([
        { path: '/api/bookings/check-in', init: { method: 'POST', body: { hostId: 'h1', bookingId: 'b1', checkedIn: true } } },
      ]),
    )
  })

  it('offers only the undo once the guest is in', async () => {
    seed(booking({ checkedInAtMs: monday + 10 * HOUR }))
    await renderScreen(<BookingScreen context={pluginContext(createApiDouble().client)} params={{ bookingId: 'b1' }} />)
    expect(await screen.findByTestId('booking-undo-check-in')).toBeTruthy()
    expect(screen.getByTestId('booking-checked-in')).toBeTruthy()
    expect(screen.queryByTestId('booking-check-in')).toBeNull()
    expect(screen.queryByTestId('booking-move')).toBeNull()
    expect(screen.queryByTestId('booking-cancel')).toBeNull()
  })

  it('cancels a paid booking through the refund route after asking, naming the amount', async () => {
    seed(booking({ paidAmountCents: 4500 }))
    const api = createApiDouble()
    const alert = answerYes()
    await renderScreen(<BookingScreen context={pluginContext(api.client)} params={{ bookingId: 'b1' }} />)
    const cancel = await screen.findByTestId('booking-cancel')
    expect(screen.getByText('Cancel and refund')).toBeTruthy()
    await fireEvent.press(cancel)
    await waitFor(() => expect(api.calls.map((call) => call.path)).toEqual(['/api/bookings/refund']))
    expect(api.calls[0].init.idempotencyKey).toMatch(/^booking-cancel:/)
    expect(alert.mock.calls[0][1]).toContain('$45.00')
    expect(double.writes).toEqual([])
  })

  it('moves a booking to an open time the service offers', async () => {
    seed(booking())
    const api = createApiDouble(() => ({ ok: true, startsAtMs: monday + 12 * HOUR, endsAtMs: monday + 13 * HOUR, notified: true }))
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    await renderScreen(<BookingScreen context={pluginContext(api.client)} params={{ bookingId: 'b1' }} />)
    await fireEvent.press(await screen.findByTestId('booking-move'))
    await fireEvent.press(await screen.findByTestId(`reschedule-day-${formatDay(monday, 'UTC')}`))
    const slot = await screen.findByTestId(`slot-${monday + 12 * HOUR}`)
    await fireEvent.press(slot)
    await fireEvent.press(screen.getByTestId('reschedule-confirm'))
    await waitFor(() =>
      expect(api.calls).toEqual([
        { path: '/api/bookings/reschedule', init: { method: 'POST', body: { hostId: 'h1', bookingId: 'b1', startsAtMs: monday + 12 * HOUR } } },
      ]),
    )
  })

  it('says so when the booking is gone', async () => {
    double.reset()
    await renderScreen(<BookingScreen context={pluginContext(createApiDouble().client)} params={{ bookingId: 'nope' }} />)
    expect(await screen.findByText('This booking is gone')).toBeTruthy()
  })
})
