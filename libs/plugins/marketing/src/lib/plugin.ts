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

/**
 * The preview slice is fetched only when a preview asks for it (AGL-1151).
 *
 * `loadMarketingPreviewProps` reads Firestore directly, so naming it statically
 * put the whole Firestore client in this plugin's chunk — which a PUBLISHED
 * site downloads and evaluates the moment marketing is enabled on it. Nothing
 * on a published page ever calls this: the server enricher writes the slice
 * there, and this path exists for the editor Preview alone, where no enricher
 * runs.
 *
 * A RELATIVE deferred import, deliberately. The specifier crosses no project
 * boundary, so nx records no lazy edge on the pair and
 * `@nx/enforce-module-boundaries` has nothing to forbid — the distinction
 * `aglyn/no-dynamic-first-party-import` exists to keep.
 */
const loadMarketingPreviewProps: NonNullable<
  Parameters<typeof registerSiteRuntime>[0]['loadPreviewProps']
> = async (ctx) =>
  (await import('./preview-props')).loadMarketingPreviewProps(ctx)

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
        header: {
          title: 'Marketing',
          icon: { path: mdiBullhornOutline.path },
          docsTopic: 'marketingOverlays',
        },
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
    // Editor Preview (AGL-830): rebuild the automations slice client-side so
    // the same runtime drives hover menus/drawers in preview as on the site.
    loadPreviewProps: loadMarketingPreviewProps,
  })
}
