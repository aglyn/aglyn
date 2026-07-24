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
import { lazy } from 'react'
const PosConsolePage = lazy(() => import('./components/console/pos-page.component'))
const CommerceGlanceCard = lazy(
  () => import('./components/console/commerce-glance-card.component'),
)
import * as Account from './components/account'
import * as Cart from './components/cart'
import * as Gate from './components/gate'
import * as GatedVideo from './components/gated-video'
import * as MemberFeed from './components/member-feed'
import * as MemberRecovery from './components/member-recovery'
import * as MemberSignin from './components/member-signin'
import * as MemberSignup from './components/member-signup'
import * as NewsletterSignup from './components/newsletter-signup'
import * as ProductDetail from './components/product-detail'
import * as ReservationWidget from './components/reservation-widget'
import * as ProductGrid from './components/product-grid'
import * as ProductReviews from './components/product-reviews'
import * as RelatedProducts from './components/related-products'
import * as Wishlist from './components/wishlist'
import { BUNDLE_ID } from './constants/bundle-common'
import { COMMERCE_PERMISSIONS } from './model/plugin-permissions'

/** Code-split: the Products console page only loads when opened. */
const CommerceConsolePage = lazy(() => import('./components/commerce-console-page'))

/**
 * Commerce UI feature plugin (AGL-290): the storefront component set,
 * built on the feature-plugin pattern (AGL-277) — depends on the mui
 * bundle for primitives/theming and registers alongside it in the
 * besigner and the tenant renderer. Components join `COMMERCE_BUNDLE`
 * as they land (PLP AGL-291, PDP AGL-292, cart AGL-293, …); ids are
 * persisted in screen docs and never renamed.
 */
export const COMMERCE_BUNDLE: Aglyn.FeatureBundleEntry[] = [
  {
    component: ProductGrid.default,
    schema: ProductGrid.schema,
    presets: ProductGrid.presets,
  },
  {
    component: ProductDetail.default,
    schema: ProductDetail.schema,
    presets: ProductDetail.presets,
  },
  {
    component: Cart.default,
    schema: Cart.schema,
    presets: Cart.presets,
  },
  {
    component: Account.default,
    schema: Account.schema,
    presets: Account.presets,
  },
  {
    component: Wishlist.default,
    schema: Wishlist.schema,
    presets: Wishlist.presets,
  },
  {
    component: NewsletterSignup.default,
    schema: NewsletterSignup.schema,
    presets: NewsletterSignup.presets,
  },
  {
    component: Gate.default,
    schema: Gate.schema,
    presets: Gate.presets,
  },
  {
    component: GatedVideo.default,
    schema: GatedVideo.schema,
    presets: GatedVideo.presets,
  },
  {
    component: MemberFeed.default,
    schema: MemberFeed.schema,
    presets: MemberFeed.presets,
  },
  {
    component: MemberRecovery.default,
    schema: MemberRecovery.schema,
    presets: MemberRecovery.presets,
  },
  {
    component: MemberSignin.default,
    schema: MemberSignin.schema,
    presets: MemberSignin.presets,
  },
  {
    component: MemberSignup.default,
    schema: MemberSignup.schema,
    presets: MemberSignup.presets,
  },
  {
    component: ReservationWidget.default,
    schema: ReservationWidget.schema,
    presets: ReservationWidget.presets,
  },
  {
    component: ProductReviews.default,
    schema: ProductReviews.schema,
    presets: ProductReviews.presets,
  },
  {
    component: RelatedProducts.default,
    schema: RelatedProducts.schema,
    presets: RelatedProducts.presets,
  },
]

/**
 * Console half (AGL-395): registers the Products nav item in the
 * ConsoleExtension registry so the commerce console surface is owned by the
 * plugin, like events and email. The page body still lives in the console
 * app (`/[hostId]/products`): its product editor depends on the app's media
 * browser, which transitively pulls in the org/session context, so a full
 * body relocation needs a plugin-consumable media-picker context first —
 * tracked as follow-up. The nav item omits a `Component`, so the shell's
 * nav renders the link and the existing named route serves the page.
 */
export function registerCommerceConsole(): void {
  // Plugin-declared permissions (AGL-435): tier defaults ride every
  // resolved role set; custom roles override key-by-key.
  Aglyn.registerPluginPermissions(COMMERCE_PERMISSIONS)
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Commerce',
    // Dashboard/analytics glance card (AGL-419): rendered through the
    // shell's 'commerceGlance' widget slot.
    widgets: [
      {
        slot: 'commerceGlance',
        widgetId: 'commerce-glance',
        Component: CommerceGlanceCard,
      },
    ],
    navItems: [
      {
        label: 'Products',
        href: '/products',
        icon: { path: mdiStorefrontOutline.path },
        header: { title: 'Products', icon: { path: mdiStorefrontOutline.path } },
        Component: CommerceConsolePage,
      },
      {
        // POS register (AGL-312/419): relocated from the app's /pos route —
        // the generic [pluginSlug] shell now serves it at the same URL.
        label: 'POS',
        href: '/pos',
        icon: { path: mdiStorefrontOutline.path },
        header: { title: 'Point of Sale' },
        Component: PosConsolePage,
      },
    ],
  })
}

export function registerCommercePlugin(): void {
  registerCommerceConsole()
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return
  Aglyn.plugins.addDependency(
    Aglyn.defineUiFeatureBundle(
      {
        bundleId: BUNDLE_ID,
        displayName: 'Commerce',
        description: 'Storefront blocks: product grids, detail, cart',
        icon: { path: mdiStorefrontOutline.path },
        components: COMMERCE_BUNDLE,
      },
      Aglyn.components,
    ),
  )
}
