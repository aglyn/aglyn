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
import { mdiBullhornOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { MARKETING_CONSOLE_SECTIONS } from './components/marketing-console-sections'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Marketing console page only loads when opened. */
const MarketingConsolePage = lazy(
  () => import('./components/marketing-console-page'),
)

/** Dashboard glance card, loaded only where the shell renders the slot. */
const CampaignGlanceCard = lazy(
  () => import('./components/campaign-glance-card.component'),
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
    /*
     * The host dashboard's `Last campaign` card (AGL-433). A widget rather
     * than a direct import by the dashboard page, so it appears only on
     * workspaces that have the plugin that owns the campaign history — a card
     * about campaigns on a console with no campaigns page could only ever be
     * blank, and its header links straight into `/marketing/campaigns`.
     */
    widgets: [
      {
        slot: Aglyn.CONSOLE_WIDGET_SLOTS.hostDashboard,
        // The id a reader's dashboard preferences already name — it is what
        // `isDashboardWidgetHidden` and the customize order are keyed on, so
        // it is persisted and does not follow the plugin.
        widgetId: 'email-campaign-glance',
        title: 'Last campaign',
        Component: CampaignGlanceCard,
      },
    ],
    navItems: [
      {
        label: 'Marketing',
        href: '/marketing',
        // Sections as ROUTES (AGL-2501): each is a real URL the shell
        // resolves and gates, so the page mounts the one being read.
        sections: MARKETING_CONSOLE_SECTIONS,
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

export * from './site'
