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
    id: 'redirects',
    register: 'registerRedirectsMobile',
    contributes: {"screens":["redirects.list"],"widgets":["redirects.summary"],"quickActions":["redirects.open"],"deepLinks":["redirects.page"]},
    load: () => import('@aglyn/plugins-redirects/mobile'),
  },
]
