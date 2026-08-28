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
'use client'

import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import { GridItems } from '@aglyn/shared-ui-jsx'
import { HubTabs } from '@aglyn/shared-ui-next'
import AnnouncementBarCard from './announcement-bar-card.component'
import HostExperimentsCard from './host-experiments-card.component'
import HostMarketingSummaryCard from './host-marketing-summary-card.component'
import HostOverlaysCard from './host-overlays-card.component'
import PopupCard from './popup-card.component'

/**
 * Marketing page (AGL-251 → AGL-395): the at-a-glance rollup, the overlay
 * managers (multi-overlay + announcement bar + popup), and A/B testing —
 * owned by the marketing plugin and rendered by the shell's generic plugin
 * route with the host-setup vertical-tab pattern. Each gated card runs its
 * own entitlement check (overlays vs A/B are distinct plan flags) off the
 * shell's resolved `org`; the popup image picker uses the shell's media
 * browser via `useMediaPicker`.
 */
export function MarketingConsolePage(props: ConsolePluginPageProps) {
  const { hostId, org } = props
  return (
    <HubTabs
      /*
       * Mount the section being read, and no others (AGL-693).
       *
       * `HubTabs` keeps every panel mounted unless told otherwise, so opening
       * one section also subscribed the Firestore listeners behind all the
       * rest and paid for every document their `limit()` allows. The reader
       * sees one section; without this the page reads them all.
       *
       * Sections as ROUTES would make this structural rather than a flag
       * somebody has to remember, and that is not reachable from a plugin
       * today: the shell mounts plugin pages through its `[pluginSlug]` route,
       * a single dynamic segment resolved by exact href match, so a section
       * has no sub-route to occupy and the page is handed no path segments.
       */
      lazy
      tabs={[
        {
          id: 'overview',
          label: 'Overview',
          content: <HostMarketingSummaryCard hostId={hostId} />,
        },
        {
          id: 'overlays',
          label: 'Overlays',
          content: (
            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12 },
                  children: <HostOverlaysCard hostId={hostId} org={org} />,
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <AnnouncementBarCard hostId={hostId} org={org} />
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: <PopupCard hostId={hostId} org={org} />,
                },
              ]}
            />
          ),
        },
        {
          id: 'experiments',
          label: 'A/B testing',
          content: <HostExperimentsCard hostId={hostId} org={org} />,
        },
      ]}
    />
  )
}
MarketingConsolePage.displayName = 'MarketingConsolePage'

export default MarketingConsolePage
