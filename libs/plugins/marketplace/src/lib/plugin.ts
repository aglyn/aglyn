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
import { mdiStorefrontOutline } from '@aglyn/shared-data-mdi'
import MarketplaceBrowse from './components/marketplace-browse.component'
import MarketplaceHub from './components/marketplace-hub.component'
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
    /*
     * Four widgets fewer since AGL-3080 — the listing body, the capability
     * notice, browse, and installed add-ons. Their zones existed for one
     * reason: a CONSOLE ROUTE had to show them and an app may not import a
     * plugin. The hub is this plugin's own surface now, so those components
     * are plain imports and the four zones are gone from the catalog.
     *
     * What is left is what a console page OTHER than the marketplace draws.
     */
    widgets: [
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
    /**
     * THE MARKETPLACE HUB, as a declaration (AGL-3080).
     *
     * Seventeen hand-written console routes until now — the eight sections
     * below plus a listing, a publisher storefront and a publish form —
     * whose whole job was assembling chrome around bodies that already
     * belonged to this plugin. The shell's generic org plugin route does
     * that assembly for every other surface from exactly this.
     *
     * `ownsSubtree` is what keeps every URL the same. A segment naming a
     * section below resolves as that section; anything else beneath
     * `/marketplace` is handed to the page as `segments`, which is how
     * `/{org}/marketplace/{listingId}` still opens a listing. The cost is
     * stated where the flag is declared: this surface can no longer tell a
     * typo from an id, so it owns saying "no such thing" — which a listing
     * page has to do anyway for one deleted while a link to it was still in
     * someone's inbox.
     */
    orgNavItems: [
      {
        label: 'Marketplace',
        href: '/marketplace',
        navTabId: 'nav-tab-org-marketplace',
        icon: { path: mdiStorefrontOutline.path },
        ownsSubtree: true,
        Component: MarketplaceHub,
        header: {
          title: 'Marketplace',
          icon: { path: mdiStorefrontOutline.path },
          docsTopic: 'plugins',
        },
        sections: [
          // "Browse All" (AGL-1024): the same grid also renders
          // publisher-filtered views, so the unqualified verb was ambiguous
          // about which you were getting.
          { id: 'browse', label: 'Browse All' },
          { id: 'installed', label: 'Installed' },
          /*
           * What this workspace OWNS (AGL-2331) — an org can hold a licence
           * nobody has installed, and a member can install something they
           * never bought. Buyer-side, so deliberately NOT gated like the
           * seller sections below: the person who needs it is often not a
           * publisher at all.
           *
           * `purchase` lands here: Stripe bakes it into the checkout session
           * and holds the URL, and a buyer coming back wants what they now
           * own.
           */
          {
            id: 'licences',
            label: 'Licenses',
            landsOnQuery: ['purchase'],
          },
          /*
           * The seller half. Each reads the organization's REVENUE or its
           * payout account, so each names the permission rather than relying
           * on a hidden tab — a URL can be typed whether or not a tab was
           * ever offered, and the shell applies this to the rail and to the
           * deep link as one verdict.
           */
          {
            id: 'upload',
            // Covers uploading a bundle as well as publishing an existing
            // artifact (AGL-1024).
            label: 'Upload / Publish',
            permission: 'publishToMarketplace',
          },
          {
            id: 'profile',
            // Whose profile (AGL-1024) — the console also has org and user
            // profiles.
            label: 'Publisher Profile',
            permission: 'publishToMarketplace',
          },
          {
            id: 'listings',
            label: 'Listings',
            permission: 'publishToMarketplace',
          },
          {
            id: 'payouts',
            label: 'Payouts',
            permission: 'publishToMarketplace',
            // Stripe Connect onboarding returns with this, from
            // `server/connect.ts`. A seller coming back wants Payouts.
            landsOnQuery: ['connect'],
          },
          {
            id: 'sales',
            label: 'Sales',
            permission: 'publishToMarketplace',
          },
        ],
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
