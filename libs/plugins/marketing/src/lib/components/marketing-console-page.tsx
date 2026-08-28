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

import type { AglynOrgBilling, ConsolePluginPageProps } from '@aglyn/aglyn'
import { GridItems } from '@aglyn/shared-ui-jsx'
import { HubSections } from '@aglyn/shared-ui-next'
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import AnnouncementBarCard from './announcement-bar-card.component'
import HostExperimentsCard from './host-experiments-card.component'
import HostMarketingSummaryCard from './host-marketing-summary-card.component'
import HostOverlaysCard from './host-overlays-card.component'
import PopupCard from './popup-card.component'
import {
  DEFAULT_MARKETING_CONSOLE_SECTION,
  type MarketingConsoleSectionId,
} from './marketing-console-sections'

/**
 * The body of one marketing section, built only when that section is the one
 * being read (AGL-693).
 *
 * A function rather than a map of nodes on purpose: a `Record<id, ReactNode>`
 * would CONSTRUCT all three every render, and each card opens its Firestore
 * listens on mount — which is the entire cost this page exists to stop paying.
 * Only the returned branch is ever built.
 */
function sectionBody(
  section: MarketingConsoleSectionId,
  hostId: string,
  org: Partial<AglynOrgBilling> | undefined,
): ReactNode {
  switch (section) {
    case 'overview':
      return <HostMarketingSummaryCard hostId={hostId} />
    case 'overlays':
      return (
        <GridItems
          spacing={3}
          items={[
            {
              size: { xs: 12 },
              children: <HostOverlaysCard hostId={hostId} org={org} />,
            },
            {
              size: { xs: 12, md: 6 },
              children: <AnnouncementBarCard hostId={hostId} org={org} />,
            },
            {
              size: { xs: 12, md: 6 },
              children: <PopupCard hostId={hostId} org={org} />,
            },
          ]}
        />
      )
    case 'experiments':
      return <HostExperimentsCard hostId={hostId} org={org} />
    default:
      return null
  }
}

/**
 * Marketing page (AGL-251 → AGL-395): the at-a-glance rollup, the overlay
 * managers (multi-overlay + announcement bar + popup), and A/B testing — owned
 * by the marketing plugin and rendered by the shell's generic plugin route.
 * Each gated card runs its own entitlement check (overlays vs A/B are distinct
 * plan flags) off the shell's resolved `org`; the popup image picker uses the
 * shell's media browser via `useMediaPicker`.
 *
 * Sections are ROUTES (AGL-693). `HubTabs lazy` already mounted one panel, so
 * this is not a read saving — `marketing-console-read-cost.spec.tsx` was
 * written BEFORE the conversion precisely to hold that line, and reports the
 * same counts after. What routing adds is that the URL names the section: it is
 * linkable, the back button walks sections, the breadcrumb says where you are,
 * and "mount only what is open" is structural rather than a `lazy` flag.
 */
export function MarketingConsolePage(props: ConsolePluginPageProps) {
  const { hostId, org, section, sections, basePath } = props
  const router = useRouter()

  /*
   * `/marketing` names no section, so it lands on the first one the reader may
   * open. `replace`, not `push`: a redirect the reader did not ask for must not
   * become a history entry their back button bounces off.
   */
  const landing =
    sections?.find(
      (item) => item.visible && item.id === DEFAULT_MARKETING_CONSOLE_SECTION,
    ) ?? sections?.find((item) => item.visible)

  useEffect(() => {
    if (section || !landing) return
    router.replace(landing.href)
  }, [section, landing, router])

  // Nothing while the redirect is in flight: rendering the default section
  // would pay for its listens on a URL about to be replaced.
  if (!section || !sections?.length || !basePath) return null

  return (
    <HubSections sections={sections}>
      {sectionBody(section as MarketingConsoleSectionId, hostId, org)}
    </HubSections>
  )
}
MarketingConsolePage.displayName = 'MarketingConsolePage'

export default MarketingConsolePage
