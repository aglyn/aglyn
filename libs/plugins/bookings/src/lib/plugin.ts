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

import * as Aglyn from '@aglyn/aglyn'
import { mdiCalendarClock } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { BUNDLE_ID } from './constants/bundle-common'
import { BOOKINGS_CONFIG_SCHEMA } from './plugin-config'

/** Code-split: the Bookings console page only loads when opened. */
const BookingsConsolePage = lazy(
  () => import('./components/bookings-console-page'),
)

/**
 * Console half only: registers the Bookings nav item + page. Safe to call
 * at console app load — the page is lazy (no besigner/canvas code).
 */
export function registerBookingsConsole(): void {
  // Per-plugin settings (AGL-428): the schema powers the generic form on
  // the Plugins & add-ons hub and defaults-merged reads everywhere.
  Aglyn.registerPluginConfigSchema(BOOKINGS_CONFIG_SCHEMA)
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Bookings',
    featureFlag: 'bookings',
    navItems: [
      {
        label: 'Bookings',
        href: '/bookings',
        // Reuse the existing release-flag nav-tab so staff-preview gating is
        // unchanged now that the tab comes from the plugin (AGL-395).
        navTabId: 'nav-tab-bookings',
        icon: { path: mdiCalendarClock.path },
        header: {
          title: 'Bookings',
          icon: { path: mdiCalendarClock.path },
          docsTopic: 'bookings',
        },
        Component: BookingsConsolePage,
      },
    ],
  })
}

export * from './site'
