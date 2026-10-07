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

jest.mock('firebase/firestore', () => require('./testing/firestore-double').firestoreDouble.module)
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
jest.mock('@expo/vector-icons/Ionicons', () => () => null)
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
import CalendarScreen from './calendar-screen'
import { createApiDouble, firestoreDouble as double } from './testing/firestore-double'
import { pluginContext, renderScreen } from './testing/render.spec-helpers'

const HOUR = 60 * 60_000
const today = new Date()
const at = (hour: number) => Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hour)

function seed() {
  double.reset()
  double.setDoc('hosts/h1', { timeZone: 'UTC', subdomain: 'shop' })
  double.setCollection('hosts/h1/services', [
    { id: 's1', data: { name: 'Haircut', durationMinutes: 60 } },
    { id: 's2', data: { name: 'Color', durationMinutes: 90 } },
  ])
  double.setCollection('hosts/h1/bookings', [
    { id: 'b1', data: { serviceId: 's1', serviceName: 'Haircut', name: 'Alex', email: 'a@x.com', status: 'confirmed', startsAtMs: at(9), endsAtMs: at(10) } },
    { id: 'b2', data: { serviceId: 's2', serviceName: 'Color', name: 'Sam', email: 's@x.com', status: 'confirmed', startsAtMs: at(11), endsAtMs: at(12), checkedInAtMs: at(11) } },
  ])
  double.setDoc('hosts/h1/bookings/b1', { serviceId: 's1', serviceName: 'Haircut', name: 'Alex', email: 'a@x.com', status: 'confirmed', startsAtMs: at(9) + 48 * HOUR, endsAtMs: at(10) + 48 * HOUR })
}

describe('the bookings calendar screen (AGL-3621)', () => {
  beforeEach(() => {
    seed()
    mockLayout.split = false
  })

  it('lists the day’s bookings with their state, and a phone opens one as its own screen', async () => {
    const context = pluginContext(createApiDouble().client)
    await renderScreen(<CalendarScreen context={context} params={{}} />)
    expect(await screen.findByText('9:00 AM · Alex')).toBeTruthy()
    expect(screen.getByText('11:00 AM · Sam')).toBeTruthy()
    expect(screen.getByText('Checked in')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('booking-b1'))
    expect(context.navigate).toHaveBeenCalledWith('bookings.booking', { bookingId: 'b1' })
  })

  it('switches to the week and narrows to one service with a query, not a filter over loaded rows', async () => {
    const context = pluginContext(createApiDouble().client)
    await renderScreen(<CalendarScreen context={context} params={{}} />)
    await screen.findByText('9:00 AM · Alex')
    await fireEvent.press(screen.getByTestId('calendar-view-week'))
    await waitFor(() => expect(screen.getAllByText(/No bookings/).length).toBeGreaterThan(0))
    await fireEvent.press(screen.getByTestId('calendar-service-s1'))
    await waitFor(() =>
      expect(double.queries.some((query) => JSON.stringify(query.constraints).includes('"value":"s1"'))).toBe(true),
    )
    expect(screen.getByTestId('calendar-share-link')).toBeTruthy()
  })

  it('opens the booking beside the calendar on a tablet', async () => {
    mockLayout.split = true
    const context = pluginContext(createApiDouble().client)
    await renderScreen(<CalendarScreen context={context} params={{}} />)
    expect(await screen.findByText('Pick a booking to see it here')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('booking-b1'))
    expect(context.navigate).not.toHaveBeenCalled()
    expect(await screen.findByTestId('booking-when')).toBeTruthy()
  })
})
