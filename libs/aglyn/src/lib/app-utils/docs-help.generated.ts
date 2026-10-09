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

// The first-party plugin consoles live in `libs/plugins/*` and cannot import
// the console's constants, so they carry their own generated subset of the
// docs help registry — the topics their cards actually link to, and no others.

export interface PluginDocsTopic {
  /** Docs-site path, e.g. `/commerce-and-bookings/commerce/overview`. */
  path: string
  /** Docs page title. */
  title: string
  /** Verbatim docs frontmatter description — the tooltip excerpt. */
  excerpt: string
}

export const PLUGIN_DOCS = {
  abuseReports: {
    path: '/staff-console/abuse-reports',
    title: 'Abuse reports',
    excerpt: 'The public abuse-report queue — where outside reports land, how to triage by severity, which lever answers which report, and the CSAM and DMCA paths that are not takedown buttons.',
  },
  actionsBuilder: {
    path: '/marketing-and-automation/workflows-and-actions/actions-builder',
    title: 'Actions builder',
    excerpt: 'Map a single event to a single action without building a full workflow.',
  },
  aglynAssist: {
    path: '/getting-started/aglyn-assist',
    title: 'Aglyn Assist',
    excerpt: 'Ask the built-in AI helper how to do anything in Aglyn — it answers from these docs and links you straight to the right page.',
  },
  aiAutomations: {
    path: '/ai/automations-with-ai',
    title: 'Automations with AI',
    excerpt: 'Aglyn AI drafts an automation from a description, changes or fixes one you already have as a copy switched off, explains what one does and tells you why one of its runs failed.',
  },
  aiBusinessProfile: {
    path: '/ai/business-profile',
    title: 'Business profile',
    excerpt: 'Tell Aglyn AI what your business does, who it is for and how it sounds. Every AI job for the site reads it, uses your real contact details only, and remembers the edits you keep.',
  },
  aiCrm: {
    path: '/ai/crm-by-ai',
    title: 'The AI CRM built into Aglyn',
    excerpt: 'An AI CRM for small business: a short summary and a suggested next step on a contact, company, deal or lead, a one-to-one email drafted into the composer, and an import\'s columns matched to fields.',
  },
  aiExperiments: {
    path: '/ai/ab-tests-with-ai',
    title: 'A/B tests by AI: write variants, read the result',
    excerpt: 'Have Aglyn AI write two to four variants for a page, section or email experiment, and put a finished test into plain language — with the verdict decided from the counts before the model is asked anything.',
  },
  aiInsights: {
    path: '/marketing-and-automation/analytics/insights',
    title: 'Insights',
    excerpt: 'Ask Aglyn AI a question about your site\'s figures in plain words, and get answers where every number is traced to the figure it comes from — plus weekly insights by email.',
  },
  aiLogic: {
    path: '/ai/logic-with-ai',
    title: 'Functions and variables with AI',
    excerpt: 'Aglyn AI writes a site function or variable from a description, changes or fixes a function you have, explains what one works out, and offers a fix for a broken automation reference. Nothing is saved until you save it.',
  },
  aiMarketing: {
    path: '/ai/marketing-with-ai',
    title: 'Marketing with AI: overlays, campaigns and your numbers',
    excerpt: 'Use Aglyn AI on your site\'s Marketing page: write announcement bar and popup copy, create a switched-off overlay or a draft campaign from a brief, and ask what your conversions and campaign figures mean.',
  },
  aiMonitoring: {
    path: '/staff-console/ai-monitoring',
    title: 'AI monitoring',
    excerpt: 'How staff watch one organization\'s AI usage — add-on, credits, overage, refusals, jobs, tokens, cache hits and margin — read its AI conversations, and find those figures across the staff console.',
  },
  aiProducts: {
    path: '/ai/products-with-ai',
    title: 'Product copy and catalogs with AI',
    excerpt: 'An AI product description generator for your catalog: write copy for one product or a whole import, propose a first catalog, and propose categories and discounts — all as proposals you review.',
  },
  aiSeo: {
    path: '/building-sites/seo/seo-by-ai',
    title: 'AI SEO for your website',
    excerpt: 'AI SEO for websites, on the pages you already have: have AI write a page or product\'s search listing, propose a fix for each finding of the SEO check, and draft your structured data and /llms.txt.',
  },
  aiThemes: {
    path: '/ai/theme-assist',
    title: 'Change your site\'s theme with AI',
    excerpt: 'Describe a change to your site\'s theme and get a proposal for the theme editor\'s own controls, previewed before and after, that you save in the editor.',
  },
  assistSignals: {
    path: '/staff-console/assist-signals',
    title: 'Assist Signal',
    excerpt: 'The docs-gap and cost board behind Assist — how the ranking is ordered, why ungrounded questions are counted separately, and what the cache-read rate says about margin.',
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
  buildAWorkflow: {
    path: '/marketing-and-automation/workflows-and-actions/build-a-workflow',
    title: 'Build a workflow',
    excerpt: 'Create a multi-step workflow that runs when a site event fires.',
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
  companies: {
    path: '/content-and-data/crm/companies',
    title: 'Companies',
    excerpt: 'Group your contacts under the businesses they belong to — one record per company, with its domain, owner, type, industry, addresses, parent company and the people who work there.',
  },
  connectQuickbooksOnline: {
    path: '/commerce-and-bookings/commerce/connect-quickbooks-online',
    title: 'Connect QuickBooks Online',
    excerpt: 'Post every sale, refund, Aglyn fee and Stripe payout from your store to QuickBooks Online, mapped to the accounts you choose. Rolling out.',
  },
  connectXero: {
    path: '/commerce-and-bookings/commerce/connect-xero',
    title: 'Connect Xero',
    excerpt: 'Post every sale, refund, Aglyn fee and Stripe payout from your store to Xero, mapped to the accounts you choose. Rolling out.',
  },
  consoleTour: {
    path: '/getting-started/console-tour',
    title: 'The console tour',
    excerpt: 'Where things live in the Aglyn console app bar and navigation.',
  },
  contactActivities: {
    path: '/content-and-data/crm/activities',
    title: 'Activities & the timeline',
    excerpt: 'Log calls, emails, meetings and notes against a contact, a company, a deal or a lead, email one person from their record, and read it all in one timeline beside everything captured and every campaign sent.',
  },
  contactFields: {
    path: '/content-and-data/crm/custom-fields',
    title: 'Custom fields',
    excerpt: 'Define your own properties on contacts, companies, deals and leads — text, number, date, choice, checkbox or link — show them on every record and its list, and save form answers straight into a contact\'s.',
  },
  contactRecord: {
    path: '/content-and-data/crm/contact-record',
    title: 'The contact record',
    excerpt: 'Add a contact by hand, keep a profile on them — Salesforce\'s standard contact fields, from salutation and phones to assistant and reports-to — open their own page in the CRM, and merge two records that are one person.',
  },
  contacts: {
    path: '/content-and-data/crm/overview',
    title: 'CRM',
    excerpt: 'One place for the people who interact with your sites — contacts captured from forms, members, orders and bookings, with leads, companies, a deals pipeline, tasks, a timeline, reports and custom fields.',
  },
  couriers: {
    path: '/commerce-and-bookings/commerce/couriers',
    title: 'Couriers for local delivery (DoorDash Drive)',
    excerpt: 'Send a DoorDash courier for your own local deliveries from your own DoorDash Drive account, with the courier\'s tracking link and arrival time on the order. Rolling out.',
  },
  crmEmailTemplates: {
    path: '/content-and-data/crm/email-templates',
    title: 'Email templates',
    excerpt: 'Keep the letters your team sends from a record — templates that fill in the subject and the message, snippets that drop in a paragraph, and merge fields that fill in the person\'s name, their company, the deal and you.',
  },
  crmLeads: {
    path: '/content-and-data/crm/leads',
    title: 'Leads',
    excerpt: 'Work the people your site has captured — a status, an owner and notes on every lead — and convert one into a contact, a company and a deal.',
  },
  crmReports: {
    path: '/content-and-data/crm/reports',
    title: 'Reports',
    excerpt: 'New contacts, their sources and which convert, the lead funnel and lead sources, the open pipeline and its forecast, won and lost, who logged what, and the task load — counted on the server, all exportable as CSV.',
  },
  crmSettings: {
    path: '/content-and-data/crm/settings',
    title: 'CRM settings',
    excerpt: 'What the CRM does on its own for every site — whether a company is created from a contact\'s work email domain, who a new contact is assigned to, the address that files replies on a record, and each site\'s recipes.',
  },
  crmSharing: {
    path: '/content-and-data/crm/sharing',
    title: 'Share records across sites',
    excerpt: 'Let another of your sites see a lead, a contact, a company or a deal — one record by hand, a selection from a list, or every record a sharing rule matches, now and later — without sharing the person\'s consent.',
  },
  crmTasks: {
    path: '/content-and-data/crm/tasks',
    title: 'Tasks & follow-ups',
    excerpt: 'Calls, emails, meetings and to-dos with a status, a due date, an assignee and a link to the record they are for — overdue and today read off the clock, a snooze, a reminder at its own time, and a morning digest.',
  },
  crmViews: {
    path: '/content-and-data/crm/views',
    title: 'Saved views',
    excerpt: 'Keep a CRM list\'s filters, columns and sort under a name, open it from the views menu or a link, share it with the team, and use a contacts view as an email audience.',
  },
  datasets: {
    path: '/content-and-data/datasets/overview',
    title: 'Datasets & Dynamic Content',
    excerpt: 'Model structured content with typed fields and relations, then bind it into repeatable components.',
  },
  deals: {
    path: '/content-and-data/crm/deals',
    title: 'Deals pipeline',
    excerpt: 'Every open deal by stage — with an amount, an owner and an expected close — as a board you drag across or a table you page through, and the won and lost history behind it.',
  },
  deliveryApps: {
    path: '/commerce-and-bookings/commerce/delivery-apps',
    title: 'Delivery apps (DoorDash, Uber Eats, Grubhub)',
    excerpt: 'Take your DoorDash, Uber Eats and Grubhub orders at your POS register — accept, make and hand them over — with their items off the same shelf as every other sale. Rolling out.',
  },
  designedEmails: {
    path: '/marketing-and-automation/email-campaigns/designed-emails',
    title: 'Designed emails',
    excerpt: 'Build campaign emails in the besigner with email-safe blocks and merge tokens — no separate editor.',
  },
  emailCampaigns: {
    path: '/marketing-and-automation/email-campaigns/overview',
    title: 'Email Campaigns',
    excerpt: 'Campaigns to audiences built from your contacts. Campaign email starts at Pro and needs a sending domain of the site\'s own; receipts and account email send on every plan.',
  },
  emailPlatforms: {
    path: '/marketing-and-automation/email-campaigns/email-platforms',
    title: 'Email platforms (Mailchimp, Klaviyo, Omnisend)',
    excerpt: 'Keep your contacts and their unsubscribes in step with your own Mailchimp, Klaviyo or Omnisend account, both ways, and send your orders to Klaviyo and Omnisend for their abandoned-cart and post-purchase flows.',
  },
  events: {
    path: '/content-and-data/events/overview',
    title: 'Events Calendar',
    excerpt: 'Keep a schedule of events in the console and publish the ones you choose to any page, with search-engine event markup.',
  },
  forms: {
    path: '/content-and-data/forms/overview',
    title: 'Forms & Lead Capture',
    excerpt: 'Add forms to your site, collect submissions in an inbox, and write them into datasets.',
  },
  fulfillmentNetworks: {
    path: '/commerce-and-bookings/commerce/fulfillment-networks',
    title: 'Fulfillment networks (ShipBob, ShipMonk and Amazon MCF)',
    excerpt: 'Send paid orders to ShipBob, ShipMonk or Amazon Multi-Channel Fulfillment, get their shipments and tracking back on the order, and keep stock counts in step. Rolling out.',
  },
  funnels: {
    path: '/marketing-and-automation/analytics/funnels',
    title: 'Funnels',
    excerpt: 'See how visitors move through the steps you care about, where they drop off and how long each step takes; build or explain a funnel with Aglyn AI, and follow up with people who dropped off.',
  },
  installYourFirstPlugin: {
    path: '/guides/install-your-first-plugin',
    title: 'Install your first marketplace item',
    excerpt: 'A click-by-click walkthrough of the Marketplace — find something, choose which sites get it, install it, and turn it off again.',
  },
  inventorySync: {
    path: '/commerce-and-bookings/commerce/inventory-and-erp-sync',
    title: 'Inventory and ERP sync (Cin7 Core, inFlow, Brightpearl)',
    excerpt: 'Keep stock counts, products and paid orders in step with your own Cin7 Core, inFlow Inventory or Brightpearl account. Rolling out.',
  },
  inviteTeammates: {
    path: '/workspace-and-billing/teams-and-roles/invite-teammates',
    title: 'Invite teammates',
    excerpt: 'Add people to your site and understand how team members act within your organization.',
  },
  loyalty: {
    path: '/commerce-and-bookings/commerce/rewards-and-referrals',
    title: 'Rewards, referrals and store credit',
    excerpt: 'Give customers points on every order, online and at the register, let them spend points and store credit at checkout or the till, and reward members whose friends buy.',
  },
  loyaltyConnectors: {
    path: '/commerce-and-bookings/commerce/connect-smile-io-or-yotpo',
    title: 'Connect Smile.io or Yotpo Loyalty',
    excerpt: 'Keep your members\' points in your own Smile.io or Yotpo Loyalty account, earned and spent on every Aglyn order, online and at the register. Rolling out.',
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
  marketplaces: {
    path: '/commerce-and-bookings/commerce/marketplaces',
    title: 'Marketplaces (Amazon, eBay, Etsy, TikTok Shop, Walmart, Faire)',
    excerpt: 'Keep your Amazon, eBay, Etsy, TikTok Shop, Walmart and Faire listings in step with your store\'s stock, bring their orders in as your orders, and send tracking back. Rolling out.',
  },
  membersOnly: {
    path: '/workspace-and-billing/teams-and-roles/members-only',
    title: 'Members-only areas',
    excerpt: 'Let visitors sign up as members and gate pages so only members can view them.',
  },
  ordersAndReturns: {
    path: '/commerce-and-bookings/commerce/orders-and-returns',
    title: 'Fulfillment, returns and webhooks',
    excerpt: 'Ship an order in parts with tracking links, run returns from request to refund, print invoices, and send order events to your own systems.',
  },
  orgAutomations: {
    path: '/marketing-and-automation/workflows-and-actions/org-automations',
    title: 'Org automations',
    excerpt: 'Write an automation once for the whole organization and run it on the sites you choose, with a pause on each site.',
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
  posHardware: {
    path: '/commerce-and-bookings/commerce/pos-hardware',
    title: 'POS hardware',
    excerpt: 'Card readers, a customer display tablet, driverless receipt and kitchen printers, a cash drawer that opens on cash sales, camera and USB barcode scanning, and product and shipping labels.',
  },
  posOperations: {
    path: '/commerce-and-bookings/commerce/pos-operations',
    title: 'Running the register',
    excerpt: 'Shifts and the cash drawer with X and Z reports, staff PINs, customers at the register, returns and exchanges, printed thermal receipts, and selling cash while the register is offline.',
  },
  postPurchase: {
    path: '/commerce-and-bookings/commerce/tracking-and-protection',
    title: 'Tracking and protection (AfterShip, Route and Narvar)',
    excerpt: 'Connect your own AfterShip, Route or Narvar account so parcels are followed, buyers land on your branded tracking page, and shipped orders can carry Route package protection. Rolling out.',
  },
  printOnDemand: {
    path: '/commerce-and-bookings/commerce/print-on-demand',
    title: 'Print on demand (Printful and Printify)',
    excerpt: 'Connect your own Printful or Printify account, import its products into your store, and paid orders are sent to it to make and ship, with tracking written back to each order. Rolling out.',
  },
  publishAPlugin: {
    path: '/developers/plugins/publish-a-plugin',
    title: 'Publish a plugin',
    excerpt: 'Ship your own plugin to the marketplace with version pinning.',
  },
  publisherHandbook: {
    path: '/developers/plugins/publishing/publisher-handbook',
    title: 'Publisher handbook',
    excerpt: 'Publishing to the Aglyn marketplace — from profile setup through listing authoring, review, updates, and getting paid.',
  },
  redirects: {
    path: '/building-sites/redirects/overview',
    title: 'Redirects',
    excerpt: 'Manage URL redirects with validation, loop detection, and hit metrics.',
  },
  salesChannels: {
    path: '/commerce-and-bookings/commerce/sales-channels',
    title: 'Sales channels',
    excerpt: 'List your products on Google, YouTube, Facebook, Instagram, TikTok, Pinterest, Snapchat and Microsoft Shopping with a product feed for each.',
  },
  sandboxSecurity: {
    path: '/developers/plugins/reference/sandbox-security',
    title: 'Sandbox security model',
    excerpt: 'How sandboxed marketplace plugins are isolated — separate origin, per-manifest CSP, pinned artifacts — and what that means when you write one.',
  },
  sequences: {
    path: '/content-and-data/crm/sequences',
    title: 'Sequences',
    excerpt: 'One-to-one email sequences a rep sends to a person from their own connected mailbox, kept with the CRM. Rolling out.',
  },
  shipping: {
    path: '/commerce-and-bookings/commerce/shipping',
    title: 'Shipping',
    excerpt: 'Shipping zones and rates, local pickup, and the postal address each inventory location ships from.',
  },
  shippingEasy: {
    path: '/commerce-and-bookings/commerce/use-shippingeasy',
    title: 'Use ShippingEasy with Aglyn',
    excerpt: 'Connect your ShippingEasy account so paid orders go there as they are paid, and each label you buy marks the order shipped and emails your customer the tracking link.',
  },
  shipStation: {
    path: '/commerce-and-bookings/commerce/use-shipstation',
    title: 'Use ShipStation with Aglyn',
    excerpt: 'Connect ShipStation to your Aglyn store as a Custom Store, so it imports the orders you still have to ship and each label you buy there marks the order shipped and emails your customer the tracking link.',
  },
  staffConsole: {
    path: '/staff-console/overview',
    title: 'Staff Console (internal)',
    excerpt: 'Aglyn-staff tools for managing organizations, entitlements, users, and audits.',
  },
  taxServices: {
    path: '/commerce-and-bookings/commerce/tax-services',
    title: 'Tax services (Avalara AvaTax and TaxJar)',
    excerpt: 'Connect your own Avalara AvaTax or TaxJar account so checkout and the register charge the sales tax it calculates, and your paid orders and refunds are recorded there.',
  },
  webhooks: {
    path: '/marketing-and-automation/workflows-and-actions/webhooks',
    title: 'Webhooks',
    excerpt: 'Connect Aglyn to other systems with outbound and inbound webhooks.',
  },
  zapier: {
    path: '/marketing-and-automation/workflows-and-actions/zapier',
    title: 'Zapier',
    excerpt: 'Send your site\'s orders, bookings, contacts and form submissions to thousands of apps with Zapier, and add contacts or mark orders shipped from them. Rolling out.',
  },
} as const satisfies Record<string, PluginDocsTopic>

export type PluginDocsKey = keyof typeof PLUGIN_DOCS

export const PLUGIN_DOCS_ANCHORS = {
  abuseReports: ['#fraud-and-risk-alerts-by-email', '#where-reports-come-from', '#held-outbound-email', '#what-is-screened', '#tiers', '#web-risk', '#deciding-a-held-row', '#security-hold', '#names-and-domains', '#stripe-fraud-signals', '#seller-fraud-pattern', '#card-testing-velocity', '#marketplace', '#risk-notices', '#triage-by-severity', '#csam', '#which-lever', '#statuses', '#disclosure', '#dmca', '#counter-notices', '#counter-notice-clock', '#counter-notice-steps', '#repeat-infringers', '#repeat-infringer-threshold', '#known-gaps', '#related'],
  actionsBuilder: ['#create-an-action', '#recipes', '#describe-it', '#triggers', '#crm-events', '#funnel-events', '#only-run-when-a-field-matches', '#chain-multiple-conditions-andor', '#steps', '#crm-steps', '#step-conditions', '#sequences', '#transactional-replies', '#merge-tags', '#run-history', '#what-is-and-isnt-recorded', '#interactions-from-the-besigner', '#when-to-use-which', '#related'],
  aglynAssist: ['#what-it-can-do', '#aglyn-ai', '#answers-for-beginners-and-developers', '#offers-to-open-a-page', '#edits-in-the-besigner', '#where-an-answer-came-from', '#answers-straight-from-the-documentation', '#message-limits', '#feedback', '#privacy'],
  aiAutomations: ['#draft', '#org-automations', '#change', '#explain', '#why-a-run-failed', '#what-is-sent', '#who-can-use-it', '#related'],
  aiBusinessProfile: ['#where-to-edit-it', '#where-the-values-come-from', '#workspace-defaults', '#contact-details-are-never-invented', '#what-aglyn-ai-learned', '#which-jobs-read-it', '#related'],
  aiCrm: ['#summarize-a-record', '#summaries-are-reused-until-the-record-changes', '#draft-an-email', '#match-columns', '#what-is-sent', '#who-can-use-it', '#related'],
  aiExperiments: ['#it-proposes-you-write', '#write-variants', '#putting-them-in', '#draft-versions', '#what-it-will-not-write', '#read-a-result', '#the-verdict', '#the-words', '#undecided', '#what-is-sent', '#who-can-use-it', '#related'],
  aiInsights: ['#asking-a-question', '#how-an-answer-is-made', '#asking-about-datasets', '#weekly-insights', '#privacy'],
  aiLogic: ['#function', '#variable', '#change', '#broken-references', '#what-is-sent', '#who-can-use-it', '#related'],
  aiMarketing: ['#write-overlay-copy', '#create-an-overlay', '#create-a-campaign', '#ask-about-these-numbers', '#what-is-sent', '#who-can-use-it', '#related'],
  aiMonitoring: ['#the-ai-card', '#compensating-credits', '#ai-conversations', '#where-else', '#one-account', '#the-spend-leaderboard', '#alerts', '#related'],
  aiProducts: ['#write-a-products-copy', '#write-copy-for-many-products', '#when-you-import-products', '#propose-a-first-catalog', '#propose-categories-and-discounts', '#what-the-copy-never-says', '#what-is-sent-to-the-ai-provider', '#who-can-use-it', '#related'],
  aiSeo: ['#write-a-pages-listing', '#write-a-products-listing', '#fix-what-the-seo-check-finds', '#apply-all-as-drafts', '#structured-data-and-llmstxt', '#related'],
  aiThemes: ['#change-what-you-describe-or-design-a-new-theme', '#match-your-brand', '#review-the-proposal', '#save-it-or-dont', '#who-can-use-it', '#related'],
  assistSignals: ['#the-workflow-this-board-exists-for', '#fleet', '#the-cache-read-rate-and-what-a-bad-number-looks-like', '#where-the-money-goes', '#tokens-by-kind', '#docs-gaps', '#questions-the-docs-could-not-answer', '#what-people-actually-asked', '#what-assist-costs-by-workspace', '#reading-the-sample-honestly', '#related'],
  billing: ['#tiers--entitlements', '#leaving-notice', '#plan-without-subscription', '#upgrade-proposal', '#enterprise', '#single-sign-on-and-enforcement', '#usage-meters', '#who-is-generating-what', '#ai-allotments', '#storage-overage', '#if-you-would-rather-uploads-stopped', '#assist-overage', '#stop-ai-assist-at-the-included-band', '#ai-overage-ceiling', '#free-ai-credits', '#ai-credit-alerts', '#usage-budget', '#seats', '#crm-records', '#the-crm-suite', '#one-to-one-email', '#organization-data', '#api-access', '#payments', '#outstanding', '#plan-total', '#billing-email', '#payment-methods', '#billing-address', '#tax-ids', '#sales-tax', '#platform-fees', '#related'],
  bindings: ['#binding-tokens', '#rename-safe-id-tokens', '#insert-a-variable', '#token-pills', '#in-the-canvas-text-editor', '#site-details', '#typed-variables', '#no-code-functions', '#parameters-a-visitor-can-answer', '#a-calculator-you-lay-out', '#where-used--safety', '#workflows', '#related'],
  bookings: ['#set-up-bookings', '#draft-services', '#price-labels', '#phone-and-address', '#taking-bookings', '#reminders', '#payments-and-fees', '#service-tax', '#manage', '#booking-from-the-crm', '#canceling-and-refunding', '#export-bookings', '#related'],
  buildAWorkflow: ['#1-open-the-workflows-page', '#2-choose-a-trigger', '#3-add-steps', '#waiting', '#4-save-and-test', '#duplicate-a-workflow', '#tips', '#related'],
  catalog: ['#products-options-and-variants', '#billing-modes-and-subscriptions', '#ai', '#categories-and-tags', '#collections', '#slugs', '#merchant-center-feed', '#related'],
  commerce: ['#products-hub', '#inventory', '#reserved-stock', '#stock-movements', '#gift-cards', '#recovery-and-alerts', '#orders', '#orders-screen', '#order-statuses', '#order-money-tiles', '#a-lost-dispute', '#payment-methods', '#shipping--taxes', '#lodging-tax-on-reservations', '#storefront-sales-tax', '#destination-coverage', '#pickup-and-local-delivery', '#dropshipping', '#related'],
  commerceEndToEnd: ['#1-connect-payments', '#2-create-products', '#3-design-the-storefront', '#catalog-search-filters-and-sort', '#category-pages', '#the-product-page-template', '#4-what-checkout-does', '#paying-without-leaving-your-site', '#5-run-orders-from-the-console', '#6-subscriptions--the-stripe-portal', '#related'],
  companies: ['#the-companies-list', '#create-a-company', '#the-lists-behind-the-choices', '#a-companys-page', '#contacts-at-a-company', '#linked-on-capture', '#import', '#export', '#deleting-a-company', '#who-can-see-a-company', '#files', '#related'],
  connectQuickbooksOnline: ['#before-you-start', '#connect', '#choose-your-accounts', '#what-is-posted', '#sales-tax-collected-by-aglyn', '#one-summary-a-day-instead', '#currency', '#sales-before-you-connected', '#when-something-does-not-post', '#disconnect'],
  connectXero: ['#before-you-start', '#connect', '#choose-your-accounts', '#what-is-posted', '#sales-tax-collected-by-aglyn', '#one-summary-a-day-instead', '#currency', '#sales-before-you-connected', '#when-something-does-not-post', '#disconnect'],
  consoleTour: ['#the-app-bar', '#in-context-help', '#filter-and-search', '#primary-navigation', '#editing-vs-managing', '#the-sites-list', '#the-status-pill', '#how-the-pill-is-decided', '#your-site-allowance', '#a-sites-dashboard', '#next', '#workspace-settings--notifications', '#the-notifications-feed', '#notification-levels', '#notification-settings', '#one-kind-at-a-time', '#workspace-and-site-overrides', '#daily-digests', '#alerts-on-this-device'],
  contactActivities: ['#four-kinds-of-history', '#reading-the-timeline', '#campaign-email', '#logging-an-activity', '#meeting-from-a-booking', '#click-to-call', '#sending-an-email', '#delivery-states', '#captured-email', '#where-an-activity-is-visible', '#the-recent-activity-feed', '#related'],
  contactFields: ['#define-a-field', '#fields-per-record', '#where-values-show', '#save-a-form-field', '#picklist-values', '#task-picklists', '#over-the-api', '#retire-restore-delete', '#export-fields', '#recompute-next-activity', '#related'],
  contactRecord: ['#adding-a-contact-by-hand', '#the-record-page', '#the-standard-fields', '#do-not-call', '#deleting-and-erasing', '#what-each-site-keeps-to-itself', '#when-sites-join-or-leave-a-group', '#merging-two-records', '#likely-duplicates', '#owner', '#last-engaged', '#lifecycle-stages', '#where-the-persons-lead-is', '#finding-a-contact', '#files', '#related'],
  contacts: ['#whats-in-the-crm-area', '#unified-ingestion', '#what-each-plan-includes', '#the-contacts-page', '#import-and-export', '#segments', '#everywhere-the-crm-shows-up', '#capture-replies', '#at-the-organization-level', '#who-can-open-the-crm', '#one-sender-one-crm', '#related'],
  couriers: ['#who-pays', '#connect-doordash-drive', '#webhook', '#send-a-courier', '#cancel', '#what-your-buyer-sees', '#uber-direct'],
  crmEmailTemplates: ['#templates-and-snippets', '#merge-fields', '#saving', '#managing-templates', '#duplicate-a-template', '#shared-or-personal', '#over-the-rest-api', '#related'],
  crmLeads: ['#what-makes-a-lead', '#what-a-lead-holds', '#lead-source-filled-in', '#adding-a-lead-by-hand', '#the-leads-list', '#lead-statuses', '#filter-the-leads', '#working-a-lead-from-the-row', '#several-leads-at-once', '#import-from-csv', '#who-owns-a-lead', '#a-leads-page', '#email-state', '#converting-a-lead', '#unqualifying-a-lead', '#erasing-the-person', '#who-can-do-this', '#related'],
  crmReports: ['#choosing-a-period', '#contacts', '#sources-and-lifecycle', '#conversion-by-source', '#lead-funnel', '#lead-sources', '#pipeline', '#forecast-by-close-month', '#by-forecast-category', '#won-and-lost', '#won-and-lost-by-owner', '#activity-by-teammate', '#tasks', '#exporting-a-table', '#crm-at-a-glance', '#how-the-numbers-are-counted', '#related'],
  crmSettings: ['#companies', '#create-companies-from-work-email-domains', '#default-owner', '#assignment-rules', '#round-robin', '#email-templates', '#email-capture', '#your-sending-addresses', '#recipes', '#related'],
  crmSharing: ['#what-a-shared-record-looks-like', '#share-a-record-by-hand', '#several-records-at-once', '#sharing-rules', '#access-read-only-or-read-and-edit', '#sharing-is-not-consent', '#who-can-do-this', '#related'],
  crmTasks: ['#task-picklists', '#the-tasks-page', '#the-calendar-view', '#snoozing-a-task', '#selecting-exporting-and-acting-on-many', '#import-from-csv', '#creating-a-task', '#assigning-a-task-to-someone-else', '#completing-and-reopening', '#organization-tasks', '#tasks-on-a-contact-company-or-deal', '#reminders', '#turning-reminders-off', '#next-activity', '#the-daily-digest', '#turning-it-off', '#the-dashboard-card', '#who-can-do-what', '#related'],
  crmViews: ['#the-views-control', '#a-view-is-a-link', '#filters', '#filters-on-the-contacts-list', '#filters-on-the-other-lists', '#columns-and-sort', '#segments-and-views', '#who-sees-what', '#related'],
  datasets: ['#model-builder', '#typed-documents', '#filter-records', '#relations', '#query-layer', '#repeatable-components', '#record-pages', '#who-a-dataset-is-shared-with', '#import--export', '#related'],
  deals: ['#pipelines', '#stages', '#the-board-and-the-table', '#import-from-csv', '#creating-a-deal', '#type-and-lead-source', '#contact-roles', '#line-items', '#moving-winning-and-losing', '#a-won-deal-makes-its-contact-a-customer', '#a-deals-page', '#files', '#related'],
  deliveryApps: ['#connect-a-store', '#the-menu', '#match-items', '#taking-orders'],
  designedEmails: ['#create-a-template', '#find-a-template', '#duplicate-a-template', '#styling-email-blocks', '#merge-tokens', '#send-it', '#the-plain-text-version', '#start-from-a-brief-instead'],
  emailCampaigns: ['#send-a-campaign', '#campaigns-belong-to-the-organization', '#organization-emails-page', '#campaigns-group-emails', '#filter-the-lists', '#what-belongs-to-a-campaign', '#who-the-email-comes-from', '#sending-domains', '#account-email-always-sends', '#marketing-needs-a-domain', '#two-ways-to-get-a-domain', '#a-domain-we-set-up-is-a-request', '#domain-states', '#senders', '#send-a-test', '#preview-the-email', '#monthly-send-cap', '#personalize-with-merge-tags', '#recipient-count', '#who-a-campaign-is-allowed-to-reach', '#schedule-a-send', '#held-for-review', '#duplicate-an-email', '#email-lists', '#manual-lists', '#list-members', '#add-to-a-list', '#import-a-list', '#export-a-list', '#remove-from-a-list', '#lists-built-from-a-rule', '#experiments', '#experiments-across-sites', '#opens--clicks', '#the-campaign-report', '#per-contact-engagement', '#which-links-were-clicked', '#revenue-from-a-campaign', '#how-a-visit-is-credited', '#utm-labels', '#who-it-reached', '#conversions', '#compliance', '#list-unsubscribe', '#topics', '#preference-page', '#consent-groups', '#consent-group-create', '#consent-group-join', '#consent-group-leave', '#consent-group-rename', '#consent-group-progress', '#frequency-opt-down', '#double-opt-in', '#consent-group-confirmation', '#marketing-mail', '#frequency-cap', '#suppressions', '#add-a-suppression', '#import-export-suppressions', '#platform-suppressions', '#related'],
  emailPlatforms: ['#connect', '#who-is-sent', '#unsubscribes-from-the-platform', '#settings', '#sync-log', '#disconnect', '#one-off-imports'],
  events: ['#manage-events', '#import-and-export-events', '#columns', '#how-a-row-finds-an-existing-event', '#conflicts-the-dry-run-and-undo', '#files-from-other-calendars', '#show-events-on-a-screen', '#search-engines', '#related'],
  forms: ['#reading-submissions-from-code', '#build-a-form', '#place-a-saved-form', '#saved-forms-per-site', '#monthly-allowance-per-plan', '#spam-and-abuse-protection', '#the-per-site-monthly-ceiling', '#field-types', '#labels-and-placeholders', '#example-a-quick-survey', '#after-submit', '#example-grow-an-email-list-from-a-signup-form', '#consent-group-disclosure', '#where-submissions-go', '#the-inbox', '#filter-the-inbox', '#who-a-submission-is-from', '#what-it-links-to', '#where-this-one-went', '#replying-to-a-submission', '#every-sites-inbox-at-once', '#one-forms-own-page', '#export-submissions', '#find-a-form', '#duplicate-a-form', '#switch-forms-off-for-one-site', '#related'],
  fulfillmentNetworks: ['#connect-a-network', '#shipmonk-connect-with-your-api-key', '#settings', '#how-orders-are-sent', '#stock-counts', '#shipments-and-tracking', '#canceling-and-refunds', '#activity'],
  funnels: ['#step-types', '#how-it-counts', '#what-is-a-visit', '#identified-visitors', '#create', '#create-with-ai', '#drafts', '#act-on-drop-off', '#ask-ai'],
  installYourFirstPlugin: ['#before-you-start', '#step-1-open', '#step-2-browse', '#step-3-reviews', '#step-4-targeting', '#step-5-install', '#step-6-use', '#step-7-off', '#what-to-do-next', '#related'],
  inventorySync: ['#connect-a-system', '#stock-counts', '#products', '#orders', '#canceling-and-refunds', '#activity'],
  inviteTeammates: ['#invite-someone', '#pending-invites', '#who-gets-told', '#accepting-an-invite', '#declining-an-invite', '#an-ordinary-invitation-never-changes-who-owns-the-workspace', '#owner-handoff', '#aglyn-staff', '#how-team-members-act', '#you-are-a-site-collaborators-support-channel', '#help-a-teammate-who-is-locked-out', '#why-you-cant-always-set-a-password', '#activity-log', '#ai-actions', '#ai-usage', '#ai-allotment', '#tips', '#related'],
  loyalty: ['#set-up-your-program', '#how-customers-earn', '#spending-rewards-online', '#at-the-register', '#referrals', '#members-and-store-credit', '#on-an-order', '#refunds-and-cancellations', '#emails', '#switching-it-off-for-a-site'],
  loyaltyConnectors: ['#connect-your-account', '#who-earns', '#when-something-is-not-sent', '#disconnect'],
  manifestAndEnvs: ['#plugin-manifest-published-with-every-version', '#contributes--where-the-plugin-loads', '#config--settings-without-writing-a-settings-screen', '#listing--version-documents', '#review--trust-lifecycle', '#environment-variables', '#pluginsconfigjson-first-party-contributors'],
  marketingOverlays: ['#announcement-bar', '#promotional-popups', '#frequency', '#popup-v2', '#multiple-overlays-scheduling--page-targeting', '#with-ai', '#variables-in-copy', '#engagement-stats', '#across-your-sites', '#related'],
  marketplaces: ['#connect-a-marketplace', '#listings', '#orders', '#activity'],
  membersOnly: ['#let-visitors-sign-up', '#sign-in-sign-up-and-recovery-pages', '#forgotten-passwords', '#gate-a-screen', '#manage-your-members', '#suspend-or-reactivate-a-member', '#tips', '#related'],
  ordersAndReturns: ['#fulfillment', '#invoices', '#returns', '#buyer-requests', '#run-a-return', '#order-webhooks', '#what-your-endpoint-receives', '#check-the-signature', '#answer-quickly-and-retries', '#related'],
  orgAutomations: ['#what-an-org-automation-is', '#create-one', '#triggers', '#steps', '#pause-it-on-one-site', '#waiting-switching-off-and-deleting', '#every-sites-own-automations', '#related'],
  plugins: ['#install--upgrade', '#browse-card', '#whats-included', '#what-the-badges-on-a-listing-mean', '#how-plugins-run', '#when-one-plugin-depends-on-another', '#a-dependency-that-is-off-for-one-site', '#configure', '#configure-site', '#publish-your-own', '#related'],
  pos: ['#registers', '#the-register', '#modifiers', '#selling-past-the-count', '#taking-payment', '#platform-fees-at-the-register', '#when-something-disconnects', '#tips', '#receipts', '#card-readers', '#customer-display', '#self-service-kiosk', '#reservations', '#related'],
  posHardware: ['#recommended-kit', '#card-readers', '#receipt-printers', '#add-a-printer', '#what-prints', '#your-logo-on-the-receipt', '#status', '#cash-drawer', '#barcode-scanning', '#label-printers', '#product-labels', '#shipping-labels', '#customer-display-tablet', '#related'],
  posOperations: ['#shifts-and-the-cash-drawer', '#what-the-reports-show', '#shift-history', '#requiring-a-shift', '#who-rang-it', '#staff-pins', '#customers-at-the-register', '#returns-and-exchanges', '#refund-limits-and-manager-approval', '#printed-receipts', '#selling-while-offline', '#what-the-sync-checks', '#before-you-go-offline', '#related'],
  postPurchase: ['#connect-a-service', '#afterships-webhook', '#package-protection-at-checkout', '#branded-tracking-pages', '#on-the-order', '#switching-it-off-for-a-site'],
  printOnDemand: ['#before-you-start', '#connect', '#import-products', '#costs-and-margins', '#orders', '#test-orders', '#canceling-and-refunding', '#shipments-and-tracking', '#disconnect', '#what-is-sent-to-the-service'],
  publishAPlugin: ['#the-publish-pipeline', '#private-plugins', '#paid-listings', '#your-publisher-profile', '#tips', '#related'],
  publisherHandbook: ['#before-your-first-publish', '#the-publisher-agreement', '#where-to-publish-from', '#what-installing-each-type-does', '#rules-an-email-starter-has-to-meet', '#publishing-a-version', '#before-you-publish', '#review-what-happens-after-you-publish', '#the-two-badges-and-what-each-one-promises', '#asking-to-be-verified', '#testing-a-version-before-it-is-approved', '#watching-your-own-submission', '#disabled-versions', '#private-plugins', '#authoring-your-listing', '#what-your-listing-can-say-about-aglyn', '#versioning--updates', '#shipping-a-new-version', '#how-installs-work-the-buyer-side', '#getting-paid', '#low-prices-and-processing'],
  redirects: ['#manage-redirects', '#sending-visitors-to-another-site', '#import-and-export', '#columns', '#how-a-row-finds-an-existing-rule', '#conflicts-the-dry-run-and-undo', '#metrics', '#match-modes-v2', '#related'],
  salesChannels: ['#turn-on-a-channel', '#keep-the-address-private', '#what-each-product-sends', '#brand-barcode-and-category', '#shipping', '#check-your-products', '#how-fresh-the-feed-is', '#earlier-merchant-center-address', '#turn-off', '#related'],
  sandboxSecurity: ['#a-separate-origin', '#per-manifest-network-policy', '#when-you-cant-declare-the-origin', '#pinned-immutable-artifacts', '#what-this-means-when-you-build', '#related'],
  sequences: ['#what-it-is-for', '#sent-from-your-own-mailbox', '#where-it-lives', '#self-hosted', '#connect-a-mailbox', '#send-as', '#daily-cap', '#mailbox-status', '#auto-pause', '#mailbox-actions', '#link-domains', '#compliance-settings', '#allowed-countries', '#do-not-contact-domains', '#import-export-do-not-contact', '#sequences', '#build-a-sequence', '#count-opens', '#send-a-test', '#sequence-status', '#enroll', '#start-at-step', '#mail-gateways', '#cold-contacts', '#enrollments', '#person-history', '#curate', '#sending', '#what-stops-a-sequence', '#unsubscribe', '#related'],
  shipping: ['#zones-and-rates', '#where-parcels-ship-from', '#carrier-accounts', '#shipping-labels'],
  shippingEasy: ['#before-you-start', '#connect', '#what-is-sent', '#ship', '#manage', '#troubleshooting', '#related'],
  shipStation: ['#connect', '#what-imports', '#ship', '#manage', '#troubleshooting', '#related'],
  staffConsole: ['#runbooks', '#whats-there', '#staff-overview', '#support-queue', '#plugin-reviews', '#organizations-admin', '#filter-the-directory', '#organization-detail', '#staff-org-email', '#free-workspace-limit', '#first-party-hosts', '#entitlement-editor', '#plan-comps', '#build-for-a-client', '#sites-admin', '#filter-the-site-list', '#site-detail', '#site-ownership', '#site-transfer', '#site-content', '#staff-automations', '#emails-sent', '#users-admin', '#acquisition', '#password-help', '#sign-one-device-out', '#email-delivery', '#import-delivery-history', '#staff-notes', '#broadcast-announcements', '#billing-insight', '#refunds', '#impersonation', '#system-emails', '#platform-send-rate', '#platform-suppressions', '#feature-flags', '#multi-tenant-architecture', '#audit-archival', '#organization-suspension', '#operator-alerts', '#ai-monitoring', '#sales-tax-return', '#audit-log', '#coupons', '#discount-floors', '#existing-coupons', '#contact-suppressions', '#access', '#which-identity-holds-staff', '#staff-inside-a-customers-tenant--a-property-worth-knowing', '#offboarding', '#break-glass-access', '#requiring-sso-for-a-company-domain', '#why-am-i-getting-a-404', '#related'],
  taxServices: ['#before-you-start', '#connect', '#when-the-service-is-not-used', '#how-sales-are-taxed', '#product-tax-codes', '#exempt-customers', '#recording-orders-and-refunds', '#disconnect', '#what-is-sent-to-the-vendor'],
  webhooks: ['#outbound-webhooks', '#slack', '#inbound-webhooks', '#tips', '#related'],
  zapier: ['#connect-aglyn-to-zapier', '#triggers', '#actions-and-searches', '#what-each-needs', '#see-and-disconnect-your-zaps'],
} as const satisfies Partial<Record<PluginDocsKey, readonly `#${string}`[]>>

type PluginAnchorMap = typeof PLUGIN_DOCS_ANCHORS

/** Valid heading anchors for a plugin docs page (`never` when none). */
export type PluginDocsAnchor<K extends PluginDocsKey> =
  K extends keyof PluginAnchorMap ? PluginAnchorMap[K][number] : never
