/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The mobile apps' plugin manifest (AGL-3620), from each plugin's `mobile`
 * block in plugins.config.json. Only the mobile apps import it; each entry
 * loads the plugin's `./mobile` entry and nothing else.
 *
 * This one is Aglyn POS's (AGL-3618): each plugin's `mobile.pos` block.
 */
/* eslint-disable @nx/enforce-module-boundaries */

import type { MobilePluginManifest } from '@aglyn/mobile-plugin-host'

export const MOBILE_PLUGIN_MANIFEST: MobilePluginManifest = [
  {
    id: 'bookings',
    register: 'registerBookingsPosMobile',
    contributes: {"screens":["bookings.pos.today"],"tabs":["bookings.pos.today"]},
    load: () => import('@aglyn/plugins-bookings/mobile'),
  },
  {
    id: 'commerce',
    register: 'registerCommercePosMobile',
    contributes: {"screens":["commerce.pos.register"],"tabs":["commerce.pos.register"]},
    load: () => import('@aglyn/plugins-commerce/mobile'),
  },
]
