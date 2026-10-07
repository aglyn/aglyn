/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The mobile apps' plugin manifest (AGL-3620), from each plugin's `mobile`
 * block in plugins.config.json. Only the mobile apps import it; each entry
 * loads the plugin's `./mobile` entry and nothing else.
 */
/* eslint-disable @nx/enforce-module-boundaries */

import type { MobilePluginManifest } from '@aglyn/mobile-plugin-host'

export const MOBILE_PLUGIN_MANIFEST: MobilePluginManifest = [
  {
    id: 'bookings',
    register: 'registerBookingsMobile',
    contributes: {"screens":["bookings.booking","bookings.calendar"],"tabs":["bookings.calendar-tab"],"widgets":["bookings.today"],"quickActions":["bookings.today-action"],"deepLinks":["bookings.page"]},
    load: () => import('@aglyn/plugins-bookings/mobile'),
  },
  {
    id: 'commerce',
    register: 'registerCommerceMobile',
    contributes: {"screens":["commerce.order","commerce.orders","commerce.product","commerce.products","commerce.sales","commerce.scan"],"tabs":["commerce.orders-tab","commerce.products-tab"],"widgets":["commerce.sales-trend","commerce.today"],"quickActions":["commerce.new-product","commerce.orders-to-ship","commerce.scan"],"deepLinks":["commerce.orders-page","commerce.products-page"]},
    load: () => import('@aglyn/plugins-commerce/mobile'),
  },
  {
    id: 'redirects',
    register: 'registerRedirectsMobile',
    contributes: {"screens":["redirects.list"],"widgets":["redirects.summary"],"quickActions":["redirects.open"],"deepLinks":["redirects.page"]},
    load: () => import('@aglyn/plugins-redirects/mobile'),
  },
]
