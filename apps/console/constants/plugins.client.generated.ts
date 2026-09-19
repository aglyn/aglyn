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

export const CONSOLE_PLUGIN_MANIFEST: PluginLoadManifest = [
  {
    id: 'mui',
    alwaysOn: true,
    register: {"site":"registerMuiPlugin"},
    load: () => import('@aglyn/plugins-mui'),
  },
  {
    id: 'forms',
    register: {"site":"registerFormsPlugin","console":"registerFormsConsole"},
    load: () => import('@aglyn/plugins-forms'),
    loads: {
      site: () => import('@aglyn/plugins-forms/site'),
    },
  },
  {
    id: 'bookings',
    apiPrefixes: ["bookings"],
    register: {"site":"registerBookingsPlugin","console":"registerBookingsConsole"},
    load: () => import('@aglyn/plugins-bookings'),
    loads: {
      site: () => import('@aglyn/plugins-bookings/site'),
    },
  },
  {
    id: 'commerce',
    apiPrefixes: ["commerce","membership"],
    register: {"site":"registerCommercePlugin","console":"registerCommerceConsole"},
    load: () => import('@aglyn/plugins-commerce'),
    loads: {
      site: () => import('@aglyn/plugins-commerce/site'),
    },
  },
  {
    id: 'marketplace',
    apiPrefixes: ["marketplace"],
    register: {"console":"registerMarketplaceConsole"},
    load: () => import('@aglyn/plugins-marketplace'),
  },
  {
    id: 'crm',
    apiPrefixes: ["crm"],
    register: {"console":"registerCrmConsole"},
    load: () => import('@aglyn/plugins-crm'),
  },
  {
    id: 'outreach',
    apiPrefixes: ["outreach"],
    register: {"console":"registerOutreachConsole"},
    load: () => import('@aglyn/plugins-outreach'),
  },
  {
    id: 'data',
    register: {"console":"registerDataConsole"},
    load: () => import('@aglyn/plugins-data'),
  },
  {
    id: 'email',
    apiPrefixes: ["email"],
    register: {"site":"registerEmailPlugin","console":"registerEmailConsole"},
    load: () => import('@aglyn/plugins-email'),
    loads: {
      site: () => import('@aglyn/plugins-email/site'),
    },
  },
  {
    id: 'events-calendar',
    apiPrefixes: ["events"],
    register: {"site":"registerEventsCalendarPlugin","console":"registerEventsCalendarConsole"},
    load: () => import('@aglyn/plugins-events-calendar'),
    loads: {
      site: () => import('@aglyn/plugins-events-calendar/site'),
    },
  },
  {
    id: 'inbox',
    apiPrefixes: ["inbox"],
    register: {"console":"registerInboxConsole"},
    load: () => import('@aglyn/plugins-inbox'),
  },
  {
    id: 'logic',
    register: {"console":"registerLogicConsole"},
    load: () => import('@aglyn/plugins-logic'),
  },
  {
    id: 'marketing',
    apiPrefixes: ["campaigns","experiments"],
    register: {"console":"registerMarketingConsole","site":"registerMarketingPlugin"},
    load: () => import('@aglyn/plugins-marketing'),
    loads: {
      site: () => import('@aglyn/plugins-marketing/site'),
    },
  },
  {
    id: 'redirects',
    register: {"console":"registerRedirectsConsole"},
    load: () => import('@aglyn/plugins-redirects'),
  },
  {
    id: 'workflows',
    apiPrefixes: ["hooks"],
    register: {"console":"registerWorkflowsConsole"},
    load: () => import('@aglyn/plugins-workflows'),
  },
  {
    id: 'ai',
    apiPrefixes: ["ai","assist"],
    register: {"console":"registerAiConsole","staff":"registerAiConsole"},
    load: () => import('@aglyn/plugins-ai'),
  },
]
