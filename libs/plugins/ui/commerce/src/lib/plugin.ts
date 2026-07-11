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
import * as Account from './components/account'
import * as Cart from './components/cart'
import * as Gate from './components/gate'
import * as GatedVideo from './components/gated-video'
import * as NewsletterSignup from './components/newsletter-signup'
import * as ProductDetail from './components/product-detail'
import * as ProductGrid from './components/product-grid'
import * as Wishlist from './components/wishlist'
import { BUNDLE_ID } from './constants/bundle-common'

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
]

export function registerCommercePlugin(): void {
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
