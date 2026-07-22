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

import HostDatasetsCard from './components/host-datasets-card.component'
import * as Aglyn from '@aglyn/aglyn'
import * as PluginSdk from '@aglyn/aglyn'
import { mdiDatabaseOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Data console page only loads when opened. */
const DataConsolePage = lazy(() => import('./components/data-console-page'))

/**
 * Data feature plugin (AGL-395). Console-only — datasets are org-shared
 * document collections consumed by repeatable components at render time
 * through binding resolution, not a canvas element of their own, so there
 * is no UI bundle. The console half declares the host Data nav + page
 * through the ConsoleExtension registry, gated by the `dataStore`
 * entitlement. The org Data page (`Route.ORG_DATA`) is an org-scoped app route
 * that imports {@link HostDatasetsCard} directly.
 */
export function registerDataConsole(): void {
  PluginSdk.registerConsoleExtension({
    // Org datasets card (AGL-419): org/data renders it through the
    // 'orgData' widget slot.
    widgets: [
      {
        slot: 'orgData',
        widgetId: 'data-org-datasets',
        Component: HostDatasetsCard,
      },
    ],
    pluginId: BUNDLE_ID,
    displayName: 'Data',
    featureFlag: 'dataStore',
    navItems: [
      {
        label: 'Data',
        href: '/data',
        // Reuse the existing release-flag nav-tab so staff-preview gating is
        // unchanged now that the tab comes from the plugin (AGL-395).
        navTabId: 'nav-tab-data',
        icon: { path: mdiDatabaseOutline.path },
        header: { title: 'Data', icon: { path: mdiDatabaseOutline.path } },
        Component: DataConsolePage,
      },
    ],
  })
}

export { default as HostDatasetsCard } from './components/host-datasets-card.component'
export type { HostDatasetsCardProps } from './components/host-datasets-card.component'
