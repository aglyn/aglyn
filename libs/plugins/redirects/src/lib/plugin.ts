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
import { mdiSignDirection } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Redirects console page only loads when opened. */
const RedirectsConsolePage = lazy(
  () => import('./components/redirects-console-page'),
)

/**
 * Redirects feature plugin (AGL-395). Console-only — redirects render on
 * published sites through server enforcement (ISR), not a canvas component,
 * so there is no UI bundle to register in the tenant/besigner. The console
 * half declares the Redirects nav + page through the ConsoleExtension
 * registry, gated by the `redirects` entitlement.
 */
export function registerRedirectsConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Redirects',
    featureFlag: 'redirects',
    navItems: [
      {
        label: 'Redirects',
        href: '/redirects',
        // Reuse the existing release-flag nav-tab so staff-preview gating is
        // unchanged now that the tab comes from the plugin (AGL-395).
        navTabId: 'nav-tab-redirects',
        icon: { path: mdiSignDirection.path },
        header: { title: 'Redirects', icon: { path: mdiSignDirection.path } },
        Component: RedirectsConsolePage,
      },
    ],
  })
}
