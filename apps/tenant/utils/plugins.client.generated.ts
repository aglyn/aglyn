/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The sole sanctioned @aglyn/plugins-* references outside libs/plugins
 * (AGL-417): dynamic-import loaders the core plugin-manager activates at
 * runtime for the org's enabled plugins. Source of truth: plugins.config.json.
 */
/* eslint-disable @nx/enforce-module-boundaries */

import type { PluginLoadManifest } from '@aglyn/aglyn'

export const TENANT_PLUGIN_MANIFEST: PluginLoadManifest = [
  {
    id: 'mui',
    alwaysOn: true,
    register: {"site":"registerMuiPlugin"},
    load: () => import('@aglyn/plugins-mui'),
  },
  {
    id: 'forms',
    register: {"site":"registerFormsPlugin"},
    load: () => import('@aglyn/plugins-forms/site'),
  },
  {
    id: 'bookings',
    apiPrefixes: ["bookings"],
    register: {"site":"registerBookingsPlugin"},
    load: () => import('@aglyn/plugins-bookings/site'),
  },
  {
    id: 'commerce',
    apiPrefixes: ["commerce","membership"],
    register: {"site":"registerCommercePlugin"},
    load: () => import('@aglyn/plugins-commerce/site'),
  },
  {
    id: 'email',
    apiPrefixes: ["email"],
    register: {"site":"registerEmailPlugin"},
    load: () => import('@aglyn/plugins-email/site'),
  },
  {
    id: 'events-calendar',
    apiPrefixes: ["events"],
    register: {"site":"registerEventsCalendarPlugin"},
    load: () => import('@aglyn/plugins-events-calendar/site'),
  },
  {
    id: 'marketing',
    apiPrefixes: ["campaigns","experiments"],
    register: {"site":"registerMarketingPlugin"},
    load: () => import('@aglyn/plugins-marketing/site'),
  },
]
