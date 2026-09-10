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
// GENERATED FILE — do not edit. Regenerate with:
//   node tools/scripts/generate-docs-help.mjs
// Source of truth: apps/docs/docs frontmatter + headings (AGL-602).

export interface DocsHelpTopic {
  /** Docs-site path, e.g. `/content-and-data/media/overview`. */
  path: string
  /** Docs page title. */
  title: string
}

// A topic's tooltip prose lives in `docs-help-excerpts.generated.ts` — the
// path and title are wanted the moment a help button renders, the excerpt only
// once a tooltip opens.
export const DOCS_HELP_TOPICS = {
  abuseReports: {
    path: '/staff-console/abuse-reports',
    title: 'Abuse reports',
  },
  account: {
    path: '/workspace-and-billing/signing-in-and-sessions',
    title: 'Signing In & Sessions',
  },
  actionsBuilder: {
    path: '/marketing-and-automation/workflows-and-actions/actions-builder',
    title: 'Actions builder',
  },
  activities: {
    path: '/content-and-data/crm/activities',
    title: 'Activities & the timeline',
  },
  addALocale: {
    path: '/building-sites/multilingual/add-a-locale',
    title: 'Add a locale',
  },
  addOns: {
    path: '/workspace-and-billing/billing-and-plans/add-ons',
    title: 'Add-ons',
  },
  addSearch: {
    path: '/building-sites/site-search/add-search',
    title: 'Add search to your site',
  },
  aglynAssist: {
    path: '/getting-started/aglyn-assist',
    title: 'Aglyn Assist',
  },
  aiAssist: {
    path: '/marketing-and-automation/ai-assist/overview',
    title: 'AI Assist',
  },
  analytics: {
    path: '/marketing-and-automation/analytics/overview',
    title: 'Analytics',
  },
  animations: {
    path: '/building-sites/besigner/animations',
    title: 'Element animations',
  },
  architectureMultiTenancy: {
    path: '/staff-console/architecture-multi-tenancy',
    title: 'Architecture: Multi-Tenant Organizations',
  },
  assistSignals: {
    path: '/staff-console/assist-signals',
    title: 'Assist Signal',
  },
  automations: {
    path: '/content-and-data/crm/automations',
    title: 'Automations for the CRM',
  },
  bandwidth: {
    path: '/workspace-and-billing/billing-and-plans/bandwidth',
    title: 'Bandwidth',
  },
  besigner: {
    path: '/building-sites/besigner/overview',
    title: 'The Besigner',
  },
  billing: {
    path: '/workspace-and-billing/billing-and-plans/overview',
    title: 'Billing & Plans',
  },
  bindings: {
    path: '/building-sites/bindings/overview',
    title: 'Bindings, Variables & Functions',
  },
  bookings: {
    path: '/commerce-and-bookings/bookings/overview',
    title: 'Bookings & Scheduling',
  },
  buildABlog: {
    path: '/building-sites/site-templates/build-a-blog',
    title: 'Build a blog',
  },
  buildAndPublishASurvey: {
    path: '/guides/build-and-publish-a-survey',
    title: 'Build & publish a survey',
  },
  buildAWorkflow: {
    path: '/marketing-and-automation/workflows-and-actions/build-a-workflow',
    title: 'Build a workflow',
  },
  buildingFeaturePlugins: {
    path: '/developers/plugins/building-feature-plugins',
    title: 'Building feature plugins',
  },
  bulkActions: {
    path: '/content-and-data/crm/bulk-actions',
    title: 'Bulk actions',
  },
  catalog: {
    path: '/commerce-and-bookings/commerce/catalog',
    title: 'Product catalog',
  },
  comingSoonLaunch: {
    path: '/guides/coming-soon-launch',
    title: 'Launch a coming-soon page',
  },
  commerce: {
    path: '/commerce-and-bookings/commerce/overview',
    title: 'Commerce',
  },
  commerceEndToEnd: {
    path: '/guides/commerce-end-to-end',
    title: 'Commerce end to end',
  },
  companies: {
    path: '/content-and-data/crm/companies',
    title: 'Companies',
  },
  components: {
    path: '/building-sites/besigner/reusable-components',
    title: 'Reusable components',
  },
  connectADomain: {
    path: '/building-sites/custom-domains/connect-a-domain',
    title: 'Connect a domain',
  },
  consoleAndSite: {
    path: '/developers/plugins/guides/console-and-site',
    title: 'Guide: console extensions & site surfaces',
  },
  consoleSearch: {
    path: '/getting-started/console-search',
    title: 'Search the console',
  },
  consoleTour: {
    path: '/getting-started/console-tour',
    title: 'The console tour',
  },
  contactRecord: {
    path: '/content-and-data/crm/contact-record',
    title: 'The contact record',
  },
  content: {
    path: '/building-sites/site-templates/overview',
    title: 'Templates, Blocks & Content',
  },
  cookieConsent: {
    path: '/marketing-and-automation/analytics/cookie-consent',
    title: 'Cookie consent',
  },
  copyAssist: {
    path: '/marketing-and-automation/ai-assist/copy-assist',
    title: 'Copy assist',
  },
  copyPaste: {
    path: '/building-sites/besigner/copy-paste',
    title: 'Copy & paste elements',
  },
  createARedirect: {
    path: '/building-sites/redirects/create-a-redirect',
    title: 'Create a redirect',
  },
  crm: {
    path: '/content-and-data/crm/overview',
    title: 'CRM',
  },
  customDomains: {
    path: '/building-sites/custom-domains/overview',
    title: 'Custom Domains',
  },
  customFields: {
    path: '/content-and-data/crm/custom-fields',
    title: 'Custom fields',
  },
  customRoles: {
    path: '/workspace-and-billing/teams-and-roles/custom-roles',
    title: 'Custom roles & permissions',
  },
  datasets: {
    path: '/content-and-data/datasets/overview',
    title: 'Datasets & Dynamic Content',
  },
  datasetsAndSchema: {
    path: '/guides/datasets-and-schema',
    title: 'Datasets & schema deep-dive',
  },
  deals: {
    path: '/content-and-data/crm/deals',
    title: 'Deals pipeline',
  },
  designedEmails: {
    path: '/marketing-and-automation/email-campaigns/designed-emails',
    title: 'Designed emails',
  },
  domainProviders: {
    path: '/developers/domain-providers',
    title: 'Domain providers',
  },
  downgradingAndCanceling: {
    path: '/workspace-and-billing/billing-and-plans/downgrading-and-canceling',
    title: 'Downgrading, canceling & your data',
  },
  dragDropHierarchy: {
    path: '/building-sites/besigner/drag-drop-hierarchy',
    title: 'Drag-and-drop hierarchy',
  },
  editFromTheLiveSite: {
    path: '/building-sites/besigner/edit-from-the-live-site',
    title: 'Edit from the live site',
  },
  editYourTheme: {
    path: '/building-sites/theme-builder/edit-your-theme',
    title: 'Edit your theme',
  },
  elementCatalog: {
    path: '/building-sites/besigner/element-catalog',
    title: 'Element catalog',
  },
  emailCampaigns: {
    path: '/marketing-and-automation/email-campaigns/overview',
    title: 'Email Campaigns',
  },
  emailTemplates: {
    path: '/content-and-data/crm/email-templates',
    title: 'Email templates',
  },
  enterprise: {
    path: '/enterprise/overview',
    title: 'Enterprise overview',
  },
  errorScreens: {
    path: '/building-sites/site-protection/error-screens',
    title: 'Design custom error screens',
  },
  events: {
    path: '/content-and-data/events/overview',
    title: 'Events Calendar',
  },
  examples: {
    path: '/developers/plugins/guides/examples',
    title: 'Worked examples',
  },
  extensionPoints: {
    path: '/developers/plugins/reference/extension-points',
    title: 'Extension-point catalog',
  },
  featureFlags: {
    path: '/staff-console/feature-flags',
    title: 'Feature Flags',
  },
  firstPlugin: {
    path: '/developers/plugins/guides/first-plugin',
    title: 'Build your first plugin',
  },
  forms: {
    path: '/content-and-data/forms/overview',
    title: 'Forms & Lead Capture',
  },
  generateSection: {
    path: '/marketing-and-automation/ai-assist/generate-section',
    title: 'AI Generate Section',
  },
  gettingStarted: {
    path: '/getting-started/create-a-site',
    title: 'Create a site',
  },
  glossary: {
    path: '/concepts/glossary',
    title: 'Glossary & naming conventions',
  },
  googleAnalytics: {
    path: '/marketing-and-automation/analytics/google-analytics',
    title: 'Google Analytics events',
  },
  import: {
    path: '/content-and-data/crm/import',
    title: 'Import contacts from CSV',
  },
  importExport: {
    path: '/content-and-data/datasets/import-export',
    title: 'Import & export',
  },
  injectionZones: {
    path: '/developers/plugins/reference/injection-zones',
    title: 'Injection zones',
  },
  installYourFirstPlugin: {
    path: '/guides/install-your-first-plugin',
    title: 'Install your first marketplace item',
  },
  interactions: {
    path: '/building-sites/besigner/interactions-and-custom-html',
    title: 'Interactions & custom HTML',
  },
  inviteTeammates: {
    path: '/workspace-and-billing/teams-and-roles/invite-teammates',
    title: 'Invite teammates',
  },
  languageSwitcher: {
    path: '/building-sites/multilingual/language-switcher',
    title: 'Add a language switcher',
  },
  layouts: {
    path: '/building-sites/screens-and-layouts/layouts',
    title: 'Layouts',
  },
  leads: {
    path: '/content-and-data/crm/leads',
    title: 'Leads',
  },
  liveCoEditing: {
    path: '/building-sites/besigner/live-co-editing',
    title: 'Live co-editing & unsaved work',
  },
  lockdown: {
    path: '/staff-console/lockdown',
    title: 'Lockdown',
  },
  longFormMarkdown: {
    path: '/building-sites/besigner/long-form-markdown',
    title: 'Long documents in markdown',
  },
  maintenance: {
    path: '/staff-console/maintenance',
    title: 'Maintenance',
  },
  maintenanceMode: {
    path: '/building-sites/site-protection/maintenance-mode',
    title: 'Maintenance mode',
  },
  manageAccount: {
    path: '/workspace-and-billing/manage-account',
    title: 'Manage Account',
  },
  manifestAndEnvs: {
    path: '/developers/plugins/reference/manifest-and-envs',
    title: 'Manifests, trust lifecycle & environment',
  },
  marketingOverlays: {
    path: '/marketing-and-automation/marketing-overlays/overview',
    title: 'Marketing Overlays',
  },
  media: {
    path: '/content-and-data/media/overview',
    title: 'Media Library & CDN',
  },
  megaMenuWithInteractions: {
    path: '/guides/mega-menu-with-interactions',
    title: 'Build a mega menu with hover interactions',
  },
  members: {
    path: '/guides/member-accounts',
    title: 'Member accounts',
  },
  membersOnly: {
    path: '/workspace-and-billing/teams-and-roles/members-only',
    title: 'Members-only areas',
  },
  menusAndNavigation: {
    path: '/building-sites/menus-and-navigation/overview',
    title: 'Menus & navigation',
  },
  migrationPatterns: {
    path: '/building-sites/redirects/migration-patterns',
    title: 'Migration patterns',
  },
  modelBuilder: {
    path: '/content-and-data/datasets/model-builder',
    title: 'Build a data model',
  },
  multilingual: {
    path: '/building-sites/multilingual/overview',
    title: 'Multilingual',
  },
  multiSelect: {
    path: '/building-sites/besigner/multi-select',
    title: 'Multi-select & multi-drag',
  },
  onboardingDeepLinks: {
    path: '/staff-console/onboarding-deep-links',
    title: 'Onboarding deep links (marketing → console)',
  },
  passwordAScreen: {
    path: '/building-sites/site-protection/password-a-screen',
    title: 'Password-protect a screen',
  },
  platformHealth: {
    path: '/staff-console/platform-health',
    title: 'Platform health',
  },
  pluginConfig: {
    path: '/developers/plugins/reference/plugin-config',
    title: 'Plugin configuration',
  },
  pluginManagerApi: {
    path: '/developers/plugins/reference/plugin-manager-api',
    title: 'Plugin-manager API reference',
  },
  plugins: {
    path: '/developers/plugins/overview',
    title: 'Plugins & Marketplace',
  },
  pos: {
    path: '/commerce-and-bookings/commerce/pos-and-reservations',
    title: 'POS & reservations',
  },
  publishAPlugin: {
    path: '/developers/plugins/publish-a-plugin',
    title: 'Publish a plugin',
  },
  publisherHandbook: {
    path: '/developers/plugins/publishing/publisher-handbook',
    title: 'Publisher handbook',
  },
  publishYourFirstScreen: {
    path: '/getting-started/publish-your-first-screen',
    title: 'Publish your first screen',
  },
  realmBundles: {
    path: '/developers/plugins/guides/realm-bundles',
    title: 'Guide: trusted realm bundles',
  },
  redirects: {
    path: '/building-sites/redirects/overview',
    title: 'Redirects',
  },
  refunds: {
    path: '/staff-console/refunds',
    title: 'Refunds',
  },
  relations: {
    path: '/content-and-data/datasets/relations',
    title: 'Relations',
  },
  reportAnIssue: {
    path: '/workspace-and-billing/report-an-issue',
    title: 'Report an issue',
  },
  reports: {
    path: '/content-and-data/crm/reports',
    title: 'Reports',
  },
  responsiveStyling: {
    path: '/building-sites/besigner/responsive-styling',
    title: 'Responsive styling & custom CSS',
  },
  revenue: {
    path: '/staff-console/revenue',
    title: 'Revenue',
  },
  runAnAgencyWorkspace: {
    path: '/guides/run-an-agency-workspace',
    title: 'Run an agency workspace',
  },
  salesTaxReturn: {
    path: '/staff-console/sales-tax-return',
    title: 'Sales tax return (Texas)',
  },
  sandboxSecurity: {
    path: '/developers/plugins/reference/sandbox-security',
    title: 'Sandbox security model',
  },
  saveATemplate: {
    path: '/building-sites/site-templates/save-a-template',
    title: 'Save & share a template',
  },
  screens: {
    path: '/building-sites/screens-and-layouts/screens',
    title: 'Screens',
  },
  screensAndLayouts: {
    path: '/building-sites/screens-and-layouts/overview',
    title: 'Screens & Layouts',
  },
  securityAndCompliance: {
    path: '/enterprise/security-and-compliance',
    title: 'Security & compliance',
  },
  selfHosting: {
    path: '/developers/self-hosting',
    title: 'Self-hosting',
  },
  selfHostingEnvironment: {
    path: '/developers/self-hosting-environment',
    title: 'Environment variables',
  },
  seo: {
    path: '/building-sites/seo/overview',
    title: 'SEO Toolkit',
  },
  serverApis: {
    path: '/developers/plugins/guides/server-apis',
    title: 'Guide: server APIs, webhooks & jobs',
  },
  settings: {
    path: '/content-and-data/crm/settings',
    title: 'CRM settings',
  },
  siteProtection: {
    path: '/building-sites/site-protection/overview',
    title: 'Site Protection & Error Pages',
  },
  siteSearch: {
    path: '/building-sites/site-search/overview',
    title: 'Site Search',
  },
  sso: {
    path: '/enterprise/sso',
    title: 'Single sign-on (SAML)',
  },
  staffConsole: {
    path: '/staff-console/overview',
    title: 'Staff Console (internal)',
  },
  supportAndCommunity: {
    path: '/workspace-and-billing/support-and-community',
    title: 'Support & community',
  },
  supportQueue: {
    path: '/staff-console/support-queue',
    title: 'Support queue (internal)',
  },
  supportTiers: {
    path: '/enterprise/support-tiers',
    title: 'Support commitments',
  },
  supportTriage: {
    path: '/staff-console/support-triage',
    title: 'Support triage runbook (internal)',
  },
  tasks: {
    path: '/content-and-data/crm/tasks',
    title: 'Tasks & follow-ups',
  },
  team: {
    path: '/workspace-and-billing/teams-and-roles/overview',
    title: 'Teams, Roles & Membership',
  },
  templatesLibrary: {
    path: '/building-sites/site-templates/templates-library',
    title: 'Your templates library',
  },
  termReference: {
    path: '/concepts/term-reference',
    title: 'Term reference',
  },
  textEditing: {
    path: '/building-sites/besigner/text-editing',
    title: 'Inline & rich text editing',
  },
  themeBuilder: {
    path: '/building-sites/theme-builder/overview',
    title: 'Theme Builder',
  },
  themeStyles: {
    path: '/building-sites/besigner/theme-styles',
    title: 'Text styles & theme tokens',
  },
  troubleshooting: {
    path: '/building-sites/custom-domains/troubleshooting',
    title: 'Troubleshoot verification',
  },
  uptimeAndStatus: {
    path: '/enterprise/uptime-and-status',
    title: 'Availability & status',
  },
  versionsAndPublishing: {
    path: '/building-sites/screens-and-layouts/versions-and-publishing',
    title: 'Versions & scheduled publishing',
  },
  video: {
    path: '/building-sites/besigner/video',
    title: 'Video',
  },
  views: {
    path: '/content-and-data/crm/views',
    title: 'Saved views',
  },
  webhooks: {
    path: '/marketing-and-automation/workflows-and-actions/webhooks',
    title: 'Webhooks',
  },
  whiteLabel: {
    path: '/workspace-and-billing/white-label',
    title: 'White-label',
  },
  workflows: {
    path: '/marketing-and-automation/workflows-and-actions/overview',
    title: 'Automation',
  },
  yourFirstApiCall: {
    path: '/guides/your-first-api-call',
    title: 'Your first API call',
  },
} as const satisfies Record<string, DocsHelpTopic>

export type DocsHelpTopicKey = keyof typeof DOCS_HELP_TOPICS

// Heading anchors present on each topic's docs page. Only topics with H2–H4
// headings appear; a topic absent here has no linkable anchors.
export const DOCS_HELP_ANCHORS = {
  abuseReports: ['#where-reports-come-from', '#triage-by-severity', '#csam', '#which-lever', '#statuses', '#disclosure', '#dmca', '#counter-notices', '#counter-notice-clock', '#counter-notice-steps', '#repeat-infringers', '#repeat-infringer-threshold', '#known-gaps', '#related'],
  account: ['#google-sign-in', '#sign-in-methods', '#signing-in-with-any-of-your-addresses', '#resetting-your-password', '#one-session-across-workspaces', '#automatic-sign-out-after-inactivity', '#when-the-console-asks-you-to-sign-in-again', '#recent-sign-ins', '#when-we-do-not-email-you', '#signing-a-device-out', '#passkeys', '#removing-one', '#blocked--possible-credential-copy', '#downloading-your-data', '#downloading-a-whole-workspace', '#closing-your-account'],
  actionsBuilder: ['#create-an-action', '#recipes', '#triggers', '#crm-events', '#only-run-when-a-field-matches', '#chain-multiple-conditions-andor', '#steps', '#crm-steps', '#step-conditions', '#sequences', '#run-history', '#what-is-and-isnt-recorded', '#interactions-from-the-besigner', '#when-to-use-which', '#related'],
  activities: ['#four-kinds-of-history', '#campaign-email', '#logging-an-activity', '#meeting-from-a-booking', '#click-to-call', '#sending-an-email', '#delivery-states', '#captured-email', '#where-an-activity-is-visible', '#the-recent-activity-feed', '#related'],
  addALocale: ['#steps', '#tips', '#related'],
  addOns: ['#what-you-can-add', '#assigning-register-seats', '#assigning-collaborator-seats', '#how-changes-bill', '#plan-switches-and-cancellation', '#related'],
  addSearch: ['#steps', '#tips', '#related'],
  aglynAssist: ['#what-it-can-do', '#answers-for-beginners-and-developers', '#offers-to-open-a-page', '#where-an-answer-came-from', '#answers-straight-from-the-documentation', '#message-limits', '#feedback', '#privacy'],
  aiAssist: ['#copy-assist', '#ai-generate-section', '#limits', '#related'],
  analytics: ['#pageview-tracking', '#visitors-approximate', '#traffic-card', '#traffic-delta', '#insights', '#campaign-tracking-utm', '#per-screen-traffic', '#dwell-time', '#google-analytics', '#related'],
  animations: ['#add-an-animation', '#presets', '#plays', '#duration-and-delay', '#easing', '#stagger-children', '#replay-each-time', '#animations-do-not-play-on-the-canvas', '#accessibility', '#speed-and-layout', '#if-a-visitor-has-javascript-turned-off'],
  architectureMultiTenancy: ['#the-model-in-one-sentence', '#data-model', '#authorization-one-read-per-request', '#membership-lifecycle', '#workspace-subdomains', '#which-hostnames-may-serve-the-console', '#attaching-a-workspaces-subdomain', '#billing--cost-attribution', '#related'],
  assistSignals: ['#the-workflow-this-board-exists-for', '#fleet', '#the-cache-read-rate-and-what-a-bad-number-looks-like', '#where-the-money-goes', '#docs-gaps', '#questions-the-docs-could-not-answer', '#what-people-actually-asked', '#what-assist-costs-by-workspace', '#reading-the-sample-honestly', '#related'],
  automations: ['#the-events', '#the-steps', '#assigning-an-owner-or-rotating-one', '#an-automated-email-on-the-timeline', '#recipes', '#installing-from-the-organization', '#example-tag-every-new-contact-from-a-form', '#example-spread-qualified-leads-across-the-team', '#example-follow-up-on-a-won-deal', '#related'],
  bandwidth: ['#what-each-plan-includes', '#where-to-see-it', '#paused', '#timing', '#reducing-bandwidth', '#reference', '#how-usage-is-counted', '#which-views-are-counted', '#the-two-mechanisms', '#what-a-visitors-browser-gets', '#fail-open-on-purpose', '#self-hosting', '#related'],
  besigner: ['#preview-vs-canvas', '#what-you-can-do', '#the-canvas', '#hierarchy-panel', '#the-inspector', '#inline-and-rich-text', '#reusable-components', '#editing-together', '#ai-in-the-canvas', '#related'],
  billing: ['#tiers--entitlements', '#enterprise', '#single-sign-on-and-enforcement', '#usage-meters', '#storage-overage', '#if-you-would-rather-uploads-stopped', '#assist-overage', '#stop-ai-assist-at-the-included-band', '#usage-budget', '#seats', '#crm-records', '#the-crm-suite', '#one-to-one-email', '#organization-data', '#api-access', '#payments', '#outstanding', '#plan-total', '#billing-email', '#payment-methods', '#billing-address', '#tax-ids', '#sales-tax', '#platform-fees', '#related'],
  bindings: ['#binding-tokens', '#rename-safe-id-tokens', '#insert-a-variable', '#token-pills', '#in-the-canvas-text-editor', '#typed-variables', '#no-code-functions', '#where-used--safety', '#workflows', '#related'],
  bookings: ['#set-up-bookings', '#taking-bookings', '#reminders', '#payments-and-fees', '#service-tax', '#manage', '#booking-from-the-crm', '#canceling-and-refunding', '#related'],
  buildABlog: ['#1-create-a-collection', '#delete-a-collection', '#2-write-entries', '#scheduling', '#authors', '#the-authors-own-page-in-search-and-in-a-share', '#links-a-reader-can-click', '#the-authors-page', '#designing-the-author-page', '#categories', '#visual-editor', '#3-design-the-pages-with-template-screens', '#blog-blocks', '#category-filtering', '#entry-tokens', '#no-template-still-designed', '#paginated-page-sets', '#build-your-own-pager', '#4-publish--syndicate', '#tips', '#related'],
  buildAndPublishASurvey: ['#1-create-the-dataset', '#2-add-a-screen-for-the-survey', '#3-insert-a-form-from-the-element-picker', '#4-configure-the-fields', '#5-point-the-form-at-the-dataset', '#6-publish', '#7-watch-responses-arrive', '#related'],
  buildAWorkflow: ['#1-open-the-workflows-page', '#2-choose-a-trigger', '#3-add-steps', '#4-save-and-test', '#tips', '#related'],
  buildingFeaturePlugins: ['#the-ui-half', '#the-console-half', '#how-the-shell-consumes-the-registry', '#routed-sections-agl-2501', '#which-registration-owns-a-path', '#gating-a-section', '#loading-org-gated-and-dynamic-agl-417', '#extending-beyond-pages-slots-providers-runtimes-hooks-agl-418419', '#remote-bundles-the-trusted-realm-tier-agl-420', '#the-server-half-api-routes', '#shared-server-runtime-aglyntenant-runtime', '#project-setup', '#reference-implementations'],
  bulkActions: ['#two-exports-and-the-difference-matters', '#contacts', '#the-contacts-file', '#companies', '#deals', '#tasks', '#leads', '#at-the-organization-level', '#when-a-row-cannot-be-changed', '#adding-people-to-an-audience', '#related'],
  catalog: ['#products-options-and-variants', '#billing-modes-and-subscriptions', '#categories-and-tags', '#collections', '#slugs', '#merchant-center-feed', '#related'],
  comingSoonLaunch: ['#1-build-the-coming-soon-page', '#the-notify-me-form', '#2-make-it-the-home-page', '#3-keep-everything-else-out-of-search', '#while-nothing-is-ready-the-site-wide-switch', '#once-youre-launching-page-by-page-per-screen-visibility', '#4-collect-the-signups', '#5-launch-day-reverse-every-step', '#6-verify-it-actually-worked', '#related'],
  commerce: ['#products-hub', '#inventory', '#reserved-stock', '#stock-movements', '#gift-cards', '#recovery-and-alerts', '#orders', '#orders-screen', '#order-statuses', '#order-money-tiles', '#a-lost-dispute', '#shipping--taxes', '#lodging-tax-on-reservations', '#storefront-sales-tax', '#destination-coverage', '#dropshipping', '#related'],
  commerceEndToEnd: ['#1-connect-payments', '#2-create-products', '#3-design-the-storefront', '#catalog-search-filters-and-sort', '#category-pages', '#the-product-page-template', '#4-what-checkout-does', '#paying-without-leaving-your-site', '#5-run-orders-from-the-console', '#6-subscriptions--the-stripe-portal', '#related'],
  companies: ['#the-companies-list', '#create-a-company', '#a-companys-page', '#contacts-at-a-company', '#linked-on-capture', '#import-from-csv', '#export-csv', '#deleting-a-company', '#who-can-see-a-company', '#files', '#related'],
  components: ['#promote', '#insert-instances', '#properties', '#declare-them', '#use-them', '#save-then-publish', '#fill-them-in-per-page', '#restyle-one-instance', '#override-an-attribute-on-one-instance', '#retrofit-duplicated-sections', '#detach', '#nesting', '#used-by', '#manage', '#copy--paste-vs-reusable-components', '#tips', '#related'],
  connectADomain: ['#steps', '#after-it-connects', '#your-aglyn-subdomain-afterwards', '#registrar-quick-reference', '#one-domain-per-site', '#disconnect', '#related'],
  consoleAndSite: ['#add-a-console-page', '#add-a-widget-to-a-shell-zone', '#wrap-every-console-page-providers', '#add-a-canvas-component-besigner--published-sites', '#add-a-site-runtime', '#troubleshooting'],
  consoleSearch: ['#what-it-searches', '#searching-from-the-organization', '#how-matching-works', '#what-it-does-not-search', '#why-a-group-sometimes-says-it-was-only-partly-searched'],
  consoleTour: ['#the-app-bar', '#in-context-help', '#primary-navigation', '#editing-vs-managing', '#the-sites-list', '#the-status-pill', '#how-the-pill-is-decided', '#your-site-allowance', '#a-sites-dashboard', '#next', '#workspace-settings--notifications', '#daily-digests', '#alerts-on-this-device'],
  contactRecord: ['#adding-a-contact-by-hand', '#the-record-page', '#deleting-and-erasing', '#what-each-site-keeps-to-itself', '#merging-two-records', '#likely-duplicates', '#owner', '#last-engaged', '#lifecycle-stages', '#where-the-persons-lead-is', '#finding-a-contact', '#files', '#related'],
  content: ['#site-templates--starter-gallery', '#section--block-library', '#content-collections--blog', '#related'],
  cookieConsent: ['#how-it-works', '#what-needs-consent', '#privacy-choices--the-persistent-control', '#where-the-choice-is-kept', '#global-privacy-control', '#previewing-what-visitors-see', '#turn-the-banner-off'],
  copyAssist: ['#use-it', '#tips', '#related'],
  copyPaste: ['#copy', '#paste', '#between-documents', '#copy--paste-vs-duplicate-vs-reusable-components', '#shortcuts', '#related'],
  createARedirect: ['#add-a-rule', '#read-hit-metrics', '#related'],
  crm: ['#whats-in-the-crm-area', '#unified-ingestion', '#what-each-plan-includes', '#the-contacts-page', '#import-from-csv', '#segments', '#everywhere-the-crm-shows-up', '#capture-replies', '#at-the-organization-level', '#who-can-open-the-crm', '#related'],
  customDomains: ['#connect-a-domain', '#related'],
  customFields: ['#define-a-field', '#fields-per-record', '#where-values-show', '#save-a-form-field', '#over-the-api', '#retire-restore-delete', '#recompute-next-activity', '#related'],
  customRoles: ['#create-a-custom-role', '#effective-permissions', '#per-member-overrides', '#tips', '#related'],
  datasets: ['#model-builder', '#typed-documents', '#relations', '#query-layer', '#repeatable-components', '#who-a-dataset-is-shared-with', '#import--export', '#related'],
  datasetsAndSchema: ['#display-names-vs-field-ids', '#naming--describing-fields', '#the-typed-model', '#record-quotas-per-plan', '#import--export', '#repeatables', '#everything-that-writes-records', '#deleting-a-dataset', '#related'],
  deals: ['#pipelines', '#stages', '#the-board-and-the-table', '#import-from-csv', '#creating-a-deal', '#line-items', '#moving-winning-and-losing', '#a-won-deal-makes-its-contact-a-customer', '#a-deals-page', '#files', '#related'],
  designedEmails: ['#create-a-template', '#styling-email-blocks', '#merge-tokens', '#send-it', '#the-plain-text-version'],
  domainProviders: ['#choosing', '#limits', '#contract', '#wildcard', '#wildcard-dns', '#wildcard-certificates', '#wildcard-proxy', '#wildcard-env', '#wildcard-verify', '#wildcard-honesty', '#webhook', '#webhook-request', '#webhook-replies', '#webhook-bad-answers', '#webhook-rules', '#webhook-traefik', '#unconfigured', '#status-states', '#completer', '#migrating', '#migrating-webhook', '#migrating-down', '#migrating-vercel', '#related'],
  downgradingAndCanceling: ['#when-changes-take-effect', '#downgrading-to-a-lower-plan', '#pending-downgrade', '#keep-my-current-plan', '#what-changes-on-a-downgrade', '#canceling-your-subscription', '#the-cancel-dialog', '#deleting-a-single-site', '#deleting-your-organization', '#related'],
  dragDropHierarchy: ['#where-you-can-drag', '#what-a-drag-does', '#drop-zones-edges-vs-center', '#containers-vs-leaf-elements', '#containers-accept-children', '#leaf-elements-dont--dropping-on-one-makes-a-sibling', '#adding-a-new-element', '#when-a-drop-is-rejected', '#moving-an-element-without-dragging', '#multi-drag', '#tips', '#related'],
  editFromTheLiveSite: ['#call-it-up', '#connect-your-access', '#the-bar', '#good-to-know', '#related'],
  editYourTheme: ['#open-the-editor', '#set-colors-and-fonts', '#it-follows-you-into-the-besigner', '#tips', '#related'],
  elementCatalog: ['#finding-an-element', '#element-search', '#element-detail', '#layout', '#the-pages-main-landmark', '#every-container-can-be-a-semantic-element', '#which-link-groups-want-to-be-a-nav', '#header-and-footer-for-your-site-chrome', '#grid', '#surface', '#accordion', '#navigation', '#where-a-link-opens', '#tabs', '#tabs-that-go-to-another-screen', '#pagination', '#text', '#data-display', '#media', '#image-list', '#forms-input-commerce-members', '#related'],
  emailCampaigns: ['#send-a-campaign', '#campaigns-group-emails', '#what-belongs-to-a-campaign', '#who-the-email-comes-from', '#sending-domains', '#account-email-always-sends', '#marketing-needs-a-domain', '#two-ways-to-get-a-domain', '#a-domain-we-set-up-is-a-request', '#domain-states', '#senders', '#send-a-test', '#preview-the-email', '#monthly-send-cap', '#personalize-with-merge-tags', '#recipient-count', '#who-a-campaign-is-allowed-to-reach', '#schedule-a-send', '#email-lists', '#manual-lists', '#list-members', '#add-to-a-list', '#import-a-list', '#remove-from-a-list', '#lists-built-from-a-rule', '#experiments', '#opens--clicks', '#the-campaign-report', '#per-contact-engagement', '#which-links-were-clicked', '#revenue-from-a-campaign', '#compliance', '#topics', '#preference-page', '#frequency-opt-down', '#double-opt-in', '#marketing-mail', '#frequency-cap', '#suppressions', '#add-a-suppression', '#platform-suppressions', '#related'],
  emailTemplates: ['#templates-and-snippets', '#merge-fields', '#saving', '#managing-templates', '#shared-or-personal', '#over-the-rest-api', '#related'],
  enterprise: ['#what-enterprise-does-not-change', '#getting-enterprise'],
  errorScreens: ['#the-error-screens', '#design-one', '#what-the-built-in-fallback-gives-you', '#error-screens-are-free', '#tips', '#related'],
  events: ['#manage-events', '#show-events-on-a-screen', '#search-engines', '#related'],
  featureFlags: ['#how-a-flag-is-evaluated', '#how-gating-behaves', '#managing-flags', '#under-the-hood', '#a-flag-is-not-always-sufficient-on-its-own'],
  firstPlugin: ['#1-scaffold', '#2-write-the-entry', '#3-develop-against-a-live-workspace', '#4-verify', '#5-publish', '#6-install-enable-load', '#7-uninstall', '#troubleshooting'],
  forms: ['#reading-submissions-from-code', '#build-a-form', '#monthly-allowance-per-plan', '#spam-and-abuse-protection', '#the-per-site-monthly-ceiling', '#field-types', '#labels-and-placeholders', '#example-a-quick-survey', '#after-submit', '#example-grow-an-email-list-from-a-signup-form', '#where-submissions-go', '#the-inbox', '#who-a-submission-is-from', '#where-this-one-went', '#replying-to-a-submission', '#one-forms-own-page', '#related'],
  generateSection: ['#use-it', '#tips', '#related'],
  gettingStarted: ['#create-your-first-site', '#what-a-site-contains', '#switching-between-sites', '#next'],
  glossary: ['#the-hierarchy', '#organization-org', '#workspace', '#tenant', '#tenant-vs-host--not-the-same-thing', '#quick-reference'],
  googleAnalytics: ['#setup', '#consent', '#automatic', '#engagement', '#commerce', '#web-vitals', '#authored-events', '#never-sent', '#related'],
  import: ['#three-steps', '#what-each-column-can-hold', '#what-is-skipped-and-why', '#related'],
  importExport: ['#export', '#export-contents', '#large-exports', '#import', '#upsert-on-a-key-field', '#tips', '#related'],
  injectionZones: ['#widgetid-is-a-persisted-identifier'],
  installYourFirstPlugin: ['#before-you-start', '#step-1-open', '#step-2-browse', '#step-3-reviews', '#step-4-targeting', '#step-5-install', '#step-6-use', '#step-7-off', '#what-to-do-next', '#related'],
  interactions: ['#fluent-interactions', '#interactions-belong-to-the-page-they-are-on', '#plan-availability', '#pick-the-target-by-clicking', '#interaction-cookbook', '#analytics-event-step', '#analytics-event-name', '#analytics-event-parameters', '#analytics-event-delivery', '#custom-html-block', '#related'],
  inviteTeammates: ['#invite-someone', '#pending-invites', '#who-gets-told', '#accepting-an-invite', '#an-invitation-never-changes-who-owns-the-workspace', '#how-team-members-act', '#you-are-a-site-collaborators-support-channel', '#help-a-teammate-who-is-locked-out', '#why-you-cant-always-set-a-password', '#activity-log', '#tips', '#related'],
  languageSwitcher: ['#steps', '#tips', '#related'],
  layouts: ['#what-a-layout-is', '#nested-layouts', '#used-by', '#layouts-vs-reusable-components', '#related'],
  leads: ['#what-makes-a-lead', '#the-leads-list', '#working-a-lead-from-the-row', '#several-leads-at-once', '#export-csv', '#import-from-csv', '#who-owns-a-lead', '#a-leads-page', '#converting-a-lead', '#unqualifying-a-lead', '#erasing-the-person', '#who-can-do-this', '#related'],
  liveCoEditing: ['#whos-here', '#presence-colors', '#per-version-rooms', '#presence-in-lists', '#not-a-lock', '#editing-together', '#saving-together', '#when-a-save-is-refused', '#local-draft-recovery', '#the-save-button-always-answers', '#related'],
  lockdown: ['#what-a-lockdown-does', '#reasons-and-the-notice', '#read-only-mode', '#what-reads-keep-working-does-and-does-not-cover', '#read-only-timing', '#read-only-evidence', '#read-only-revocation-evidence', '#a-gentler-lock-never-softens-a-stricter-one', '#enforcement', '#maintenance-windows-and-expiry', '#who-keeps-access-the-un-panic-invariant', '#feature-scope', '#signups-also-refuses-account-creation--if-the-valve-is-armed', '#domain-scope', '#device-scope', '#asset-quarantine--one-file-not-the-site-that-serves-it', '#which-digest', '#quarantine-keys', '#quarantine-audiences', '#disabled-files-page', '#deny-list', '#quarantine-curl', '#quarantine-history', '#tenant-api-coverage', '#analytics-beacon', '#operating-it', '#never-take-a-lock-or-a-lift-on-trust', '#what-a-caller-is-told', '#drill-provenance', '#production-drill-blocked', '#verifying-a-lockdown-on-the-wire', '#what-the-audit-row-records', '#the-live-dunning-schedule-has-not-been-read-agl-2430', '#what-the-live-dashboard-did-say-once-someone-opened-it-agl-2430', '#-include-a-link-for-customers-to-manage-their-subscriptions-stays-off', '#the-billing-recovery-path-must-survive-a-billing-lock'],
  longFormMarkdown: ['#the-markdown-element', '#what-the-markdown-supports', '#the-table-of-contents-element', '#how-it-finds-the-markdown', '#heading-links', '#related'],
  maintenance: ['#is-the-job-still-running', '#running-a-job-by-hand', '#the-jobs', '#audit-archive', '#plugin-artifact-reaper', '#plugin-verdict-re-verification', '#jobs-that-live-elsewhere', '#related'],
  maintenanceMode: ['#turn-it-on', '#tips', '#related'],
  manageAccount: ['#account', '#sign-in-methods', '#email-addresses', '#what-each-address-does', '#removing-an-address', '#if-your-organization-uses-single-sign-on', '#profile-image', '#basic-info', '#contact-details', '#security', '#related'],
  manifestAndEnvs: ['#plugin-manifest-published-with-every-version', '#config--settings-without-writing-a-settings-screen', '#listing--version-documents', '#review--trust-lifecycle', '#environment-variables', '#pluginsconfigjson-first-party-contributors'],
  marketingOverlays: ['#announcement-bar', '#promotional-popups', '#frequency', '#popup-v2', '#multiple-overlays-scheduling--page-targeting', '#engagement-stats', '#related'],
  media: ['#organize', '#tags', '#upload', '#size-and-plan-limits', '#edit-images', '#download-file', '#deliver-over-cdn', '#urls-are-stable', '#page-elements-point-at-the-asset-not-at-a-link', '#hotlinking-and-your-visitors', '#delivery-line', '#who-an-asset-is-shared-with', '#private-files', '#approved-image-hosts', '#adding-an-approved-image-host', '#approved-image-host-troubleshooting', '#reference', '#variant-widths', '#tag-limits', '#over-the-api', '#components', '#related'],
  megaMenuWithInteractions: ['#what-youll-build', '#1-insert-the-mega-menu', '#2-build-the-columns', '#3-make-it-open-on-hover', '#prefer-primitives-insert-the-dropdown-panel-preset', '#4-add-a-mobile-drawer-optional', '#5-test-and-publish', '#how-it-works-under-the-hood', '#troubleshooting', '#related'],
  members: ['#1-turn-user-accounts-on-for-the-site', '#2-the-built-in-sign-in-and-sign-up-pages', '#3-design-an-account-page', '#4-gate-screens-to-members', '#gate-part-of-a-page-not-all-of-it', '#5-manage-members-from-the-console', '#suspend--reactivate', '#password-help', '#related'],
  membersOnly: ['#let-visitors-sign-up', '#sign-in-sign-up-and-recovery-pages', '#forgotten-passwords', '#gate-a-screen', '#manage-your-members', '#suspend-or-reactivate-a-member', '#tips', '#related'],
  menusAndNavigation: ['#dropdown-menu', '#mega-menu', '#drawer--menu-button', '#the-mobile-nav-preset', '#the-dropdown-panel-preset', '#interactions-for-menus', '#responsive-visibility', '#related'],
  migrationPatterns: ['#renamed-a-screen', '#consolidated-pages', '#moved-a-site-into-aglyn', '#avoiding-loops', '#related'],
  modelBuilder: ['#define-the-model', '#display-name-vs-reference-id', '#edit-records', '#tips', '#related'],
  multilingual: ['#locale-variants', '#hreflang--discovery', '#language-switcher', '#related'],
  multiSelect: ['#select-multiple', '#move-the-whole-selection', '#what-the-inspector-shows', '#tips', '#related'],
  onboardingDeepLinks: ['#the-contract', '#what-the-console-does-with-it', '#rules-this-parser-follows-and-why', '#known-gap'],
  passwordAScreen: ['#steps', '#password-vs-members-only', '#related'],
  platformHealth: ['#three-states-never-two', '#the-probes', '#serving', '#backups--exports', '#rate-limiters', '#signup-volume', '#email-delivery', '#csp-violations', '#sharing-scope-drift', '#pending-erasures', '#people-waiting-beside-the-workspaces', '#idempotency-claims', '#resolved-server-config', '#when-the-configured-text-does-not-mean-what-it-says', '#values-are-never-shown', '#re-checking', '#related'],
  pluginConfig: ['#layers', '#declare', '#field-types', '#read', '#no-schema', '#resolution', '#console-ui', '#api', '#related'],
  pluginManagerApi: ['#console-extensions--feature-plugins', '#loading--plugin-loader', '#server-apis--api-plugins-server-only', '#site-pipeline--site-runtime-site-page-hooks-server-for-hooks', '#stylesheets--plugin-styles', '#billing--billing-webhook-hooks-server', '#enablement-flags-config-fields-permissions-jobs', '#remote-bundles--realm-plugins-isomorphic-realm-server-server', '#sandbox--plugin-bridge'],
  plugins: ['#install--upgrade', '#browse-card', '#whats-included', '#what-the-badges-on-a-listing-mean', '#how-plugins-run', '#when-one-plugin-depends-on-another', '#a-dependency-that-is-off-for-one-site', '#configure', '#configure-site', '#publish-your-own', '#related'],
  pos: ['#registers', '#the-register', '#platform-fees-at-the-register', '#selling-past-the-count', '#when-something-disconnects', '#reservations', '#related'],
  publishAPlugin: ['#the-publish-pipeline', '#private-plugins', '#paid-listings', '#your-publisher-profile', '#tips', '#related'],
  publisherHandbook: ['#before-your-first-publish', '#the-publisher-agreement', '#where-to-publish-from', '#what-installing-each-type-does', '#rules-an-email-starter-has-to-meet', '#publishing-a-version', '#before-you-publish', '#review-what-happens-after-you-publish', '#the-two-badges-and-what-each-one-promises', '#asking-to-be-verified', '#testing-a-version-before-it-is-approved', '#watching-your-own-submission', '#disabled-versions', '#private-plugins', '#authoring-your-listing', '#what-your-listing-can-say-about-aglyn', '#versioning--updates', '#shipping-a-new-version', '#how-installs-work-the-buyer-side', '#getting-paid', '#low-prices-and-processing'],
  publishYourFirstScreen: ['#1-create-a-screen', '#2-design-it-in-the-besigner', '#3-preview-and-publish', '#how-fast-changes-go-live', '#next'],
  realmBundles: ['#build-against-the-host-abi', '#the-chain-that-runs-before-a-byte-executes', '#granting-trust-staff', '#where-realm-bundles-load', '#key-rotation', '#troubleshooting'],
  redirects: ['#manage-redirects', '#sending-visitors-to-another-site', '#metrics', '#match-modes-v2', '#related'],
  refunds: ['#where-it-is', '#how-much-you-can-refund', '#you-see-your-limit', '#enforced-on-the-server', '#issuing-a-refund', '#a-refund-is-a-loss', '#what-it-refuses', '#what-is-recorded', '#in-revenue', '#what-this-is-not', '#related'],
  relations: ['#reference-fields', '#many-to-many', '#using-relations', '#tips', '#related'],
  reportAnIssue: ['#is-it-us-or-your-site', '#what-to-write', '#a-bug', '#an-idea', '#a-question', '#length-caps', '#what-gets-attached-for-you', '#being-contacted', '#where-it-goes', '#when-it-does-not-send', '#rate-limits', '#verified-email', '#something-went-wrong-on-our-side', '#related'],
  reports: ['#choosing-a-period', '#contacts', '#sources-and-lifecycle', '#conversion-by-source', '#lead-funnel', '#pipeline', '#forecast-by-close-month', '#won-and-lost', '#won-and-lost-by-owner', '#activity-by-teammate', '#tasks', '#exporting-a-table', '#crm-at-a-glance', '#how-the-numbers-are-counted', '#related'],
  responsiveStyling: ['#style-per-breakpoint', '#mute-a-style', '#interaction-states', '#you-can-see-the-state-while-you-style-it', '#fields-you-dont-touch-keep-inheriting', '#states-and-breakpoints-combine', '#focus-state', '#box-stylers', '#spacing-side-names', '#spacing-units', '#spacing-steps', '#spacing-custom-amounts', '#unit-px', '#unit-rem', '#unit-em', '#unit-percent', '#unit-ch', '#unit-viewport', '#unit-small-viewport', '#style-groups', '#borders-without-css', '#picking-a-font', '#gradient-backgrounds', '#visibility-per-device-band', '#scheme-scoped-colors', '#custom-classes', '#custom-css-sx', '#semantic-sections--theme-mode', '#edit-json-for-one-element'],
  revenue: ['#the-two-bases', '#how-each-org-is-treated', '#the-gap', '#where-the-money-came-from', '#gross-versus-net', '#three-costs-the-page-flags-but-does-not-net-out', '#rows-that-need-attention', '#related'],
  runAnAgencyWorkspace: ['#the-model', '#step-1-plan', '#step-2-templates', '#step-3-access', '#step-4-domains', '#step-5-backups', '#step-6-billing', '#step-7-automate', '#checklist', '#related'],
  salesTaxReturn: ['#choosing-the-period', '#rows-that-need-attention', '#which-rows', '#rows-that-are-excluded-rather-than-flagged', '#where-this-deployment-files', '#tax-filing-precedence', '#tax-filing-secrecy', '#the-figures', '#taxable-purchases', '#refunds', '#aglyns-own-sales-by-jurisdiction', '#facilitated-sales-by-buyer-state', '#exporting-the-working-papers', '#related'],
  sandboxSecurity: ['#a-separate-origin', '#per-manifest-network-policy', '#when-you-cant-declare-the-origin', '#pinned-immutable-artifacts', '#what-this-means-when-you-build', '#related'],
  saveATemplate: ['#start-from-a-template', '#where-to-find-it', '#save-your-site-as-a-template', '#saving-a-single-page-instead', '#tips', '#related'],
  screens: ['#screens--routing', '#what-counts-against-your-screen-allowance', '#error--maintenance-screens', '#related'],
  screensAndLayouts: ['#which-one-do-you-want', '#related'],
  securityAndCompliance: ['#what-it-covers', '#contract-documents', '#legal-reacceptance', '#why-the-gaps-are-listed-first', '#reporting-a-vulnerability'],
  selfHosting: ['#the-short-version', '#the-full-runbook', '#who-runs-this-install', '#your-dmca-position-is-your-own', '#addresses', '#tenant-domain', '#tenant-host-cname', '#console-url', '#aglyn-standalone', '#reverse-proxy', '#platform-brand', '#optional-keys', '#scheduled-jobs', '#issue-reports', '#request-geo', '#bucket-cors', '#docs-build', '#honest-limits', '#related'],
  selfHostingEnvironment: ['#build-vs-runtime', '#firebase', '#firebase-client', '#firebase-admin', '#firebase-unused', '#firestore-storage', '#addresses', '#proxy', '#xff', '#geo', '#secrets', '#sso', '#auth-settings', '#stripe', '#stripe-webhook-events', '#stripe-prices', '#billing-switches', '#email', '#analytics', '#assist', '#cron', '#plugins', '#plugin-loader', '#operator', '#brand', '#tax', '#tax-collection', '#tax-filing', '#tax-what-to-do', '#caching', '#domains', '#domains-wildcard', '#domains-webhook', '#domains-vercel', '#domains-custom', '#vercel', '#docs-build', '#image-set', '#build-stamp', '#internal', '#related'],
  seo: ['#per-screen-seo', '#how-a-page-title-is-built', '#site-wide-defaults', '#search-engine-visibility', '#the-whole-site', '#a-single-page', '#sitemap--robots', '#one-index-one-file-per-section', '#social-cards', '#structured-data', '#ai-agents', '#markdown-for-any-page', '#llmstxt', '#openapijson', '#well-knownapi-catalog', '#crawler-access', '#analytics-integration', '#related'],
  serverApis: ['#an-api-route', '#webhooks-with-signature-verification', '#platform-billing-events', '#scheduled-jobs', '#lockdown--lockdown-is-required', '#troubleshooting'],
  settings: ['#companies', '#create-companies-from-work-email-domains', '#default-owner', '#assignment-rules', '#round-robin', '#email-templates', '#email-capture', '#recipes', '#related'],
  siteProtection: ['#where-these-controls-live', '#per-screen-passwords', '#custom-error-screens', '#maintenance-mode', '#related'],
  siteSearch: ['#how-it-works', '#what-it-searches', '#the-layout-built-in-pages-use', '#configure-it', '#related'],
  sso: ['#setting-it-up', '#1-verify-your-domain', '#2-connect-your-identity-provider', '#rotating-your-signing-certificate', '#3-turn-it-on', '#how-it-works', '#enforcement', '#you-must-keep-one-way-in-that-does-not-go-through-your-idp', '#an-owner-who-signs-in-outside-your-identity-pool', '#or-a-break-glass-account-inside-the-pool', '#transferring-ownership-while-you-are-enforcing', '#if-we-cannot-check', '#consequences-worth-knowing-before-you-switch', '#testing-it', '#related'],
  staffConsole: ['#runbooks', '#whats-there', '#staff-overview', '#support-queue', '#plugin-reviews', '#organizations-admin', '#free-workspace-limit', '#entitlement-editor', '#users-admin', '#password-help', '#sign-one-device-out', '#email-delivery', '#import-delivery-history', '#staff-notes', '#broadcast-announcements', '#billing-insight', '#refunds', '#impersonation', '#system-emails', '#platform-send-rate', '#feature-flags', '#multi-tenant-architecture', '#audit-archival', '#organization-suspension', '#sales-tax-return', '#audit-log', '#coupons', '#contact-suppressions', '#access', '#which-identity-holds-staff', '#staff-inside-a-customers-tenant--a-property-worth-knowing', '#offboarding', '#break-glass-access', '#requiring-sso-for-a-company-domain', '#why-am-i-getting-a-404', '#related'],
  supportAndCommunity: ['#support-tickets', '#ticket-status', '#what-to-include', '#community-forum', '#related'],
  supportQueue: ['#triage', '#notifications', '#related'],
  supportTiers: ['#why-enterprise-is-in-hours-not-business-days', '#what-starts-and-stops-the-clock', '#where-to-see-it'],
  supportTriage: ['#why-this-exists', '#1-order-the-queue', '#not-a-support-ticket', '#3-the-billing-answers', '#4-acting-on-the-customers-account', '#escalation', '#related'],
  tasks: ['#the-tasks-page', '#the-calendar-view', '#snoozing-a-task', '#selecting-exporting-and-acting-on-many', '#import-from-csv', '#creating-a-task', '#assigning-a-task-to-someone-else', '#completing-and-reopening', '#organization-tasks', '#tasks-on-a-contact-company-or-deal', '#reminders', '#turning-reminders-off', '#next-activity', '#the-daily-digest', '#turning-it-off', '#the-dashboard-card', '#who-can-do-what', '#related'],
  team: ['#team-roles', '#organizations', '#three-kinds-of-user', '#site-roles', '#what-a-site-collaborator-sees', '#site-membership', '#visitor-record-ceiling', '#seats', '#related'],
  templatesLibrary: ['#the-three-kinds', '#installing-from-the-marketplace', '#saving-something-as-a-template', '#using-a-template', '#where-a-template-came-from', '#first-party-starters', '#templates-are-per-site', '#deleting', '#related'],
  termReference: ['#platform--accounts', '#aglyn', '#organization-org', '#workspace', '#tenant', '#host', '#site', '#console', '#staff-console', '#member', '#custom-role', '#publisher', '#sites--content', '#screen', '#layout', '#slug', '#version', '#redirect', '#error-screens', '#maintenance-mode', '#locale', '#site-template', '#theme', '#custom-domain', '#subdomain', '#the-node-tree', '#node', '#tree', '#tree-root', '#trunk', '#stem', '#branch', '#leaf', '#component', '#component-bundle', '#preset', '#reusable-component', '#lineal-placement-rules', '#besigner-the-editor', '#besigner', '#canvas', '#hierarchy-panel', '#drawer', '#binding', '#plugins--marketplace', '#plugin', '#add-on', '#surface', '#console-extension', '#widget', '#injection-zone', '#plugin-manifest', '#enabled-plugins', '#feature-flag', '#release-flag', '#plugin-config', '#plugin-permission', '#plugin-job', '#listing', '#install', '#realm-bundle', '#sandbox', '#host-abi', '#review-queue', '#data--logic', '#dataset', '#record', '#field', '#relation', '#contact', '#segment', '#media-library', '#variable', '#function-fx', '#form', '#automation--marketing', '#event', '#workflow', '#action', '#automation', '#overlay', '#experiment', '#email-campaign', '#designed-email', '#merge-tag', '#commerce', '#product', '#order', '#pos', '#booking', '#billing--plans', '#plan', '#entitlement', '#quota', '#seat', '#metered-usage'],
  textEditing: ['#edit-inline', '#committing', '#inline-toolbar', '#rich-text', '#the-text-attribute', '#text-field-read-only', '#remove-formatting', '#line-breaks', '#bindings-in-text', '#limits', '#wrapped-outlines', '#related'],
  themeBuilder: ['#edit-your-theme', '#related'],
  themeStyles: ['#why-a-name-beats-a-number', '#text-style-sets-everything-at-once', '#what-your-theme-offers', '#colors-spacing-and-shadows', '#checking-a-page-you-already-built'],
  troubleshooting: ['#checklist', '#verified-but-not-serving', '#the-site-loads-for-some-people-and-not-others', '#still-stuck', '#related'],
  uptimeAndStatus: ['#the-status-page', '#there-is-no-committed-uptime-percentage', '#where-the-platform-runs', '#reporting-an-outage'],
  versionsAndPublishing: ['#the-versions-dialog', '#publish--roll-back', '#scheduled-publishing', '#plan-requirements', '#related'],
  video: ['#video-source', '#video-preload', '#video-captions', '#video-lightbox', '#video-seo', '#related'],
  views: ['#the-views-control', '#a-view-is-a-link', '#filters-on-the-contacts-list', '#columns-and-sort', '#segments-and-views', '#who-sees-what', '#related'],
  webhooks: ['#outbound-webhooks', '#inbound-webhooks', '#tips', '#related'],
  whiteLabel: ['#where', '#fields', '#where-you-see-it', '#email', '#merge-tokens', '#email-logo', '#sending-address', '#custom-console-domain', '#platform-brand', '#related'],
  workflows: ['#workflows', '#actions-builder', '#webhooks', '#run-history', '#related'],
  yourFirstApiCall: ['#step-1-create-a-key', '#step-2-check-the-key', '#step-3-your-first-request', '#in-javascript', '#step-4-write-something', '#idempotency', '#step-5-page-through-everything', '#the-four-errors-you-will-hit', '#where-to-go-next', '#related'],
} as const satisfies Partial<
  Record<DocsHelpTopicKey, readonly `#${string}`[]>
>

type AnchorMap = typeof DOCS_HELP_ANCHORS

/** Valid heading anchors for a topic (`never` when the page has none). */
export type DocsHelpAnchor<K extends DocsHelpTopicKey> =
  K extends keyof AnchorMap ? AnchorMap[K][number] : never
