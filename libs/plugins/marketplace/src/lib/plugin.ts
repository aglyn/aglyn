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
import MarketplaceBrowse from './components/marketplace-browse.component'
import MarketplacePaymentsNotice from './components/marketplace-payments-notice.component'
import HostPluginsCard from './components/host-plugins-card.component'
import PluginSiteSetPanel from './components/plugin-site-set-panel.component'
import PublishArtifactDialog from './components/publish-artifact-dialog.component'
import { MarketplaceListingContent } from './components/listing-content.component'
import { BUNDLE_ID } from './constants/bundle-common'
import { RATING_FIELD } from './model/rating-field'
import RatingInput from './components/rating-input.component'

/**
 * Marketplace feature plugin (AGL-395). Console-only — marketplace components
 * install into a host's own components collection and render through the
 * normal compose pipeline, so there is no separate canvas bundle.
 *
 * The marketplace moved to org scope (AGL-772/774): browse + install live at
 * `/[orgSlug]/marketplace`, so this plugin no longer contributes a per-site
 * `Marketplace` nav tab (AGL-775). It exposes its UI purely through widget
 * slots — `orgMarketplace` (browse), `marketplaceListing` (detail) and
 * `orgAddons` (installed) — which the app renders without importing the
 * plugin.
 */
export function registerMarketplaceConsole(): void {
  // Custom field type (AGL-434): rating rides int32 with a starred input.
  Aglyn.registerCustomFieldType({ ...RATING_FIELD, Input: RatingInput })
  Aglyn.registerConsoleExtension({
    // Listing detail content (AGL-419): the app route keeps the chrome
    // and renders this through the 'marketplaceListing' slot.
    widgets: [
      {
        slot: 'marketplaceListing',
        widgetId: 'marketplace-listing-content',
        Component: MarketplaceListingContent,
      },
      // What this deployment cannot do, said BEFORE the click (AGL-2019,
      // moved here by AGL-3080). The sentence names what still works
      // without a Stripe platform — browsing and free installs — which is
      // this plugin's knowledge; the app supplies only the fact, through
      // the deployment-capability context its org layout provides. The
      // widget draws nothing at all on a configured deployment.
      {
        slot: 'marketplaceCapability',
        widgetId: 'marketplace-payments-notice',
        Component: MarketplacePaymentsNotice,
      },
      // Org marketplace browse (AGL-772): the org-scope `/marketplace`
      // page renders this with an acting hostId + orgScoped, so listing
      // links resolve to the org route. The single place to browse/install,
      // replacing the per-site marketplace tab.
      {
        slot: 'orgMarketplace',
        widgetId: 'marketplace-org-marketplace',
        Component: MarketplaceBrowse,
      },
      // Installed add-ons management (AGL-423): the org "Plugins &
      // add-ons" hub renders this with an acting hostId — the card lists
      // host + org install pins with upgrade/uninstall/share-with-org.
      {
        slot: 'orgAddons',
        widgetId: 'marketplace-installed-addons',
        Component: HostPluginsCard,
      },
      // The site set for one installation (AGL-1007): the same control the
      // listing page uses, exposed so the installation detail page can show
      // it without the app importing this plugin.
      {
        slot: 'pluginSiteSet',
        widgetId: 'marketplace-plugin-site-set',
        Component: PluginSiteSetPanel,
      },
      // Publishing something the console holds (AGL-3080). The page that
      // offers it keeps the control that opens it — a menu item is one entry
      // of a list the page builds, not a widget — and hands over what it has
      // in its own vocabulary. Where a layout or a theme GOES, what a listing
      // of it is called and what it may cost at the least are this plugin's.
      {
        slot: 'hostArtifactPublish',
        widgetId: 'marketplace-publish-artifact',
        Component: PublishArtifactDialog,
      },
    ],
    pluginId: BUNDLE_ID,
    displayName: 'Marketplace',
  })
}

// Shared with the listing/publisher detail app-routes.
export { default as useMarketplaceActions } from './hooks/use-marketplace-actions'
export { default as MarketplaceBrowse } from './components/marketplace-browse.component'
export { default as HostPluginsCard } from './components/host-plugins-card.component'
export { default as PluginSiteSetPanel } from './components/plugin-site-set-panel.component'
