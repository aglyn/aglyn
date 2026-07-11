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
import { mdiCalendarMonthOutline } from '@aglyn/shared-data-mdi'
import * as EventList from './components/event-list'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * Events Calendar feature plugin (AGL-313): the reference extraction of
 * the AGL-277 pattern. The `event-list` component moved here from
 * `plugins-ui-mui` — component ids resolve by componentId, so legacy
 * screen nodes persisted with pluginId 'mui' keep rendering; the mui
 * bundle no longer registers it. The console half declares the Events
 * nav/dashboard surface through the ConsoleExtension registry, gated by
 * the `eventCalendar` entitlement.
 */
export const EVENTS_CALENDAR_BUNDLE: Aglyn.FeatureBundleEntry[] = [
  {
    component: EventList.default,
    schema: EventList.schema,
    presets: EventList.presets,
  },
]

export function registerEventsCalendarPlugin(): void {
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Events Calendar',
    featureFlag: 'eventCalendar',
    navItems: [{ label: 'Events', href: '/events' }],
    dashboardCards: [{ cardId: 'events-upcoming', title: 'Upcoming events' }],
  })
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return
  Aglyn.plugins.addDependency(
    Aglyn.defineUiFeatureBundle(
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
