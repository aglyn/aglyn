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
import { mdiFileSign } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import {
  WAIVERS_CHECK_IN_SLOT,
  WAIVERS_CHECK_IN_WIDGET_ID,
  WAIVERS_DISPLAY_PAGE_PATH,
  WAIVERS_PLUGIN_ID,
  WAIVERS_PUBLIC_PAGE_PATH,
} from './constants/bundle-common'
import { WAIVERS_PERMISSION_DECLARATIONS } from './constants/permissions'

/*
 * The console page and the share link's page are code-split: the shell
 * registers the extension at app load for the nav strip, and each page loads
 * only when it is opened.
 */
const WaiversConsolePage = lazy(() => import('./components/waivers-console-page'))
const WaiverPublicPage = lazy(() => import('./components/waiver-public-page.component'))
const WaiverDisplayPage = lazy(() => import('./components/waiver-display-page.component'))
const WaiverCheckInStatus = lazy(() => import('./components/waiver-check-in-status.component'))

/**
 * Console half only (AGL-4042): the Waivers nav item and page, gated by the
 * store's `commerce` entitlement, its two permissions, and the share link's
 * public page at `/kiosk/waivers/sign`, which needs no staff session and
 * reads only what the public route serves, and `/kiosk/waivers/display-sign`,
 * which a register's paired customer display opens through core's customer
 * display seam to sign at the window. It also fills commerce's
 * `posCheckIn` zone, by its id and never by importing commerce, with each
 * customer's waiver status for the day at the register's check-in. Pulls no
 * canvas code.
 */
export function registerWaiversConsole(): void {
  Aglyn.registerPluginPermissions(WAIVERS_PERMISSION_DECLARATIONS)
  Aglyn.registerConsoleExtension({
    pluginId: WAIVERS_PLUGIN_ID,
    displayName: 'Waivers',
    featureFlag: 'commerce',
    publicPages: [
      { path: WAIVERS_PUBLIC_PAGE_PATH, title: 'Sign a waiver', Component: WaiverPublicPage },
      // What a register's customer display opens through core's seam (AGL-4042).
      { path: WAIVERS_DISPLAY_PAGE_PATH, title: 'Sign a waiver', Component: WaiverDisplayPage },
    ],
    widgets: [
      {
        slot: WAIVERS_CHECK_IN_SLOT,
        widgetId: WAIVERS_CHECK_IN_WIDGET_ID,
        title: 'Waiver',
        Component: WaiverCheckInStatus,
      },
    ],
    navItems: [
      {
        label: 'Waivers',
        href: '/waivers',
        icon: { path: mdiFileSign.path },
        // `/waivers/templates/{id}` and `/waivers/sign/{id}` are entities
        // beneath the page, which says "no such waiver" itself.
        ownsSubtree: true,
        recordTitle: 'Waiver',
        header: {
          title: 'Waivers',
          icon: { path: mdiFileSign.path },
          docsTopic: 'waivers',
        },
        Component: WaiversConsolePage,
      },
    ],
  })
}

export * from './site'
