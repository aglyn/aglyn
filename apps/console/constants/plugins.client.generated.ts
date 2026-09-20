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
    contributes: {},
    load: () => import('@aglyn/plugins-mui'),
  },
  {
    id: 'forms',
    register: {"site":"registerFormsPlugin","console":"registerFormsConsole"},
    contributes: {"console":{"shell":true,"routes":["/forms"]}},
    load: () => import('@aglyn/plugins-forms'),
    loads: {
      site: () => import('@aglyn/plugins-forms/site'),
    },
  },
  {
    id: 'bookings',
    apiPrefixes: ["bookings"],
    register: {"site":"registerBookingsPlugin","console":"registerBookingsConsole"},
    contributes: {"console":{"shell":true,"routes":["/bookings"]}},
    load: () => import('@aglyn/plugins-bookings'),
    loads: {
      site: () => import('@aglyn/plugins-bookings/site'),
    },
  },
  {
    id: 'commerce',
    apiPrefixes: ["commerce","membership"],
    register: {"site":"registerCommercePlugin","console":"registerCommerceConsole"},
    contributes: {"console":{"shell":true,"routes":["/pos","/products"],"slots":["commerceGlance","hostDashboard"]}},
    load: () => import('@aglyn/plugins-commerce'),
    loads: {
      site: () => import('@aglyn/plugins-commerce/site'),
    },
  },
  {
    id: 'marketplace',
    apiPrefixes: ["marketplace"],
    register: {"console":"registerMarketplaceConsole"},
    contributes: {"console":{"shell":true,"slots":["marketplaceListing","orgAddons","orgMarketplace","pluginSiteSet"]}},
    load: () => import('@aglyn/plugins-marketplace'),
  },
  {
    id: 'crm',
    apiPrefixes: ["crm"],
    register: {"console":"registerCrmConsole"},
    contributes: {"console":{"shell":true,"routes":["/crm"],"slots":["hostDashboard","orgDashboard"]}},
    load: () => import('@aglyn/plugins-crm'),
  },
  {
    id: 'outreach',
    apiPrefixes: ["outreach"],
    register: {"console":"registerOutreachConsole"},
    contributes: {"console":{"shell":true,"orgRoutes":["/outreach"]}},
    load: () => import('@aglyn/plugins-outreach'),
  },
  {
    id: 'data',
    register: {"console":"registerDataConsole"},
    contributes: {"console":{"shell":true,"routes":["/data"],"slots":["orgData"]}},
    load: () => import('@aglyn/plugins-data'),
  },
  {
    id: 'email',
    apiPrefixes: ["email"],
    register: {"site":"registerEmailPlugin","console":"registerEmailConsole"},
    contributes: {"console":{"shell":true,"routes":["/emails"]}},
    load: () => import('@aglyn/plugins-email'),
    loads: {
      site: () => import('@aglyn/plugins-email/site'),
    },
  },
  {
    id: 'events-calendar',
    apiPrefixes: ["events"],
    register: {"site":"registerEventsCalendarPlugin","console":"registerEventsCalendarConsole"},
    contributes: {"console":{"shell":true,"routes":["/events"]}},
    load: () => import('@aglyn/plugins-events-calendar'),
    loads: {
      site: () => import('@aglyn/plugins-events-calendar/site'),
    },
  },
  {
    id: 'inbox',
    apiPrefixes: ["inbox"],
    register: {"console":"registerInboxConsole"},
    contributes: {"console":{"shell":true,"routes":["/inbox"],"slots":["hostDashboard"]}},
    load: () => import('@aglyn/plugins-inbox'),
  },
  {
    id: 'logic',
    register: {"console":"registerLogicConsole"},
    contributes: {"console":{"shell":true,"routes":["/logic"],"slots":["besignerFunctions"]}},
    load: () => import('@aglyn/plugins-logic'),
  },
  {
    id: 'marketing',
    apiPrefixes: ["campaigns","experiments"],
    register: {"console":"registerMarketingConsole","site":"registerMarketingPlugin"},
    contributes: {"console":{"shell":true,"routes":["/marketing"],"slots":["hostDashboard"]}},
    load: () => import('@aglyn/plugins-marketing'),
    loads: {
      site: () => import('@aglyn/plugins-marketing/site'),
    },
  },
  {
    id: 'redirects',
    register: {"console":"registerRedirectsConsole"},
    contributes: {"console":{"shell":true,"routes":["/redirects"]}},
    load: () => import('@aglyn/plugins-redirects'),
  },
  {
    id: 'workflows',
    apiPrefixes: ["hooks"],
    register: {"console":"registerWorkflowsConsole"},
    contributes: {"console":{"shell":true,"routes":["/automation"],"slots":["hostActivity"]}},
    load: () => import('@aglyn/plugins-workflows'),
  },
  {
    id: 'ai',
    apiPrefixes: ["ai","assist"],
    register: {"console":"registerAiConsole","staff":"registerAiConsole"},
    contributes: {"console":{"shell":true,"slots":["assistPanel","automationEditor","automationRun","besignerInspector","besignerToolbar","experimentResult","experimentVariants","hostAutomations","hostComponents","hostFirstRun","hostForms","hostLayouts","hostMembers","hostScreens","hostSeo","hostTemplates","hostTheme","importMapping","orgBillingUsage","orgMember","orgMembersListColumn","orgSites","productEditor","productImport","productsHub","recordEmail","recordInsights","seoFields","staffOrg","staffOrgUsageColumn","staffOrgsListColumn","staffUser"]}},
    load: () => import('@aglyn/plugins-ai'),
  },
]
