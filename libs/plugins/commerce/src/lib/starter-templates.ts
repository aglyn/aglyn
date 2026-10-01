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

import {
  buildStarterNodes,
  starterHeroSection,
  starterSection,
  starterText,
  type StarterNodeSpec,
  type StarterTemplate,
  type StarterTemplateScreen,
} from '@aglyn/aglyn/app-utils/starter-template-nodes'
import { SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The shop starters (AGL-300): storefront sites built around this plugin's
 * elements — the product grid, the product page, the cart and the customer
 * account.
 *
 * Declared under `starterTemplates` in plugins.config.json; the manifest
 * generator calls {@link commerceStarterTemplates} and compiles what it
 * returns into core's `plugin-starter-templates.generated.ts`, after the
 * platform's own starters. The gallery, the seed route and the AI plugin's
 * examples read that list, so none of them loads this plugin to offer a shop.
 *
 * PERSISTED IDENTIFIERS: the starter ids, the screen keys and every node id
 * below appear in stored documents — seeded template ids are derived from
 * the first two — so none is ever renamed.
 */

/** One of this plugin's elements, placed on a starter page. */
const commerceBlock = (
  id: string,
  componentId: string,
  props?: Record<string, unknown>,
): StarterNodeSpec => ({ id, componentId, pluginId: BUNDLE_ID, props })

/** The pages both shop starters share. */
function shopScreens(prefix: string, digital: boolean): StarterTemplateScreen[] {
  return [
    {
      key: 'home',
      displayName: 'Home',
      // The site root, spelled the way the routing map spells it. `''` here
      // read as "no address" everywhere downstream and put the shop's home
      // page at `/home` (AGL-1575).
      slug: SCREEN_ROOT_PATH,
      seo: {
        title: digital ? 'Digital shop' : 'Shop',
        description: 'Browse our products.',
      },
      nodes: buildStarterNodes([
        starterHeroSection(
          `${prefix}h_`,
          digital ? 'Downloads that level you up' : 'Gear you can trust',
          digital
            ? 'Instant delivery. Lifetime updates.'
            : 'Quality parts, shipped fast.',
        ),
        starterSection(`${prefix}h_gridSection`, 'xl', 6, [
          commerceBlock(`${prefix}h_grid`, 'product-grid', {
            source: 'all',
            sort: 'newest',
            columns: 3,
            maxItems: 6,
          }),
        ]),
        // A newsletter capture is a short text-led band, not a gallery.
        starterSection(`${prefix}h_newsSection`, 'md', 6, [
          commerceBlock(`${prefix}h_news`, 'newsletter-signup', {
            heading: 'Get updates and offers',
          }),
        ]),
      ]),
    },
    {
      key: 'shop',
      displayName: 'Shop',
      slug: 'shop',
      seo: { title: 'All products' },
      nodes: buildStarterNodes([
        starterSection(`${prefix}s_section`, 'xl', 6, [
          starterText(`${prefix}s_title`, 'h3', 'All products'),
          commerceBlock(`${prefix}s_grid`, 'product-grid', {
            source: 'all',
            columns: 4,
            showFilters: true,
          }),
        ]),
      ]),
    },
    {
      key: 'product',
      displayName: 'Product page',
      slug: 'product',
      seo: { title: 'Product' },
      nodes: buildStarterNodes([
        starterSection(`${prefix}p_section`, 'xl', 6, [
          commerceBlock(`${prefix}p_detail`, 'product-detail', {}),
        ]),
      ]),
    },
    {
      key: 'cart',
      displayName: 'Cart',
      slug: 'cart',
      seo: { title: 'Your cart' },
      // LG, the deliberate middle case: a cart is a wide table but it is read
      // line by line, so a full XL band spreads it further than the eye
      // tracks. Same for the account screen below.
      nodes: buildStarterNodes([
        starterSection(`${prefix}c_section`, 'lg', 6, [
          starterText(`${prefix}c_title`, 'h3', 'Your cart'),
          commerceBlock(`${prefix}c_cart`, 'cart', {
            variant: 'inline',
            showCoupon: true,
          }),
        ]),
      ]),
    },
    {
      key: 'account',
      displayName: 'Account',
      slug: 'account',
      seo: { title: 'Your account' },
      nodes: buildStarterNodes([
        starterSection(`${prefix}a_section`, 'lg', 6, [
          commerceBlock(`${prefix}a_account`, 'customer-account', {
            signedOutHeading: 'Your account',
          }),
        ]),
      ]),
    },
  ]
}

/** This plugin's starters, as the manifest generator compiles them. */
export function commerceStarterTemplates(): StarterTemplate[] {
  return [
    {
      id: 'physical-shop',
      displayName: 'Shop (physical products)',
      description:
        'Storefront starter: home with featured products, filterable shop, ' +
        'product page, cart, and customer accounts. After applying, set the ' +
        'Product page as the product template in Store settings.',
      category: 'Commerce',
      screens: shopScreens('ps_', false),
    },
    {
      id: 'digital-shop',
      displayName: 'Shop (digital products)',
      description:
        'Digital storefront starter: downloads-focused home, shop, product ' +
        'page, cart, and accounts with a newsletter capture. Set the Product ' +
        'page as the product template in Store settings after applying.',
      category: 'Commerce',
      screens: shopScreens('ds_', true),
    },
  ]
}
