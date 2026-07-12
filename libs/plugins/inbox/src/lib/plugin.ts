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
import * as PluginSdk from '@aglyn/aglyn'
import { mdiInboxArrowDown } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Inbox console page only loads when opened. */
const InboxConsolePage = lazy(() => import('./components/inbox-console-page'))

/**
 * Inbox feature plugin (AGL-395). Console-only — form submissions, site
 * members/leads, orders, and campaigns live in Firestore and have no canvas
 * element, so there is no UI bundle. The console half declares the Inbox
 * nav + page through the ConsoleExtension registry (always-on). Depends on
 * the commerce + email plugins for the borrowed Orders/Campaigns tabs.
 */
export function registerInboxConsole(): void {
  PluginSdk.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Inbox',
    navItems: [
      {
        label: 'Inbox',
        href: '/inbox',
        navTabId: 'nav-tab-inbox',
        icon: { path: mdiInboxArrowDown.path },
        header: { title: 'Inbox', icon: { path: mdiInboxArrowDown.path } },
        Component: InboxConsolePage,
      },
    ],
  })
}
