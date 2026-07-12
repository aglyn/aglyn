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
 * shell's resolved `tenant`; the popup image picker uses the shell's media
 * browser via `useMediaPicker`.
 */
export function MarketingConsolePage(props: ConsolePluginPageProps) {
  const { hostId, tenant } = props
  return (
    <HubTabs
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
                  children: <HostOverlaysCard hostId={hostId} tenant={tenant} />,
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <AnnouncementBarCard hostId={hostId} tenant={tenant} />
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: <PopupCard hostId={hostId} tenant={tenant} />,
                },
              ]}
            />
          ),
        },
        {
          id: 'experiments',
          label: 'A/B testing',
          content: <HostExperimentsCard hostId={hostId} tenant={tenant} />,
        },
      ]}
    />
  )
}
MarketingConsolePage.displayName = 'MarketingConsolePage'

export default MarketingConsolePage
