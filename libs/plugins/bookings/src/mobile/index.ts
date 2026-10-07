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
 * Bookings' mobile entry (`@aglyn/plugins-bookings/mobile`), reached only
 * through the generated mobile manifests and never re-exported from a web
 * entry (check-mobile-isolation).
 *
 * `registerBookingsPosMobile` is Aglyn POS's registrar (AGL-3618), named by
 * the plugin's `mobile.pos` block: today's bookings at the counter, each paid
 * in person on the device's card reader.
 */

import { registerMobileScreen, registerMobileTab } from '@aglyn/mobile-plugin-host'

export const BOOKINGS_POS_TODAY_SCREEN = 'bookings.pos.today'

export function registerBookingsPosMobile(): void {
  registerMobileScreen({
    pluginId: 'bookings',
    id: BOOKINGS_POS_TODAY_SCREEN,
    title: 'Bookings',
    requiresSite: true,
    load: () => import('./today-screen'),
  })
  registerMobileTab({
    pluginId: 'bookings',
    id: BOOKINGS_POS_TODAY_SCREEN,
    title: 'Bookings',
    icon: 'calendar-outline',
    screen: BOOKINGS_POS_TODAY_SCREEN,
    order: 20,
  })
}
