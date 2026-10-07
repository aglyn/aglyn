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
import {
  registerMobileDashboardWidget,
  registerMobileDeepLink,
  registerMobileQuickAction,
  registerMobileScreen,
  registerMobileTab,
} from '@aglyn/mobile-plugin-host'
import {
  BOOKINGS_BOOKING_SCREEN,
  BOOKINGS_CALENDAR_SCREEN,
  BOOKINGS_CALENDAR_TAB,
  BOOKINGS_PAGE_LINK,
  BOOKINGS_TODAY_ACTION,
  BOOKINGS_TODAY_WIDGET,
} from './screen-ids'

export * from './screen-ids'

/*
 * Bookings in the Aglyn app (AGL-3621): the calendar (day, week, agenda; a
 * split view on tablets), a booking's detail with check-in, move and
 * cancel, today's bookings on the home screen, and the console's Bookings
 * page opening natively from a link or a "new booking" notification.
 */

const pluginId = 'bookings'

export function registerBookingsMobile(): void {
  registerMobileScreen({
    pluginId,
    id: BOOKINGS_CALENDAR_SCREEN,
    title: 'Bookings',
    requiresSite: true,
    load: () => import('./calendar-screen'),
  })
  registerMobileScreen({
    pluginId,
    id: BOOKINGS_BOOKING_SCREEN,
    title: 'Booking',
    requiresSite: true,
    load: () => import('./booking-detail'),
  })
  registerMobileTab({
    pluginId,
    id: BOOKINGS_CALENDAR_TAB,
    title: 'Bookings',
    icon: 'calendar-outline',
    screen: BOOKINGS_CALENDAR_SCREEN,
    order: 120,
  })
  registerMobileDashboardWidget({
    pluginId,
    id: BOOKINGS_TODAY_WIDGET,
    title: 'Bookings today',
    order: 120,
    size: 'half',
    requiresSite: true,
    load: () => import('./today-widget'),
  })
  registerMobileQuickAction({
    pluginId,
    id: BOOKINGS_TODAY_ACTION,
    title: 'Today’s bookings',
    icon: 'calendar-outline',
    order: 130,
    requiresSite: true,
    screen: BOOKINGS_CALENDAR_SCREEN,
    params: { view: 'day' },
  })
  registerMobileDeepLink({ pluginId, id: BOOKINGS_PAGE_LINK, path: '/bookings', screen: BOOKINGS_CALENDAR_SCREEN })
}
