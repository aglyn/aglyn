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
import { registerSiteRuntime } from '@aglyn/aglyn'
import { MarketingSiteRuntime } from './components/site-runtime'
import { mdiBullhornOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Marketing console page only loads when opened. */
const MarketingConsolePage = lazy(
  () => import('./components/marketing-console-page'),
)

/**
 * Marketing feature plugin (AGL-395). Console-only — overlays and popups
 * render on published sites through the tenant runtime, not a canvas
 * element of their own, so there is no UI bundle. The console half declares
 * the Marketing nav + page through the ConsoleExtension registry (always-on;
 * the surface itself is not release-flagged — its overlays/A-B cards run
 * their own per-plan checks off the passed `org`). The popup image picker
 * uses the shell's media browser via `useMediaPicker`.
 */
export function registerMarketingConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Marketing',
    navItems: [
      {
        label: 'Marketing',
        href: '/marketing',
        navTabId: 'nav-tab-marketing',
        icon: { path: mdiBullhornOutline.path },
        header: { title: 'Marketing', icon: { path: mdiBullhornOutline.path } },
        Component: MarketingConsolePage,
      },
    ],
  })
}

/**
 * Site half (AGL-419): the overlays/experiments/automations runtime the
 * tenant page renders generically — reads back the slices the plugin's
 * server enricher wrote. Registered via the loader's 'site' surface.
 */
export function registerMarketingPlugin(): void {
  registerSiteRuntime({
    pluginId: 'marketing',
    runtimeId: 'marketing-site-runtime',
    Component: MarketingSiteRuntime,
  })
}
