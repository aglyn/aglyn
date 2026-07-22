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
  /** Verbatim docs frontmatter description — the tooltip excerpt. */
  excerpt: string
}

export const DOCS_HELP_TOPICS = {
  account: {
    path: '/workspace-and-billing/signing-in-and-sessions',
    title: 'Signing In & Sessions',
    excerpt: 'How console sign-in works — Google sign-in on desktop and mobile, one session across all your workspaces, and automatic sign-out after inactivity.',
  },
  actionsBuilder: {
    path: '/marketing-and-automation/workflows-and-actions/actions-builder',
    title: 'Actions builder',
    excerpt: 'Map a single event to a single action without building a full workflow.',
  },
  addALocale: {
    path: '/building-sites/multilingual/add-a-locale',
    title: 'Add a locale',
    excerpt: 'Create a language variant of your site and translate its screens.',
  },
  addOns: {
    path: '/workspace-and-billing/billing-and-plans/add-ons',
    title: 'Add-ons',
    excerpt: 'Buy extra seats, sites, datasets, POS registers, and the Event Calendar from the Billing page — prorated, self-serve, no support ticket.',
  },
  addSearch: {
    path: '/building-sites/site-search/add-search',
    title: 'Add search to your site',
    excerpt: 'Drop the Search Box element onto a screen and publish — the built-in search page does the rest.',
  },
  aiAssist: {
    path: '/marketing-and-automation/ai-assist/overview',
    title: 'AI Assist',
    excerpt: 'Generate and rewrite copy, and build whole sections, with AI inside the Besigner.',
  },
  analytics: {
    path: '/marketing-and-automation/analytics/overview',
    title: 'Analytics',
    excerpt: 'Built-in pageview analytics, traffic insights, and per-screen metrics.',
  },
  architectureMultiTenancy: {
    path: '/staff-console/architecture-multi-tenancy',
    title: 'Architecture: Multi-Tenant Organizations',
    excerpt: 'How Aglyn organizes tenants — org workspaces, membership with per-site access, security rules, subdomains, and billing attribution.',
  },
  besigner: {
    path: '/building-sites/besigner/overview',
    title: 'The Besigner',
    excerpt: 'Aglyn\'s visual editor — canvas, hierarchy, inline text, multi-select, and placement rules.',
  },
  billing: {
    path: '/workspace-and-billing/billing-and-plans/overview',
    title: 'Billing & Plans',
    excerpt: 'How Aglyn\'s tiers, entitlements, quotas, usage meters, and seat add-ons work.',
  },
  bindings: {
    path: '/building-sites/bindings/overview',
    title: 'Bindings, Variables & Functions',
    excerpt: 'Live values in your content — typed variables, no-code functions, and rename-safe id tokens.',
  },
  bookings: {
    path: '/commerce-and-bookings/bookings/overview',
    title: 'Bookings & Scheduling',
    excerpt: 'Offer services with availability, let visitors book, take payment, and send reminders.',
  },
  buildABlog: {
    path: '/building-sites/site-templates/build-a-blog',
    title: 'Build a blog',
    excerpt: 'Create a collection, publish rich entries, and design the list and entry pages with template screens.',
  },
  buildAndPublishASurvey: {
    path: '/guides/build-and-publish-a-survey',
    title: 'Build & publish a survey',
    excerpt: 'Create a dataset with a typed schema, design a survey form with dropdowns, radios, checkboxes, and a star rating, publish it, and watch responses arrive.',
  },
  buildAWorkflow: {
    path: '/marketing-and-automation/workflows-and-actions/build-a-workflow',
    title: 'Build a workflow',
    excerpt: 'Create a multi-step workflow that runs when a site event fires.',
  },
  buildingFeaturePlugins: {
    path: '/developers/plugins/building-feature-plugins',
    title: 'Building feature plugins',
    excerpt: 'The console-extension + frontend-UI plugin pair pattern for shipping features as plugins.',
  },
  catalog: {
    path: '/commerce-and-bookings/commerce/catalog',
    title: 'Product catalog',
    excerpt: 'Products with options and variants, categories, tags, and manual or smart collections.',
  },
  commerce: {
    path: '/commerce-and-bookings/commerce/overview',
    title: 'Commerce',
    excerpt: 'Sell physical, digital, and service products with a full catalog, orders pipeline, shipping, taxes, and your own Stripe account.',
  },
  commerceEndToEnd: {
    path: '/guides/commerce-end-to-end',
    title: 'Commerce end to end',
    excerpt: 'Create products with billing modes, design the storefront with Commerce blocks, take Stripe checkout for one-time and subscription sales, and run orders from the console.',
  },
  components: {
    path: '/building-sites/besigner/reusable-components',
    title: 'Reusable components',
    excerpt: 'Promote a subtree into a reusable component and insert instances across screens.',
  },
  connectADomain: {
    path: '/building-sites/custom-domains/connect-a-domain',
    title: 'Connect a domain',
    excerpt: 'Point your own domain at your Aglyn site with a CNAME and DNS verification.',
  },
  consoleAndSite: {
    path: '/developers/plugins/guides/console-and-site',
    title: 'Guide: console extensions & site surfaces',
    excerpt: 'Task-ordered recipes for nav/pages/widgets/providers and canvas components/site runtimes.',
  },
  consoleTour: {
    path: '/getting-started/console-tour',
    title: 'The console tour',
    excerpt: 'Where things live in the Aglyn console app bar and navigation.',
  },
  contacts: {
    path: '/content-and-data/contacts/overview',
    title: 'Contacts CRM',
    excerpt: 'A unified contacts list ingested from forms, members, orders, and bookings — with tags, notes, and segments.',
  },
  content: {
    path: '/building-sites/site-templates/overview',
    title: 'Templates, Blocks & Content',
    excerpt: 'Start from templates, drop in pre-built sections and blocks, and publish a blog with collections.',
  },
  copyAssist: {
    path: '/marketing-and-automation/ai-assist/copy-assist',
    title: 'Copy assist',
    excerpt: 'Generate and rewrite text for any canvas text prop with AI.',
  },
  createARedirect: {
    path: '/building-sites/redirects/create-a-redirect',
    title: 'Create a redirect',
    excerpt: 'Add a redirect rule and read its hit metrics.',
  },
  customDomains: {
    path: '/building-sites/custom-domains/overview',
    title: 'Custom Domains',
    excerpt: 'Connect your own domain with a self-service wizard and DNS verification.',
  },
  customRoles: {
    path: '/workspace-and-billing/teams-and-roles/custom-roles',
    title: 'Custom roles & permissions',
    excerpt: 'Define roles with unique permission sets and fine-tune access per member.',
  },
  datasets: {
    path: '/content-and-data/datasets/overview',
    title: 'Datasets & Dynamic Content',
    excerpt: 'Model structured content with typed fields and relations, then bind it into repeatable components.',
  },
  datasetsAndSchema: {
    path: '/guides/datasets-and-schema',
    title: 'Datasets & schema deep-dive',
    excerpt: 'Field ids vs display names, the typed model, per-plan record quotas, import/export, repeatables with item bindings, and every writer that can append records.',
  },
  designedEmails: {
    path: '/marketing-and-automation/email-campaigns/designed-emails',
    title: 'Designed emails',
    excerpt: 'Build campaign emails in the besigner with email-safe blocks and merge tokens — no separate editor.',
  },
  downgradingAndCanceling: {
    path: '/workspace-and-billing/billing-and-plans/downgrading-and-canceling',
    title: 'Downgrading, canceling & your data',
    excerpt: 'What happens to your sites, files, and data when you downgrade, cancel, or delete — and how to export first.',
  },
  dragDropHierarchy: {
    path: '/building-sites/besigner/drag-drop-hierarchy',
    title: 'Drag-and-drop hierarchy',
    excerpt: 'Everything drag-and-drop in the Besigner — where you can drag, how drop zones and placement markers work, containers vs. leaf elements, placement rules, and multi-drag.',
  },
  editYourTheme: {
    path: '/building-sites/theme-builder/edit-your-theme',
    title: 'Edit your theme',
    excerpt: 'Set colors, fonts, and light/dark schemes with a live preview.',
  },
  emailCampaigns: {
    path: '/marketing-and-automation/email-campaigns/overview',
    title: 'Email Campaigns',
    excerpt: 'Send email to audiences built from your contacts, with tiered send caps and unsubscribe handling.',
  },
  errorScreens: {
    path: '/building-sites/site-protection/error-screens',
    title: 'Design custom error screens',
    excerpt: 'Replace generic 404/401/403/503 pages with branded screens you design.',
  },
  examples: {
    path: '/developers/plugins/guides/examples',
    title: 'Worked examples',
    excerpt: 'Where to look for a working example of each plugin pattern.',
  },
  extensionPoints: {
    path: '/developers/plugins/reference/extension-points',
    title: 'Extension-point catalog',
    excerpt: 'Every surface a plugin can extend, when it runs, and which part of Aglyn it reaches.',
  },
  featureFlags: {
    path: '/staff-console/feature-flags',
    title: 'Feature Flags',
    excerpt: 'Release-gate console features with Firebase Remote Config — staff always see everything, customers see what\'s launched.',
  },
  firstPlugin: {
    path: '/developers/plugins/guides/first-plugin',
    title: 'Build your first plugin',
    excerpt: 'The full loop — scaffold, develop against a live workspace, verify, publish, install, uninstall.',
  },
  forms: {
    path: '/content-and-data/forms/overview',
    title: 'Forms & Lead Capture',
    excerpt: 'Add forms to your site, collect submissions in an inbox, and write them into datasets.',
  },
  generateSection: {
    path: '/marketing-and-automation/ai-assist/generate-section',
    title: 'AI Generate Section',
    excerpt: 'Produce a whole section of components on the canvas from a prompt.',
  },
  gettingStarted: {
    path: '/getting-started/create-a-site',
    title: 'Create a site',
    excerpt: 'Sign in, create your first site, and understand what a site contains.',
  },
  glossary: {
    path: '/concepts/glossary',
    title: 'Glossary & naming conventions',
    excerpt: 'What organization, workspace, tenant, host, and site each mean — and which word to use where.',
  },
  importExport: {
    path: '/content-and-data/datasets/import-export',
    title: 'Import & export',
    excerpt: 'Round-trip dataset records through CSV and JSON with validation on import.',
  },
  injectionZones: {
    path: '/developers/plugins/reference/injection-zones',
    title: 'Injection zones',
    excerpt: 'Every named console zone a plugin widget can render into, and what each receives.',
  },
  interactions: {
    path: '/building-sites/besigner/interactions-and-custom-html',
    title: 'Interactions & custom HTML',
    excerpt: 'Build element interactions in one dialog and drop sanitized custom markup anywhere.',
  },
  inviteTeammates: {
    path: '/workspace-and-billing/teams-and-roles/invite-teammates',
    title: 'Invite teammates',
    excerpt: 'Add people to your site and understand how team members act within your organization.',
  },
  languageSwitcher: {
    path: '/building-sites/multilingual/language-switcher',
    title: 'Add a language switcher',
    excerpt: 'Let visitors move between your site\'s locales.',
  },
  maintenanceMode: {
    path: '/building-sites/site-protection/maintenance-mode',
    title: 'Maintenance mode',
    excerpt: 'Temporarily take your site offline behind a designed 503 screen.',
  },
  manifestAndEnvs: {
    path: '/developers/plugins/reference/manifest-and-envs',
    title: 'Manifests, trust lifecycle & environment',
    excerpt: 'The plugin manifest schema, the marketplace listing/version documents, the trust state machine, and every PLUGIN_* environment variable.',
  },
  marketingOverlays: {
    path: '/marketing-and-automation/marketing-overlays/overview',
    title: 'Marketing Overlays',
    excerpt: 'Site-wide announcement bars and promotional popups with triggers, scheduling, and email capture.',
  },
  media: {
    path: '/content-and-data/media/overview',
    title: 'Media Library & CDN',
    excerpt: 'Organize images, video, and files in folders, transform them, and serve them fast over a CDN.',
  },
  megaMenuWithInteractions: {
    path: '/guides/mega-menu-with-interactions',
    title: 'Build a mega menu with hover interactions',
    excerpt: 'Add a SaaS-style mega menu to your nav bar, fill it with columns of links, and make it open on hover — entirely in the Besigner, on any plan.',
  },
  members: {
    path: '/guides/member-accounts',
    title: 'Member accounts',
    excerpt: 'Let visitors sign up on your site, design an account page with the Customer account block, gate screens to members, and manage members from the console Users page.',
  },
  membersOnly: {
    path: '/workspace-and-billing/teams-and-roles/members-only',
    title: 'Members-only areas',
    excerpt: 'Let visitors sign up as members and gate screens so only members can view them.',
  },
  menusAndNavigation: {
    path: '/building-sites/menus-and-navigation/overview',
    title: 'Menus & navigation',
    excerpt: 'Dropdown menus, hover mega menus, and slide-in drawers — authorable entirely in the besigner.',
  },
  migrationPatterns: {
    path: '/building-sites/redirects/migration-patterns',
    title: 'Migration patterns',
    excerpt: 'Common redirect setups when you rename screens or move a site into Aglyn.',
  },
  modelBuilder: {
    path: '/content-and-data/datasets/model-builder',
    title: 'Build a data model',
    excerpt: 'Define a dataset model with typed fields and edit records in the typed editor.',
  },
  multilingual: {
    path: '/building-sites/multilingual/overview',
    title: 'Multilingual',
    excerpt: 'Offer your site in multiple languages with locale variants, hreflang, and a language switcher.',
  },
  multiSelect: {
    path: '/building-sites/besigner/multi-select',
    title: 'Multi-select & multi-drag',
    excerpt: 'Select several elements at once and move the whole selection together.',
  },
  passwordAScreen: {
    path: '/building-sites/site-protection/password-a-screen',
    title: 'Password-protect a screen',
    excerpt: 'Require a password to view a specific screen.',
  },
  pluginManagerApi: {
    path: '/developers/plugins/reference/plugin-manager-api',
    title: 'Plugin-manager API reference',
    excerpt: 'Every public registration and loading API a plugin can use, from `@aglyn/aglyn` and `@aglyn/aglyn/server`.',
  },
  plugins: {
    path: '/developers/plugins/overview',
    title: 'Plugins & Marketplace',
    excerpt: 'Extend Aglyn with sandboxed plugins — install from the marketplace, configure them, and publish your own.',
  },
  pos: {
    path: '/commerce-and-bookings/commerce/pos-and-reservations',
    title: 'POS & reservations',
    excerpt: 'Sell in person from the console register and take date-range reservations with deposits.',
  },
  publishAPlugin: {
    path: '/developers/plugins/publish-a-plugin',
    title: 'Publish a plugin',
    excerpt: 'Ship your own plugin to the community marketplace with version pinning.',
  },
  publisherHandbook: {
    path: '/developers/plugins/publishing/publisher-handbook',
    title: 'Publisher handbook',
    excerpt: 'Publishing to the Aglyn marketplace — from profile setup through listing authoring, review, updates, and getting paid.',
  },
  publishYourFirstScreen: {
    path: '/getting-started/publish-your-first-screen',
    title: 'Publish your first screen',
    excerpt: 'Create a screen, design it in the Besigner, and publish it live.',
  },
  realmBundles: {
    path: '/developers/plugins/guides/realm-bundles',
    title: 'Guide: trusted realm bundles',
    excerpt: 'The end-to-end path from a standalone bundle to first-party-grade code running in the app realm.',
  },
  redirects: {
    path: '/building-sites/redirects/overview',
    title: 'Redirects',
    excerpt: 'Manage URL redirects with validation, loop detection, and hit metrics.',
  },
  relations: {
    path: '/content-and-data/datasets/relations',
    title: 'Relations',
    excerpt: 'Link records together with reference fields, including many-to-many.',
  },
  responsiveStyling: {
    path: '/building-sites/besigner/responsive-styling',
    title: 'Responsive styling & custom CSS',
    excerpt: 'Style per breakpoint from the artboard preview, use the box stylers, custom classes, and the CSS builder.',
  },
  saveATemplate: {
    path: '/building-sites/site-templates/save-a-template',
    title: 'Save & share a template',
    excerpt: 'Turn a site into a reusable template and install community templates.',
  },
  screens: {
    path: '/building-sites/screens-and-layouts/overview',
    title: 'Screens & Layouts',
    excerpt: 'Screen hierarchy and routing, shared layouts, reusable components, and versioning.',
  },
  seo: {
    path: '/building-sites/seo/overview',
    title: 'SEO Toolkit',
    excerpt: 'Per-screen SEO, sitemap and robots, Open Graph/Twitter cards, and structured data.',
  },
  serverApis: {
    path: '/developers/plugins/guides/server-apis',
    title: 'Guide: server APIs, webhooks & jobs',
    excerpt: 'Plugin API routes behind the dispatchers, Stripe/Svix signature verification, billing hooks, and scheduled jobs.',
  },
  siteProtection: {
    path: '/building-sites/site-protection/overview',
    title: 'Site Protection & Error Pages',
    excerpt: 'Password-protect screens, design custom error pages, and put your site in maintenance mode.',
  },
  siteSearch: {
    path: '/building-sites/site-search/overview',
    title: 'Site Search',
    excerpt: 'Let visitors search your site\'s pages, blog entries, and dataset records with a built-in search page.',
  },
  staffConsole: {
    path: '/staff-console/overview',
    title: 'Staff Console (internal)',
    excerpt: 'Aglyn-staff tools for managing organizations, entitlements, users, and audits.',
  },
  team: {
    path: '/workspace-and-billing/teams-and-roles/overview',
    title: 'Teams, Roles & Membership',
    excerpt: 'Invite teammates with custom roles, and offer members-only areas to your site\'s visitors.',
  },
  templatesLibrary: {
    path: '/building-sites/site-templates/templates-library',
    title: 'Your templates library',
    excerpt: 'Save pages, components and layouts as reusable templates — and the safe landing place for anything you install from the marketplace.',
  },
  termReference: {
    path: '/concepts/term-reference',
    title: 'Term reference',
    excerpt: 'Every term Aglyn uses, in one place — brief definitions with links to the full documentation for each.',
  },
  textEditing: {
    path: '/building-sites/besigner/text-editing',
    title: 'Inline & rich text editing',
    excerpt: 'Edit text directly on the canvas, with basic rich text on opt-in elements.',
  },
  themeBuilder: {
    path: '/building-sites/theme-builder/overview',
    title: 'Theme Builder',
    excerpt: 'Set your site\'s colors, fonts, and light/dark schemes with a live preview.',
  },
  troubleshooting: {
    path: '/building-sites/custom-domains/troubleshooting',
    title: 'Troubleshoot verification',
    excerpt: 'Fix the common reasons a custom domain won\'t verify.',
  },
  webhooks: {
    path: '/marketing-and-automation/workflows-and-actions/webhooks',
    title: 'Webhooks',
    excerpt: 'Connect Aglyn to other systems with outbound and inbound webhooks.',
  },
  workflows: {
    path: '/marketing-and-automation/workflows-and-actions/overview',
    title: 'Workflows, Actions & Webhooks',
    excerpt: 'Automate your site — run multi-step workflows on site events, and connect to other systems with webhooks.',
  },
} as const satisfies Record<string, DocsHelpTopic>

export type DocsHelpTopicKey = keyof typeof DOCS_HELP_TOPICS

// Heading anchors present on each topic's docs page. Only topics with H2–H4
// headings appear; a topic absent here has no linkable anchors.
export const DOCS_HELP_ANCHORS = {
  account: ['#google-sign-in', '#resetting-your-password', '#one-session-across-workspaces', '#automatic-sign-out-after-inactivity'],
  actionsBuilder: ['#create-an-action', '#triggers', '#only-run-when-a-field-matches', '#chain-multiple-conditions-andor', '#steps', '#interactions-from-the-besigner', '#when-to-use-which', '#related'],
  addALocale: ['#steps', '#tips', '#related'],
  addOns: ['#what-you-can-add', '#how-changes-bill', '#plan-switches-and-cancellation', '#related'],
  addSearch: ['#steps', '#tips', '#related'],
  aiAssist: ['#copy-assist', '#ai-generate-section', '#related'],
  analytics: ['#pageview-tracking', '#insights', '#per-screen-traffic', '#google-analytics', '#related'],
  architectureMultiTenancy: ['#the-model-in-one-sentence', '#data-model', '#authorization-one-read-per-request', '#membership-lifecycle', '#workspace-subdomains', '#billing--cost-attribution', '#related'],
  besigner: ['#what-you-can-do', '#the-canvas', '#hierarchy-panel', '#inline-and-rich-text', '#reusable-components', '#ai-in-the-canvas', '#related'],
  billing: ['#tiers--entitlements', '#usage-meters', '#seats', '#organization-data', '#api-access', '#payments', '#related'],
  bindings: ['#binding-tokens', '#rename-safe-id-tokens', '#insert-a-variable', '#token-pills', '#in-the-canvas-text-editor', '#typed-variables', '#no-code-functions', '#where-used--safety', '#workflows', '#related'],
  bookings: ['#set-up-bookings', '#taking-bookings', '#manage', '#related'],
  buildABlog: ['#1-create-a-collection', '#2-write-entries', '#categories', '#visual-editor', '#3-design-the-pages-with-template-screens', '#blog-blocks', '#entry-tokens', '#no-template-still-designed', '#paginated-page-sets', '#4-publish--syndicate', '#tips', '#related'],
  buildAndPublishASurvey: ['#1-create-the-dataset', '#2-add-a-screen-for-the-survey', '#3-insert-a-form-from-the-element-picker', '#4-configure-the-fields', '#5-point-the-form-at-the-dataset', '#6-publish', '#7-watch-responses-arrive', '#related'],
  buildAWorkflow: ['#1-open-the-workflows-page', '#2-choose-a-trigger', '#3-add-steps', '#4-save-and-test', '#tips', '#related'],
  buildingFeaturePlugins: ['#the-ui-half', '#the-console-half', '#how-the-shell-consumes-the-registry', '#loading-org-gated-and-dynamic-agl-417', '#extending-beyond-pages-slots-providers-runtimes-hooks-agl-418419', '#remote-bundles-the-trusted-realm-tier-agl-420', '#the-server-half-api-routes', '#shared-server-runtime-aglyntenant-runtime', '#project-setup', '#reference-implementations'],
  catalog: ['#products-options-and-variants', '#billing-modes-and-subscriptions', '#categories-and-tags', '#collections', '#slugs', '#related'],
  commerce: ['#products-hub', '#inventory', '#orders', '#shipping--taxes', '#dropshipping', '#related'],
  commerceEndToEnd: ['#1-connect-payments', '#2-create-products', '#3-design-the-storefront', '#catalog-search-filters-and-sort', '#category-pages', '#the-product-page-template', '#4-what-checkout-does', '#5-run-orders-from-the-console', '#6-subscriptions--the-stripe-portal', '#related'],
  components: ['#promote', '#insert-instances', '#manage', '#tips', '#related'],
  connectADomain: ['#steps', '#registrar-quick-reference', '#related'],
  consoleAndSite: ['#add-a-console-page', '#add-a-widget-to-a-shell-zone', '#wrap-every-console-page-providers', '#add-a-canvas-component-besigner--published-sites', '#add-a-site-runtime', '#troubleshooting'],
  consoleTour: ['#the-app-bar', '#in-context-help', '#primary-navigation', '#editing-vs-managing', '#a-sites-dashboard', '#next', '#workspace-settings--notifications', '#alerts-on-this-device'],
  contacts: ['#unified-ingestion', '#the-contacts-page', '#segments', '#related'],
  content: ['#site-templates--starter-gallery', '#section--block-library', '#content-collections--blog', '#related'],
  copyAssist: ['#use-it', '#tips', '#related'],
  createARedirect: ['#add-a-rule', '#read-hit-metrics', '#related'],
  customDomains: ['#connect-a-domain', '#related'],
  customRoles: ['#create-a-custom-role', '#effective-permissions', '#per-member-overrides', '#tips', '#related'],
  datasets: ['#model-builder', '#typed-documents', '#relations', '#query-layer', '#repeatable-components', '#import--export', '#related'],
  datasetsAndSchema: ['#display-names-vs-field-ids', '#naming--describing-fields', '#the-typed-model', '#record-quotas-per-plan', '#import--export', '#repeatables', '#everything-that-writes-records', '#related'],
  designedEmails: ['#create-a-template', '#styling-email-blocks', '#merge-tokens', '#send-it'],
  downgradingAndCanceling: ['#downgrading-to-a-lower-plan', '#canceling-your-subscription', '#deleting-a-single-site', '#deleting-your-organization', '#related'],
  dragDropHierarchy: ['#where-you-can-drag', '#what-a-drag-does', '#drop-zones-edges-vs-center', '#containers-vs-leaf-elements', '#containers-accept-children', '#leaf-elements-dont--dropping-on-one-makes-a-sibling', '#adding-a-new-element', '#when-a-drop-is-rejected', '#multi-drag', '#tips', '#related'],
  editYourTheme: ['#open-the-editor', '#set-colors-and-fonts', '#it-follows-you-into-the-besigner', '#tips', '#related'],
  emailCampaigns: ['#send-a-campaign', '#personalize-with-merge-tags', '#schedule-a-send', '#email-lists', '#experiments', '#opens--clicks', '#compliance', '#related'],
  errorScreens: ['#the-error-screens', '#design-one', '#tips', '#related'],
  featureFlags: ['#how-a-flag-is-evaluated', '#how-gating-behaves', '#managing-flags', '#under-the-hood'],
  firstPlugin: ['#1-scaffold', '#2-write-the-entry', '#3-develop-against-a-live-workspace', '#4-verify', '#5-publish', '#6-install-enable-load', '#7-uninstall', '#troubleshooting'],
  forms: ['#build-a-form', '#field-types', '#example-a-quick-survey', '#after-submit', '#example-grow-an-email-list-from-a-signup-form', '#where-submissions-go', '#related'],
  generateSection: ['#use-it', '#tips', '#related'],
  gettingStarted: ['#create-your-first-site', '#what-a-site-contains', '#switching-between-sites', '#next'],
  glossary: ['#the-hierarchy', '#organization-org', '#workspace', '#tenant', '#tenant-vs-host--not-the-same-thing', '#quick-reference'],
  importExport: ['#export', '#import', '#upsert-on-a-key-field', '#tips', '#related'],
  interactions: ['#fluent-interactions', '#plan-availability', '#pick-the-target-by-clicking', '#interaction-cookbook', '#custom-html-block', '#related'],
  inviteTeammates: ['#invite-someone', '#how-team-members-act', '#activity-log', '#tips', '#related'],
  languageSwitcher: ['#steps', '#tips', '#related'],
  maintenanceMode: ['#turn-it-on', '#tips', '#related'],
  manifestAndEnvs: ['#plugin-manifest-published-with-every-version', '#listing--version-documents', '#review--trust-lifecycle', '#environment-variables', '#pluginsconfigjson-first-party-contributors'],
  marketingOverlays: ['#announcement-bar', '#promotional-popups', '#popup-v2', '#multiple-overlays-scheduling--page-targeting', '#engagement-stats', '#related'],
  media: ['#organize', '#upload', '#deliver-over-cdn', '#components', '#related'],
  megaMenuWithInteractions: ['#what-youll-build', '#1-insert-the-mega-menu', '#2-build-the-columns', '#3-make-it-open-on-hover', '#prefer-primitives-insert-the-dropdown-panel-preset', '#4-add-a-mobile-drawer-optional', '#5-test-and-publish', '#how-it-works-under-the-hood', '#troubleshooting', '#related'],
  members: ['#1-the-built-in-sign-in-and-sign-up-pages', '#2-design-an-account-page', '#3-gate-screens-to-members', '#4-manage-members-from-the-console', '#suspend--reactivate', '#related'],
  membersOnly: ['#let-visitors-sign-up', '#sign-in-sign-up-and-recovery-pages', '#forgotten-passwords', '#gate-a-screen', '#manage-your-members', '#suspend-or-reactivate-a-member', '#tips', '#related'],
  menusAndNavigation: ['#dropdown-menu', '#mega-menu', '#drawer--menu-button', '#the-mobile-nav-preset', '#the-dropdown-panel-preset', '#interactions-for-menus', '#responsive-visibility', '#related'],
  migrationPatterns: ['#renamed-a-screen', '#consolidated-pages', '#moved-a-site-into-aglyn', '#avoiding-loops', '#related'],
  modelBuilder: ['#define-the-model', '#display-name-vs-reference-id', '#edit-records', '#tips', '#related'],
  multilingual: ['#locale-variants', '#hreflang--discovery', '#language-switcher', '#related'],
  multiSelect: ['#select-multiple', '#move-the-whole-selection', '#tips', '#related'],
  passwordAScreen: ['#steps', '#password-vs-members-only', '#related'],
  pluginManagerApi: ['#console-extensions--feature-plugins', '#loading--plugin-loader', '#server-apis--api-plugins-server-only', '#site-pipeline--site-runtime-site-page-hooks-server-for-hooks', '#billing--billing-webhook-hooks-server', '#enablement-flags-config-fields-permissions-jobs', '#remote-bundles--realm-plugins-isomorphic-realm-server-server', '#sandbox--plugin-bridge'],
  plugins: ['#install--upgrade', '#how-plugins-run', '#configure', '#publish-your-own', '#related'],
  pos: ['#registers', '#the-register', '#when-something-disconnects', '#reservations', '#related'],
  publishAPlugin: ['#the-publish-pipeline', '#paid-listings', '#your-publisher-profile', '#tips', '#related'],
  publisherHandbook: ['#before-your-first-publish', '#publishing-a-version', '#review-what-happens-after-you-publish', '#authoring-your-listing', '#versioning--updates', '#how-installs-work-the-buyer-side', '#getting-paid'],
  publishYourFirstScreen: ['#1-create-a-screen', '#2-design-it-in-the-besigner', '#3-preview-and-publish', '#next'],
  realmBundles: ['#build-against-the-host-abi', '#the-chain-that-runs-before-a-byte-executes', '#granting-trust-staff', '#where-realm-bundles-load', '#key-rotation', '#troubleshooting'],
  redirects: ['#manage-redirects', '#metrics', '#match-modes-v2', '#related'],
  relations: ['#reference-fields', '#many-to-many', '#using-relations', '#tips', '#related'],
  responsiveStyling: ['#style-per-breakpoint', '#box-stylers', '#style-groups', '#visibility-per-device-band', '#scheme-scoped-colors', '#custom-classes', '#custom-css-sx', '#semantic-sections--theme-mode', '#edit-json-for-one-element'],
  saveATemplate: ['#start-from-a-template', '#save-your-site-as-a-template', '#tips', '#related'],
  screens: ['#screens--routing', '#layouts', '#reusable-components', '#versions--scheduled-publishing', '#error--maintenance-screens', '#related'],
  seo: ['#per-screen-seo', '#sitemap--robots', '#social-cards', '#structured-data', '#analytics-integration', '#related'],
  serverApis: ['#an-api-route', '#webhooks-with-signature-verification', '#platform-billing-events', '#scheduled-jobs', '#troubleshooting'],
  siteProtection: ['#per-screen-passwords', '#custom-error-screens', '#maintenance-mode', '#related'],
  siteSearch: ['#how-it-works', '#what-it-searches', '#configure-it', '#related'],
  staffConsole: ['#whats-there', '#related'],
  team: ['#team-roles', '#organizations', '#site-membership', '#seats', '#related'],
  templatesLibrary: ['#the-three-kinds', '#installing-from-the-marketplace', '#saving-something-as-a-template', '#using-a-template', '#where-a-template-came-from', '#first-party-starters', '#templates-are-per-site', '#deleting', '#related'],
  termReference: ['#platform--accounts', '#organization-org', '#workspace', '#tenant', '#host', '#site', '#console', '#staff-console', '#member', '#custom-role', '#publisher', '#sites--content', '#screen', '#layout', '#slug', '#version', '#redirect', '#error-screens', '#maintenance-mode', '#locale', '#site-template', '#theme', '#custom-domain', '#subdomain', '#the-node-tree', '#node', '#tree', '#tree-root', '#trunk', '#stem', '#branch', '#leaf', '#component', '#component-bundle', '#preset', '#reusable-component', '#lineal-placement-rules', '#besigner-the-editor', '#besigner', '#canvas', '#hierarchy-panel', '#drawer', '#binding', '#plugins--marketplace', '#plugin', '#add-on', '#surface', '#console-extension', '#widget', '#injection-zone', '#plugin-manifest', '#enabled-plugins', '#feature-flag', '#release-flag', '#plugin-config', '#plugin-permission', '#plugin-job', '#listing', '#install', '#realm-bundle', '#sandbox', '#host-abi', '#review-queue', '#data--logic', '#dataset', '#record', '#field', '#relation', '#contact', '#segment', '#media-library', '#variable', '#function-fx', '#form', '#automation--marketing', '#event', '#workflow', '#action', '#automation', '#overlay', '#experiment', '#email-campaign', '#designed-email', '#merge-tag', '#commerce', '#product', '#order', '#pos', '#booking', '#billing--plans', '#plan', '#entitlement', '#quota', '#seat', '#metered-usage'],
  textEditing: ['#edit-inline', '#rich-text', '#the-text-attribute', '#bindings-in-text', '#related'],
  themeBuilder: ['#edit-your-theme', '#related'],
  troubleshooting: ['#checklist', '#still-stuck', '#related'],
  webhooks: ['#outbound-webhooks', '#inbound-webhooks', '#tips', '#related'],
  workflows: ['#workflows', '#actions-builder', '#webhooks', '#related'],
} as const satisfies Partial<
  Record<DocsHelpTopicKey, readonly `#${string}`[]>
>

type AnchorMap = typeof DOCS_HELP_ANCHORS

/** Valid heading anchors for a topic (`never` when the page has none). */
export type DocsHelpAnchor<K extends DocsHelpTopicKey> =
  K extends keyof AnchorMap ? AnchorMap[K][number] : never
