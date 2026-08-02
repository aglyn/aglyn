/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The sole sanctioned @aglyn/plugins-* references outside libs/plugins
 * (AGL-417): dynamic-import loaders the core plugin-manager activates at
 * runtime for the org's enabled plugins. Source of truth: plugins.config.json.
 */
/* eslint-disable @nx/enforce-module-boundaries */

import type { PluginLoadManifest } from '@aglyn/aglyn/server'

export const CONSOLE_PLUGIN_SERVER_MANIFEST: PluginLoadManifest = [
  {
    id: 'bookings',
    apiPrefixes: ["bookings"],
    register: {"consoleApi":"registerBookingsConsoleApi"},
    load: () => import('@aglyn/plugins-bookings/server'),
  },
  {
    id: 'commerce',
    apiPrefixes: ["commerce","membership"],
    register: {"consoleApi":"registerCommerceConsoleApi"},
    load: () => import('@aglyn/plugins-commerce/server'),
  },
  {
    id: 'marketplace',
    apiPrefixes: ["marketplace"],
    register: {"consoleApi":"registerMarketplaceConsoleApi"},
    load: () => import('@aglyn/plugins-marketplace/server'),
  },
  {
    id: 'marketing',
    apiPrefixes: ["campaigns","experiments"],
    register: {"consoleApi":"registerMarketingConsoleApi"},
    load: () => import('@aglyn/plugins-marketing/server'),
  },
]
