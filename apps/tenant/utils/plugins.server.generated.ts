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

export const TENANT_PLUGIN_SERVER_MANIFEST: PluginLoadManifest = [
  {
    id: 'forms',
    apiPrefixes: ["forms"],
    register: {"tenantApi":"registerFormsApi"},
    load: () => import('@aglyn/plugins-forms/server'),
  },
  {
    id: 'bookings',
    apiPrefixes: ["bookings"],
    register: {"tenantApi":"registerBookingsApi"},
    load: () => import('@aglyn/plugins-bookings/server'),
  },
  {
    id: 'commerce',
    apiPrefixes: ["commerce","membership"],
    register: {"tenantApi":"registerCommerceApi"},
    load: () => import('@aglyn/plugins-commerce/server'),
  },
  {
    id: 'data',
    register: {"tenantApi":"registerDataTenantApi"},
    load: () => import('@aglyn/plugins-data/tenant-api'),
  },
  {
    id: 'email',
    apiPrefixes: ["email"],
    register: {"tenantApi":"registerEmailApi"},
    load: () => import('@aglyn/plugins-email/server'),
  },
  {
    id: 'events-calendar',
    apiPrefixes: ["events"],
    register: {"tenantApi":"registerEventsCalendarApi"},
    load: () => import('@aglyn/plugins-events-calendar/server'),
  },
  {
    id: 'marketing',
    apiPrefixes: ["campaigns","experiments"],
    register: {"tenantApi":"registerMarketingApi"},
    load: () => import('@aglyn/plugins-marketing/server'),
  },
  {
    id: 'redirects',
    apiPrefixes: ["redirects"],
    register: {"tenantApi":"registerRedirectsApi"},
    load: () => import('@aglyn/plugins-redirects/server'),
  },
  {
    id: 'workflows',
    apiPrefixes: ["hooks","automations"],
    register: {"tenantApi":"registerWorkflowsApi"},
    load: () => import('@aglyn/plugins-workflows/server'),
  },
  {
    id: 'sales-channels',
    apiPrefixes: ["sales-channels"],
    register: {"tenantApi":"registerSalesChannelsApi"},
    load: () => import('@aglyn/plugins-sales-channels/server'),
  },
  {
    id: 'live-chat',
    apiPrefixes: ["live-chat"],
    register: {"tenantApi":"registerLiveChatApi"},
    load: () => import('@aglyn/plugins-live-chat/server'),
  },
  {
    id: 'weglot',
    register: {"tenantApi":"registerWeglotApi"},
    load: () => import('@aglyn/plugins-weglot/server'),
  },
]
