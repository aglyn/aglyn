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
import { mdiAccountGroupOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { AiAssistProvider } from './components/ai-assist-provider.component'
import HostPluginsCard from './components/host-plugins-card.component'
import { CommunityListingContent } from './components/listing-content.component'
import { BUNDLE_ID } from './constants/bundle-common'
import { RATING_FIELD } from './model/rating-field'
import RatingInput from './components/rating-input.component'

/** Code-split: the Community console page only loads when opened. */
const CommunityConsolePage = lazy(
  () => import('./components/community-console-page'),
)

/**
 * Community feature plugin (AGL-395). Console-only — community components
 * install into a host's own components collection and render through the
 * normal compose pipeline, so there is no separate canvas bundle. The
 * console half declares the Community hub nav + page through the
 * ConsoleExtension registry (release_community gate via the nav tab). The
 * listing + publisher detail pages remain app file-routes (nested dynamic
 * segments) that import this plugin's shared `useCommunityActions`.
 */
export function registerCommunityConsole(): void {
  // Custom field type (AGL-434): rating rides int32 with a starred input.
  PluginSdk.registerCustomFieldType({ ...RATING_FIELD, Input: RatingInput })
  PluginSdk.registerConsoleExtension({
    // AI assist (AGL-89/419): mounted by the shell around every console
    // page; besigner consumes AiAssistContext from besigner-ui.
    providers: [AiAssistProvider],
    // Listing detail content (AGL-419): the app route keeps the chrome
    // and renders this through the 'communityListing' slot.
    widgets: [
      {
        slot: 'communityListing',
        widgetId: 'community-listing-content',
        Component: CommunityListingContent,
      },
      // Installed add-ons management (AGL-423): the org "Plugins &
      // add-ons" hub renders this with an acting hostId — the card lists
      // host + org install pins with upgrade/uninstall/share-with-org.
      {
        slot: 'orgAddons',
        widgetId: 'community-installed-addons',
        Component: HostPluginsCard,
      },
    ],
    pluginId: BUNDLE_ID,
    displayName: 'Community',
    navItems: [
      {
        label: 'Community',
        href: '/community',
        navTabId: 'nav-tab-community',
        icon: { path: mdiAccountGroupOutline.path },
        header: {
          title: 'Community',
          icon: { path: mdiAccountGroupOutline.path },
        },
        Component: CommunityConsolePage,
      },
    ],
  })
}

// Shared with the listing/publisher detail app-routes.
export { default as useCommunityActions } from './hooks/use-community-actions'
export { default as CommunityBrowse } from './components/community-browse.component'
export { default as HostPluginsCard } from './components/host-plugins-card.component'
