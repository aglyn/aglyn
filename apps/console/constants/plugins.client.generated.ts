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
    load: () => import('@aglyn/plugins-mui/plugin'),
  },
  {
    id: 'forms',
    apiPrefixes: ["forms"],
    register: {"site":"registerFormsPlugin","console":"registerFormsConsole"},
    contributes: {"console":{"shell":true,"routes":["/forms"],"slots":["sitePackageItemPreview","transferResources"]}},
    load: () => import('@aglyn/plugins-forms'),
    loads: {
      site: () => import('@aglyn/plugins-forms/site'),
    },
  },
  {
    id: 'bookings',
    apiPrefixes: ["bookings"],
    register: {"site":"registerBookingsPlugin","console":"registerBookingsConsole"},
    contributes: {"console":{"shell":true,"routes":["/bookings"],"slots":["consoleSearch","crmRecordBooking","transferResources"]}},
    load: () => import('@aglyn/plugins-bookings'),
    loads: {
      site: () => import('@aglyn/plugins-bookings/site'),
    },
  },
  {
    id: 'commerce',
    apiPrefixes: ["commerce","membership"],
    register: {"site":"registerCommercePlugin","console":"registerCommerceConsole"},
    contributes: {"console":{"shell":true,"routes":["/pos","/products"],"slots":["commerceGlance","consoleSearch","hostDashboard","siteMember","transferResources"],"publicRoutes":["/pos-display","/pos-kiosk"]}},
    load: () => import('@aglyn/plugins-commerce'),
    loads: {
      site: () => import('@aglyn/plugins-commerce/site'),
    },
  },
  {
    id: 'marketplace',
    apiPrefixes: ["marketplace"],
    register: {"console":"registerMarketplaceConsole","staff":"registerMarketplaceConsole"},
    contributes: {"console":{"shell":true,"slots":["hostArtifactPublish","orgPluginInstalls","pluginInstallStatus","pluginSiteSet","staffOverview","templateGallery","templateInstallStatus"],"orgRoutes":["/marketplace"]}},
    load: () => import('@aglyn/plugins-marketplace'),
  },
  {
    id: 'crm',
    apiPrefixes: ["crm"],
    register: {"console":"registerCrmConsole"},
    contributes: {"console":{"shell":true,"routes":["/crm"],"orgRoutes":["/crm"],"slots":["consoleSearch","formContactFields","hostDashboard","orgDashboard","transferResources"]}},
    load: () => import('@aglyn/plugins-crm'),
  },
  {
    id: 'outreach',
    apiPrefixes: ["outreach"],
    register: {"console":"registerOutreachConsole"},
    contributes: {"console":{"slots":["transferResources"],"shell":true,"orgRoutes":["/outreach"]}},
    load: () => import('@aglyn/plugins-outreach'),
  },
  {
    id: 'accounting',
    apiPrefixes: ["accounting"],
    register: {"console":"registerAccountingConsole"},
    contributes: {"console":{"shell":true,"orgRoutes":["/accounting"]}},
    load: () => import('@aglyn/plugins-accounting'),
  },
  {
    id: 'data',
    register: {"console":"registerDataConsole"},
    contributes: {"console":{"shell":true,"routes":["/data"],"slots":["besignerPageProperties","entityPickers","hostScreenRow","orgData","transferResources"]}},
    load: () => import('@aglyn/plugins-data'),
  },
  {
    id: 'email',
    apiPrefixes: ["email"],
    register: {"site":"registerEmailPlugin","console":"registerEmailConsole"},
    contributes: {"console":{"shell":true,"routes":["/emails"],"orgRoutes":["/emails"],"slots":["campaignDesignCreate","campaignDesignPreview","campaignSenderEditor","campaignTopicOptions","campaignTopicSelect","sitePackageItemPreview","transferResources"]}},
    load: () => import('@aglyn/plugins-email'),
    loads: {
      site: () => import('@aglyn/plugins-email/site'),
    },
  },
  {
    id: 'events-calendar',
    apiPrefixes: ["events"],
    register: {"site":"registerEventsCalendarPlugin","console":"registerEventsCalendarConsole"},
    contributes: {"console":{"shell":true,"routes":["/events"],"slots":["transferResources"]}},
    load: () => import('@aglyn/plugins-events-calendar'),
    loads: {
      site: () => import('@aglyn/plugins-events-calendar/site'),
    },
  },
  {
    id: 'inbox',
    apiPrefixes: ["inbox"],
    register: {"console":"registerInboxConsole"},
    contributes: {"console":{"shell":true,"routes":["/inbox"],"orgRoutes":["/inbox"],"slots":["formSubmissions","hostDashboard"]}},
    load: () => import('@aglyn/plugins-inbox'),
  },
  {
    id: 'logic',
    register: {"console":"registerLogicConsole"},
    contributes: {"console":{"shell":true,"routes":["/logic"],"slots":["besignerFunctions","workflowUsage"]}},
    load: () => import('@aglyn/plugins-logic'),
  },
  {
    id: 'marketing',
    apiPrefixes: ["campaigns","experiments"],
    register: {"console":"registerMarketingConsole","staff":"registerMarketingConsole","site":"registerMarketingPlugin"},
    contributes: {"console":{"shell":true,"routes":["/marketing"],"orgRoutes":["/marketing"],"slots":["adminOrgDetail","besignerInteractions","crmRecordAttribution","emailMessages","emailTemplateRecipients","emailTemplateReport","hostDashboard","inboxCampaigns","inboxRecordAttribution","transferResources"]}},
    load: () => import('@aglyn/plugins-marketing'),
    loads: {
      site: () => import('@aglyn/plugins-marketing/site'),
    },
  },
  {
    id: 'redirects',
    apiPrefixes: ["redirects"],
    register: {"console":"registerRedirectsConsole"},
    contributes: {"console":{"shell":true,"routes":["/redirects"],"slots":["consoleSearch","transferResources"]}},
    load: () => import('@aglyn/plugins-redirects'),
  },
  {
    id: 'workflows',
    apiPrefixes: ["hooks","automations"],
    register: {"console":"registerWorkflowsConsole","staff":"registerWorkflowsConsole"},
    contributes: {"console":{"shell":true,"routes":["/automation"],"orgRoutes":["/automation"],"slots":["adminOrgDetail","consoleSearch","hostActivity","staffSite","transferResources"]}},
    load: () => import('@aglyn/plugins-workflows'),
  },
  {
    id: 'ai',
    apiPrefixes: ["ai","assist"],
    register: {"console":"registerAiConsole","staff":"registerAiConsole"},
    contributes: {"console":{"shell":true,"routes":["/ai-jobs"],"slots":["consoleDock","consoleTopBar","automationEditor","automationRun","besignerInspector","besignerToolbar","experimentResult","experimentVariants","funnelInsight","funnelsCreate","hostAutomations","hostBusinessProfile","hostCampaigns","hostComponents","hostEmailTemplates","hostDashboard","hostFirstRun","hostForms","hostLayouts","hostLogic","hostMembers","hostOverlays","hostScreens","hostSeo","hostTemplates","hostTheme","importMapping","marketingInsights","logicFunctionEditor","logicReferenceIssue","mediaLibrary","orgAutomations","orgBillingUsage","orgDashboard","orgMember","orgMembersListColumn","orgSites","overlayEditor","productEditor","productImport","productsCreate","productsHub","recordEmail","recordInsights","seoFields","staffOrg","staffOrgUsageColumn","staffOrgsListColumn","staffUser"]}},
    load: () => import('@aglyn/plugins-ai'),
  },
  {
    id: 'fonts',
    apiPrefixes: ["fonts"],
    register: {"console":"registerFontsConsole"},
    contributes: {"console":{"slots":["themeEditorFonts"]}},
    load: () => import('@aglyn/plugins-fonts/console'),
  },
  {
    id: 'theme-presets',
    register: {"console":"registerThemesConsole"},
    contributes: {"console":{"slots":["hostThemePresets"]}},
    load: () => import('@aglyn/plugins-themes'),
  },
  {
    id: 'shipping',
    apiPrefixes: ["shipping"],
    register: {"console":"registerShippingConsole"},
    contributes: {"console":{"slots":["commerceSettings","orderDetail","returnDetail","ordersBulk","productEditor","orgBillingUsage"]}},
    load: () => import('@aglyn/plugins-shipping'),
  },
  {
    id: 'post-purchase',
    apiPrefixes: ["post-purchase"],
    register: {"console":"registerPostPurchaseConsole"},
    contributes: {"console":{"slots":["commerceSettings","orderDetail"]}},
    load: () => import('@aglyn/plugins-post-purchase'),
  },
  {
    id: 'loyalty',
    apiPrefixes: ["loyalty"],
    register: {"console":"registerLoyaltyConsole"},
    contributes: {"console":{"slots":["commercePromotions","orderDetail"]}},
    load: () => import('@aglyn/plugins-loyalty'),
  },
  {
    id: 'tax-engines',
    apiPrefixes: ["tax-engines"],
    register: {"console":"registerTaxEnginesConsole"},
    contributes: {"console":{"slots":["commerceSettings","orderDetail","productEditor"]}},
    load: () => import('@aglyn/plugins-tax-engines'),
  },
  {
    id: 'marketing-platforms',
    apiPrefixes: ["marketing-platforms"],
    register: {"console":"registerMarketingPlatformsConsole"},
    contributes: {"console":{"slots":["hostSettings"]}},
    load: () => import('@aglyn/plugins-marketing-platforms'),
  },
  {
    id: 'zapier',
    apiPrefixes: ["zapier"],
    register: {"console":"registerZapierConsole"},
    contributes: {"console":{"slots":["hostSettings"]}},
    load: () => import('@aglyn/plugins-zapier'),
  },
  {
    id: 'fulfillment-networks',
    apiPrefixes: ["fulfillment-networks"],
    register: {"console":"registerFulfillmentNetworksConsole"},
    contributes: {"console":{"slots":["commerceSettings","orderDetail"]}},
    load: () => import('@aglyn/plugins-fulfillment-networks'),
  },
  {
    id: 'marketplaces',
    apiPrefixes: ["marketplaces"],
    register: {"console":"registerMarketplacesConsole"},
    contributes: {"console":{"slots":["commerceSettings","orderDetail"]}},
    load: () => import('@aglyn/plugins-marketplaces'),
  },
  {
    id: 'print-on-demand',
    apiPrefixes: ["print-on-demand"],
    register: {"console":"registerPrintOnDemandConsole"},
    contributes: {"console":{"slots":["commerceSettings","orderDetail","productEditor"]}},
    load: () => import('@aglyn/plugins-print-on-demand'),
  },
  {
    id: 'inventory-sync',
    apiPrefixes: ["inventory-sync"],
    register: {"console":"registerInventorySyncConsole"},
    contributes: {"console":{"slots":["commerceSettings","orderDetail"]}},
    load: () => import('@aglyn/plugins-inventory-sync'),
  },
  {
    id: 'delivery-apps',
    apiPrefixes: ["delivery-apps"],
    register: {"console":"registerDeliveryAppsConsole"},
    contributes: {"console":{"slots":["commerceSettings","posOrders"]}},
    load: () => import('@aglyn/plugins-delivery-apps'),
  },
  {
    id: 'sales-channels',
    apiPrefixes: ["sales-channels"],
    register: {"console":"registerSalesChannelsConsole"},
    contributes: {"console":{"slots":["commerceSettings","productEditor"]}},
    load: () => import('@aglyn/plugins-sales-channels'),
  },
  {
    id: 'funnels',
    apiPrefixes: ["funnels"],
    register: {"console":"registerFunnelsConsole"},
    contributes: {"console":{"slots":["hostAnalytics"]}},
    load: () => import('@aglyn/plugins-funnels'),
  },
  {
    id: 'weglot',
    register: {"site":"registerWeglotSite"},
    contributes: {},
    load: () => import('@aglyn/plugins-weglot/site'),
  },
]
