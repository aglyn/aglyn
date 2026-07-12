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
import { mdiCalendarMonthOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import * as EventList from './components/event-list'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The console page is code-split: the shell registers the extension at app
 * load for the nav strip, but the manager UI only loads when a user opens
 * the Events page (the shell's plugin route wraps it in Suspense).
 */
const EventsConsolePage = lazy(() => import('./components/events-console-page'))

/**
 * Events Calendar feature plugin (AGL-313): the reference extraction of
 * the AGL-277 pattern. The `event-list` component moved here from
 * `plugins-mui` — component ids resolve by componentId, so legacy
 * screen nodes persisted with pluginId 'mui' keep rendering; the mui
 * bundle no longer registers it. The console half declares the Events
 * nav/dashboard surface through the ConsoleExtension registry, gated by
 * the `eventCalendar` entitlement.
 */
export const EVENTS_CALENDAR_BUNDLE: PluginSdk.FeatureBundleEntry[] = [
  {
    component: EventList.default,
    schema: EventList.schema,
    presets: EventList.presets,
  },
]

/**
 * Console half only: registers the Events nav item + page + dashboard card
 * in the ConsoleExtension registry. Safe to call at console app load — it
 * pulls no besigner/canvas code (the page is lazy). The shell renders the
 * nav item and, through its generic plugin route, the page — so the Events
 * surface exists without any edit to the console's own nav or page files.
 */
export function registerEventsCalendarConsole(): void {
  PluginSdk.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Events Calendar',
    featureFlag: 'eventCalendar',
    navItems: [
      {
        label: 'Events',
        href: '/events',
        // Reuse the existing release-flag nav-tab so staff-preview gating
        // is unchanged now that the tab comes from the plugin (AGL-394).
        navTabId: 'nav-tab-events',
        icon: { path: mdiCalendarMonthOutline.path },
        header: { title: 'Events', icon: { path: mdiCalendarMonthOutline.path } },
        Component: EventsConsolePage,
      },
    ],
    dashboardCards: [{ cardId: 'events-upcoming', title: 'Upcoming events' }],
  })
}

export function registerEventsCalendarPlugin(): void {
  registerEventsCalendarConsole()
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return
  Aglyn.plugins.addDependency(
    PluginSdk.defineUiFeatureBundle(
      {
        bundleId: BUNDLE_ID,
        displayName: 'Events Calendar',
        description: 'Published events list with schema.org markup',
        icon: { path: mdiCalendarMonthOutline.path },
        components: EVENTS_CALENDAR_BUNDLE,
      },
      Aglyn.components,
    ),
  )
}
