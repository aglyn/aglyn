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
  aiAllotments: {
    path: '/ai/ai-allotments',
    title: 'AI allotments, usage and model choice',
    excerpt: 'Give a member, a site collaborator or a whole site a monthly share of the workspace\'s AI credits, see your own usage while you work, and choose which model answers.',
  },
  aiAssistBuilds: {
    path: '/ai/assist-builds',
    title: 'Build from Assist chat',
    excerpt: 'Ask Aglyn Assist for what you need in one message — pages, a form, an email, products, a booking service, an automation — and it shows one plan card. Confirm it and one job builds every part as a draft.',
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
  aiComponent: {
    path: '/building-sites/components/generate-a-component-with-aglyn-ai',
    title: 'Generate a reusable component with Aglyn AI',
    excerpt: 'Describe a block your site repeats, or point at one already on a page, and Aglyn AI makes it a reusable component with typed properties bound to the elements that show them.',
  },
  aiCreate: {
    path: '/ai/create-with-ai',
    title: 'Create with AI on every list',
    excerpt: 'The Create with AI button sits beside the create button on every list Aglyn AI can fill: pages, templates, layouts, forms, components, emails, campaigns, automations, products, overlays and media.',
  },
  aiCredits: {
    path: '/ai/ai-credits',
    title: 'AI credits',
    excerpt: 'Everything Aglyn AI does draws AI credits from one monthly pool: what each plan includes (300 on Free), what the add-on adds, what jobs cost, the check before a job starts, and when credits come back.',
  },
  aiCrm: {
    path: '/ai/crm-by-ai',
    title: 'The AI CRM built into Aglyn',
    excerpt: 'An AI CRM for small business: a short summary and a suggested next step on a contact, company, deal or lead, a one-to-one email drafted into the composer, and an import\'s columns matched to fields.',
  },
  aiEmail: {
    path: '/marketing-and-automation/email-campaigns/generate-with-ai',
    title: 'Generate an email campaign with AI',
    excerpt: 'An AI email campaign generator that drafts rather than sends: turn a brief into a draft email design, or a draft campaign and the email it would send. Nothing is sent, and nothing is aimed at anybody, until you choose.',
  },
  aiExperiments: {
    path: '/ai/ab-tests-with-ai',
    title: 'A/B tests by AI: write variants, read the result',
    excerpt: 'Have Aglyn AI write two to four variants for a page, section or email experiment, and put a finished test into plain language — with the verdict decided from the counts before the model is asked anything.',
  },
  aiForm: {
    path: '/ai/generate-a-form',
    title: 'Generate a form from a description',
    excerpt: 'An AI form generator inside Aglyn: describe the form you need and a build job makes it as a draft on the Forms page, with its fields, required answers, marketing consent and routing already agreed.',
  },
  aiImages: {
    path: '/ai/create-images',
    title: 'Create images with AI',
    excerpt: 'An AI image generator in the Aglyn media library: describe a picture and get an SVG icon or logo mark, a realistic photo, a watercolor, a 3D render or a banner, with alt text. Metered in AI credits.',
  },
  aiInsights: {
    path: '/marketing-and-automation/analytics/insights',
    title: 'Insights',
    excerpt: 'Ask Aglyn AI a question about your site\'s figures in plain words, and get answers where every number is traced to the figure it comes from — plus weekly insights by email.',
  },
  aiJobs: {
    path: '/ai/ai-jobs-and-activity',
    title: 'AI jobs and activity',
    excerpt: 'Review what Aglyn AI did: a site\'s AI jobs page lists every job with its kind, brief, status and credits, each job has its own page, and the AI filter in your activity logs records who started, applied or canceled what.',
  },
  aiLayout: {
    path: '/building-sites/screens-and-layouts/layouts',
    title: 'Layouts',
    excerpt: 'A layout is the shared frame your pages render inside — header, nav and footer in one place, nested up to five deep.',
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
  aiPage: {
    path: '/building-sites/screens-and-layouts/generate-a-page',
    title: 'Generate a page from a prompt',
    excerpt: 'An AI landing page generator built into the canvas: describe a page and Aglyn AI plans it, then builds it section by section as an unpublished draft from your own theme, layout, components and forms.',
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
  aiSite: {
    path: '/ai/generate-a-site',
    title: 'Generate a website from a prompt',
    excerpt: 'Generate a website from a prompt: describe a business and an Aglyn AI build job plans a small site — pages, navigation, layout, contact form and palette — then builds it. A guided start publishes it.',
  },
  aiSiteLooks: {
    path: '/ai/site-looks',
    title: 'Looks and themes for AI sites',
    excerpt: 'How a site started with AI gets its look: the style you choose sets the range of themes, colors, fonts and buttons, and every site gets its own readable variation, saved as a theme you can edit.',
  },
  aiStart: {
    path: '/ai/start-with-ai',
    title: 'Start a new site with AI',
    excerpt: 'Answer a few questions when you create a site and Aglyn AI plans, writes and publishes it: its look, header and footer, contact form and pages, plus a store or a blog when that is what the site is.',
  },
  aiTemplate: {
    path: '/building-sites/site-templates/templates-library',
    title: 'Your templates library',
    excerpt: 'Save pages, components and layouts as reusable templates — and the safe landing place for anything you install from the marketplace.',
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
  orderNotifications: {
    path: '/commerce-and-bookings/commerce/order-notifications',
    title: 'Order emails & status page',
    excerpt: 'The emails your customers get about their orders, the private order status page they link to, and how to resend a receipt.',
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
  aiAllotments: ['#allotments', '#hard-or-soft', '#the-pool-comes-first', '#limiting-models', '#who-can-set-them', '#a-members-allotment', '#a-sites-allotment', '#usage-strip', '#choosing-a-model', '#related'],
  aiAssistBuilds: ['#ask-or-build', '#what-it-can-build', '#the-plan-card', '#confirm-the-plan', '#one-job-many-parts', '#what-it-costs', '#who-can-use-it', '#related'],
  aiAutomations: ['#draft', '#org-automations', '#change', '#explain', '#why-a-run-failed', '#what-is-sent', '#who-can-use-it', '#related'],
  aiBusinessProfile: ['#where-to-edit-it', '#the-business-profile-card', '#where-the-values-come-from', '#workspace-defaults', '#contact-details-are-never-invented', '#what-aglyn-ai-learned', '#which-jobs-read-it', '#related'],
  aiComponent: ['#from-a-brief', '#what-the-job-builds', '#optional-parts', '#defaults', '#where-it-lands', '#from-a-section-on-your-page', '#related'],
  aiCreate: ['#the-button', '#where-it-appears', '#what-you-get', '#without-the-add-on', '#when-it-is-not-there', '#related'],
  aiCredits: ['#monthly-credits', '#free-plan', '#the-aglyn-ai-add-on', '#what-things-cost', '#before-a-job-starts', '#when-credits-run-out', '#past-the-band', '#credits-given-back', '#see-your-credits', '#related'],
  aiCrm: ['#summarize-a-record', '#summaries-are-reused-until-the-record-changes', '#draft-an-email', '#match-columns', '#what-is-sent', '#who-can-use-it', '#related'],
  aiEmail: ['#where-to-start-it', '#what-you-get', '#write-the-brief', '#products', '#who-receives-it', '#merge-tokens', '#what-it-will-not-do', '#where-it-runs', '#related'],
  aiExperiments: ['#it-proposes-you-write', '#write-variants', '#putting-them-in', '#draft-versions', '#what-it-will-not-write', '#read-a-result', '#the-verdict', '#the-words', '#undecided', '#what-is-sent', '#who-can-use-it', '#related'],
  aiForm: ['#describe-the-form', '#what-the-form-gets', '#what-a-form-cannot-collect', '#nothing-is-live-until-you-place-it', '#who-can-use-it', '#related'],
  aiImages: ['#make-a-picture', '#shapes-and-how-many', '#what-each-picture-gets', '#credits', '#safety', '#declined-pictures', '#what-is-sent', '#who-can-use-it', '#related'],
  aiInsights: ['#asking-a-question', '#how-an-answer-is-made', '#asking-about-datasets', '#weekly-insights', '#privacy'],
  aiJobs: ['#the-ai-jobs-page', '#statuses', '#one-jobs-page', '#ai-jobs-in-assist', '#cancel-a-job', '#ai-activity', '#how-long-jobs-are-kept', '#related'],
  aiLayout: ['#what-a-layout-is', '#find-a-layout', '#nested-layouts', '#layout-properties', '#restyle-the-layout-on-one-page', '#duplicate', '#generate-a-layout-with-aglyn-ai', '#used-by', '#layouts-vs-reusable-components', '#related'],
  aiLogic: ['#function', '#variable', '#change', '#broken-references', '#what-is-sent', '#who-can-use-it', '#related'],
  aiMarketing: ['#write-overlay-copy', '#create-an-overlay', '#create-a-campaign', '#ask-about-these-numbers', '#what-is-sent', '#who-can-use-it', '#related'],
  aiMonitoring: ['#the-ai-card', '#compensating-credits', '#ai-conversations', '#where-else', '#one-account', '#the-spend-leaderboard', '#alerts', '#related'],
  aiPage: ['#describe-the-page', '#review-the-plan', '#how-the-page-is-built', '#the-draft', '#what-a-page-job-uses', '#who-can-use-it', '#related'],
  aiProducts: ['#write-a-products-copy', '#write-copy-for-many-products', '#when-you-import-products', '#propose-a-first-catalog', '#propose-categories-and-discounts', '#what-the-copy-never-says', '#what-is-sent-to-the-ai-provider', '#who-can-use-it', '#related'],
  aiSeo: ['#write-a-pages-listing', '#write-a-products-listing', '#fix-what-the-seo-check-finds', '#apply-all-as-drafts', '#structured-data-and-llmstxt', '#related'],
  aiSite: ['#starting-a-new-site-from-a-few-questions', '#on-the-free-plan', '#if-the-plan-does-not-work-out', '#what-a-scaffold-builds', '#what-is-published', '#what-it-costs-before-it-starts', '#watching-it-build', '#generate-for-several-sites-at-once'],
  aiSiteLooks: ['#choose-a-style', '#how-the-look-is-made', '#your-theme-afterwards', '#change-the-look-later', '#related'],
  aiStart: ['#how-do-you-want-to-start', '#your-business', '#style', '#details', '#what-it-will-cost', '#what-gets-built', '#building-your-site', '#paused-or-out-of-credits', '#try-again', '#published-and-indexable', '#the-sites-search-listing', '#a-store-from-the-start', '#a-blog-from-the-start', '#on-the-free-plan', '#who-can-use-it', '#related'],
  aiTemplate: ['#the-three-kinds', '#installing-from-the-marketplace', '#saving-something-as-a-template', '#using-a-template', '#generate-a-page-template-with-aglyn-ai', '#where-a-template-came-from', '#first-party-starters', '#templates-are-per-site', '#duplicating', '#deleting', '#related'],
  aiThemes: ['#describe-a-change', '#match-your-brand', '#review-the-proposal', '#save-it-or-dont', '#who-can-use-it', '#related'],
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
  orderNotifications: ['#customer-emails', '#tracking-links', '#turning-emails-off', '#changing-the-wording-and-colors', '#order-status-page', '#resend-receipt', '#text-messages', '#related'],
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

/**
 * The heading and its opening sentence for each anchor a plugin links — the
 * tooltip when a call names an anchor and nothing of its own (AGL-3707). Only
 * the linked anchors: this module is imported synchronously by every plugin
 * console.
 */
export const PLUGIN_DOCS_SECTIONS: {
  readonly [K in PluginDocsKey]?: {
    readonly [anchor: `#${string}`]: { readonly title: string; readonly excerpt: string }
  }
} = {
  abuseReports: {
    '#counter-notices': { title: 'Counter-notices — the put-back', excerpt: 'A subscriber whose material we removed can answer with a counter-notice under §512(g).' },
    '#statuses': { title: 'Statuses', excerpt: 'Dismissed is not the same as unread. If you dismiss without a reason, the next person to receive a report about the same site has no idea whether we already considered it.' },
    '#triage-by-severity': { title: 'Triage by severity', excerpt: 'Every category carries a severity. It is not a mood — it says how fast a human has to look.' },
  },
  actionsBuilder: {
    '#create-an-action': { title: 'Create an action', excerpt: 'Open the actions builder from Automation → Actions. That\'s it — no multi-step logic to manage.' },
  },
  aglynAssist: {
    '#what-it-can-do': { title: 'What it can do', excerpt: 'Answer how-to questions about building sites, publishing, domains, commerce, bookings, workflows, datasets, team roles, and billing.' },
  },
  aiAllotments: {
    '#a-members-allotment': { title: 'A member\'s allotment', excerpt: 'The AI allotment card on a member\'s page under Team is that person\'s share of the workspace\'s credits each month: one figure across every site for a team member, or one per site for a site collaborator.' },
    '#a-sites-allotment': { title: 'A site\'s allotment', excerpt: 'The Site AI allotment card on a site\'s Users page is what everyone on that site may draw together each month.' },
    '#allotments': { title: 'Allotments', excerpt: 'An allotment is a number of credits a month, counted from the first of the month (UTC).' },
    '#choosing-a-model': { title: 'Choosing a model', excerpt: 'The Model switch beside the assistant\'s message box and in each AI dialog lists: Auto, the default.' },
    '#usage-strip': { title: 'Your usage while you work', excerpt: 'The assistant panel and the AI dialogs in the Besigner show a compact usage line once you have made a request: You — your credits this month, against your allotment when one applies.' },
  },
  aiAssistBuilds: {
    '#the-plan-card': { title: 'The plan card', excerpt: 'The card shows Planning what to build on this site… while the plan is made, then the Proposed plan, one line per part: Reuses something the site already has, and what for;' },
  },
  aiAutomations: {
    '#change': { title: 'Change or fix an automation', excerpt: 'Open a saved action and use the box under Explain it: Change with AI — describe the change: "also tag them newsletter, and wait a day before the email".' },
    '#draft': { title: 'Draft an automation from a description', excerpt: 'Choose Create with AI beside Add action and Recipes on Automation → Actions, or at the top of Automation → Workflows (in its empty state while it has none).' },
    '#explain': { title: 'Explain an automation', excerpt: 'Open a saved action or workflow and choose Explain it at the top of the editor.' },
    '#org-automations': { title: 'Draft an org automation', excerpt: 'An org automation is written once for your workspace and runs on the sites you choose.' },
  },
  aiBusinessProfile: {
    '#what-aglyn-ai-learned': { title: 'What Aglyn AI learned', excerpt: 'When you apply an Assist edit that shows a preference, such as asking for shorter copy, a friendlier tone, no emoji, or removing a testimonials section, Aglyn AI keeps that as a short preference for the site.' },
  },
  aiComponent: {
    '#from-a-brief': { title: 'From a brief', excerpt: 'Open Components for the site and choose Create with AI, beside Templates and Create Component.' },
  },
  aiCreate: {
    '#without-the-add-on': { title: 'Without the add-on', excerpt: 'On a paid plan without the Aglyn AI add-on, the button is still there.' },
  },
  aiCredits: {
    '#before-a-job-starts': { title: 'Before a job starts', excerpt: 'Every job tells you what it will cost before it spends anything: A plan shows Estimated cost: about N credits beside Confirm plan.' },
    '#past-the-band': { title: 'Past the band', excerpt: 'On a paid plan, AI keeps working past the included band, and the extra credits are billed on your monthly invoice at your plan\'s rate per 1,000 credits.' },
    '#see-your-credits': { title: 'See your credits', excerpt: 'Billing → Usage → AI credits shows the credits drawn this month against the included band, and what the add-on adds.' },
  },
  aiCrm: {
    '#draft-an-email': { title: 'Draft a one-to-one email', excerpt: 'In the email composer on a contact, a deal or a lead, describe what the email should say (for example, "follow up on the quote and offer a call next week") and press Draft the message.' },
    '#match-columns': { title: 'Match an import\'s columns', excerpt: 'In a contacts, companies, deals or leads import, choose your file, then press Match columns.' },
    '#summarize-a-record': { title: 'Summarize a record', excerpt: 'On a contact\'s, company\'s, deal\'s or lead\'s page, Summarize this contact (or company, deal or lead) writes at most two sentences from the record\'s timeline: when it was last in touch and how, and what is still open.' },
  },
  aiEmail: {
    '#where-to-start-it': { title: 'Where to start it', excerpt: 'An email design: on a site\'s Emails page, open Templates and press Create with AI, beside New template (or beside Create your first template while the list is empty).' },
    '#write-the-brief': { title: 'Write the brief', excerpt: 'Say what the email is for, who it speaks to, and what you want the reader to do.' },
  },
  aiExperiments: {
    '#the-verdict': { title: 'The verdict is decided before the model is asked', excerpt: 'This is the part worth understanding, because it is the opposite of how it looks.' },
    '#write-variants': { title: 'Write variants', excerpt: 'The card sits in the experiment editor, beneath the list of variants it writes for.' },
  },
  aiForm: {
    '#describe-the-form': { title: 'Describe the form', excerpt: 'Open Forms for the site and choose Create with AI, beside Create Form.' },
  },
  aiImages: {
    '#credits': { title: 'Credits', excerpt: 'Pictures are metered in AI credits from the workspace\'s pool.' },
    '#declined-pictures': { title: 'Declined pictures', excerpt: 'When the image service declines a whole description, the window says The image service declined this description.' },
    '#make-a-picture': { title: 'Make a picture', excerpt: 'Open Media, on a site or for the organization, and open the folder the pictures should land in.' },
    '#shapes-and-how-many': { title: 'Shapes and how many', excerpt: 'Shape: Square 1:1, Landscape 4:3, Portrait 3:4, Wide 16:9 or Tall 9:16.' },
    '#who-can-use-it': { title: 'Who can use it', excerpt: 'Creating images needs the Generate with AI permission and a plan that includes AI generation — see who can use Aglyn AI.' },
  },
  aiInsights: {
    '#asking-a-question': { title: 'Asking a question', excerpt: 'Choose Ask a question on the Ask AI about these numbers card — on a site\'s dashboard, its Analytics page, and your organization\'s Sites page — or open the Assist panel on one of these pages and choose Ask about your…' },
  },
  aiJobs: {
    '#ai-jobs-in-assist': { title: 'AI jobs in Assist', excerpt: 'The AI jobs list at the top of the Assist panel follows the workspace\'s jobs wherever you are in the console.' },
  },
  aiLayout: {
    '#generate-a-layout-with-aglyn-ai': { title: 'Generate a layout with Aglyn AI', excerpt: 'An AI build job can make a layout from a brief: the header, navigation and footer you have in mind.' },
  },
  aiLogic: {
    '#change': { title: 'Change, fix or explain a function', excerpt: 'Open a saved function. The box at the top of its editor offers: Explain it — what the function works out from what it is given, operation by operation, and anything worth checking, such as a condition that can never…' },
    '#function': { title: 'Write a function from a description', excerpt: 'Choose Create with AI at the top of the Functions card and describe what it should work out — "a shipping quote: free over our free-shipping amount, otherwise the flat rate plus 2 per kilo".' },
    '#variable': { title: 'Write a variable', excerpt: 'Create with AI at the top of the Variables card writes one site variable — a name, a type and a value in that type\'s stored form, such as a dictionary of plan prices {"starter":19,"pro":49}.' },
  },
  aiMarketing: {
    '#create-a-campaign': { title: 'Create a campaign', excerpt: 'On Marketing → Campaigns, beside Create campaign and on the list while it is empty, Create with AI turns a brief into a campaign.' },
  },
  aiMonitoring: {
    '#ai-conversations': { title: 'AI conversations', excerpt: 'Below the AI card, AI conversations shows what people in the organization typed to Aglyn AI and what it answered.' },
    '#one-account': { title: 'One account, across organizations', excerpt: 'Staff → Users → an account carries a card named after the AI add-on with the account\'s credits in every workspace it belongs to, month by month — the same rollup the customer\'s Team and Usage pages read, kept…' },
    '#the-ai-card': { title: 'The AI card', excerpt: 'On Staff → Organizations → an organization, between Effective entitlements and Metered usage, the card named after the AI add-on carries everything about that organization\'s AI in one place.' },
    '#the-spend-leaderboard': { title: 'The spend leaderboard', excerpt: 'Staff → Assist signal opens with AI spend this month, by workspace: each organization\'s plan, whether the add-on is on, credits drawn, provider dollars and refusals for the current month, dearest first, above the…' },
  },
  aiPage: {
    '#describe-the-page': { title: 'Describe the page', excerpt: 'Open Pages for the site and choose Create with AI, beside Templates and Create New Page.' },
  },
  aiProducts: {
    '#propose-a-first-catalog': { title: 'Propose a first catalog', excerpt: 'On the products page, press Create with AI beside Add product (and beside Add your first product while the catalog is empty), or Propose products in Build your catalog with AI — both open the same brief.' },
    '#write-a-products-copy': { title: 'Write a product\'s copy', excerpt: 'In the product editor, under the description, tags and categories, Write with AI writes a proposal from what the product already says and shows.' },
  },
  aiSeo: {
    '#fix-what-the-seo-check-finds': { title: 'Fix what the SEO check finds', excerpt: 'The SEO check on Setup → SEO lists what is wrong with each page; it is free and needs no AI.' },
    '#write-a-pages-listing': { title: 'Write a page\'s listing', excerpt: 'On a page\'s detail view, the SEO card has a Write with AI section: Optionally add up to five target keywords, separated by commas.' },
    '#write-a-products-listing': { title: 'Write a product\'s listing', excerpt: 'In the product editor, the Search engine listing section has the same Write with AI control.' },
  },
  aiSite: {
    '#generate-for-several-sites-at-once': { title: 'Generate for several sites at once', excerpt: 'On the Sites page of your organization, Generate for several sites runs one brief across many of your sites, changing the business name, the city and the brand for each.' },
  },
  aiSiteLooks: {
    '#choose-a-style': { title: 'Choose a style', excerpt: 'The Style step of Start your site offers these styles. One is picked for you from what you said the site is; choose another to change it.' },
  },
  aiStart: {
    '#details': { title: 'Details', excerpt: 'Where do form submissions go? decides where messages from the site\'s contact form land: You can change this on the form itself afterwards.' },
    '#how-do-you-want-to-start': { title: 'How do you want to start?', excerpt: 'The first step offers two cards: Start from the starter site gives the site a ready-made home page with a header, footer and contact form, live at its address, for you to edit.' },
    '#the-sites-search-listing': { title: 'The site\'s search listing', excerpt: 'The site\'s own search title and description, the fallback for every page without its own, are not saved for you.' },
    '#your-business': { title: 'Your business', excerpt: 'What kind of site are you creating? is the one required answer.' },
  },
  aiTemplate: {
    '#generate-a-page-template-with-aglyn-ai': { title: 'Generate a page template with Aglyn AI', excerpt: 'An AI build job can make a page template for the pages your site builds from records it already keeps: each entry of a content collection (a blog post, an event, a case study), each product, or each author.' },
  },
  aiThemes: {
    '#describe-a-change': { title: 'Change what you describe, or design a new theme', excerpt: 'Change what I describe makes a targeted change. "Make it feel warmer" proposes new colors and leaves your font, corners and spacing alone; "bigger headings on mobile" changes heading sizes on phones and nothing else.' },
  },
  assistSignals: {
    '#docs-gaps': { title: 'Docs gaps', excerpt: 'Cited pages ranked by thumbs-down first, then by how often a question landed there.' },
    '#fleet': { title: 'Fleet', excerpt: 'Totals across the scanned sample: messages, tokens, estimated cost, the thumbs tally, and how turns stopped.' },
    '#questions-the-docs-could-not-answer': { title: 'Questions the docs could not answer', excerpt: 'A turn with no cited docs paths is a question the corpus could not match at all, so the model answered ungrounded — from its own knowledge of the product, with nothing to link.' },
    '#tokens-by-kind': { title: 'Tokens by kind', excerpt: 'What each kind of model request costs and weighs, one row per kind, dearest first: the console assistant (assist), the Besigner\'s copy modes (element, section, blog) and each generation job kind.' },
    '#what-assist-costs-by-workspace': { title: 'What Assist costs, by workspace', excerpt: 'The same estimated cost as Where the money goes, per workspace, dearest first, with each workspace\'s thumbs-down count beside it.' },
    '#what-people-actually-asked': { title: 'What people actually asked', excerpt: 'The verbatim question behind each failing turn, with the answer it got.' },
    '#where-the-money-goes': { title: 'Where the money goes', excerpt: 'Costs on this board are our estimated provider cost at the serving model\'s list rates.' },
  },
  billing: {
    '#billing-address': { title: 'Billing address', excerpt: 'The address Aglyn issues your invoices to, and the address sales tax on your Aglyn subscription is calculated from.' },
    '#billing-email': { title: 'Billing email', excerpt: 'Invoices are sent to the billing email, along with receipts and — the one that matters most — the notices we send when a card fails and a subscription is about to lapse.' },
    '#crm-records': { title: 'CRM records', excerpt: 'Your CRM — the contacts captured from forms, member sign-ups, buyers and bookings, and the companies and deals your team files beside them — is priced as one CRM records band, not a hard cap.' },
    '#one-to-one-email': { title: 'One-to-one email', excerpt: 'A one-to-one email is a message a teammate writes to one person from a CRM record — Send email on a contact\'s, a lead\'s or a deal\'s page, described under Activities & the timeline — as against a campaign, which is…' },
    '#outstanding': { title: 'Paying an outstanding invoice', excerpt: 'If a payment fails, the invoice stays open and the Billing page shows it with a Pay now button.' },
    '#payment-methods': { title: 'Payment methods', excerpt: 'The cards your subscription and any usage overage are charged to.' },
    '#payments': { title: 'Payments', excerpt: 'Billing runs through Stripe. Paid features (commerce, bookings, campaigns) share the same Stripe integration.' },
    '#plan-total': { title: 'What a plan will cost', excerpt: 'Before you subscribe, the Billing page quotes the plan you are looking at with tax included, taken from Stripe\'s own invoice preview rather than worked out here.' },
    '#seats': { title: 'Seats', excerpt: 'Team seats (workspace-wide) and per-site collaborator seats are metered and enforced per tier — seats cover the people who build and manage your sites.' },
    '#storage-overage': { title: 'Storage overage', excerpt: 'Your plan includes an amount of storage for each of its sites, and the workspace shares it as one allowance: every site\'s media library and the organization library draw on the same total.' },
    '#tax-ids': { title: 'Tax IDs', excerpt: 'A business tax ID — VAT, ABN, GST, EIN and the rest — printed on the invoices we issue you.' },
    '#tiers--entitlements': { title: 'Tiers & entitlements', excerpt: 'Transaction fees are Aglyn platform fees on the sales you take through your site — storefront orders, paid memberships and paid bookings alike — separate from Stripe\'s payment-processing fees.' },
    '#usage-budget': { title: 'Usage budget', excerpt: 'A usage budget is a monthly amount you choose, plus the percentages of it you want to hear about — the same shape as a Google Cloud billing budget.' },
    '#usage-meters': { title: 'Usage meters', excerpt: 'The billing page shows meters for every quota — storage, bandwidth, datasets, seats, sends, CRM records (with the contacts, companies and deals beneath the total), one-to-one emails sent today, AI assist credits,…' },
    '#who-is-generating-what': { title: 'Who is generating what', excerpt: 'Beneath the meters on Billing → Usage, a table lists each member\'s AI credits for a month — their share of the workspace\'s spend, requests, and how often the assistant refused them — dearest first, with the kinds of…' },
  },
  bindings: {
    '#insert-a-variable': { title: 'Insert a variable', excerpt: 'You never have to hand-type token syntax. Every text-capable attribute field in the Besigner (Text, Link URL, Image URL, …) has a small {x} insert button at its end.' },
    '#no-code-functions': { title: 'No-code functions', excerpt: 'Build functions in the in-editor function builder with a safe evaluator — no arbitrary code execution.' },
    '#typed-variables': { title: 'Typed variables', excerpt: 'Create typed site variables and reference them as {{name}} in any prop.' },
    '#where-used--safety': { title: 'Where-used & safety', excerpt: 'Before you rename or delete a variable or function, run the where-used scan to see every page and prop that references it, so changes are safe.' },
  },
  bookings: {
    '#manage': { title: 'Manage', excerpt: 'Use the console bookings page to see and manage upcoming appointments.' },
    '#reminders': { title: '24-hour reminders', excerpt: 'Every confirmed booking gets one reminder email roughly a day before it starts.' },
    '#set-up-bookings': { title: 'Set up bookings', excerpt: 'Define services (what can be booked, duration, price).' },
  },
  buildAWorkflow: {
    '#1-open-the-workflows-page': { title: '1. Open the workflows page', excerpt: 'In the console, go to Automation → Workflows and choose New workflow.' },
    '#4-save-and-test': { title: '4. Save and test', excerpt: 'Save the workflow. When the trigger fires, the workflow runs and each run counts once toward your tier\'s metered allowance — however many steps it has, and whatever they are.' },
  },
  catalog: {
    '#categories-and-tags': { title: 'Categories and tags', excerpt: 'Categories are hierarchical (each may have a parent) and slugged for URLs.' },
    '#products-options-and-variants': { title: 'Products, options, and variants', excerpt: 'A product is what you manage; a variant is what a customer actually buys.' },
  },
  commerce: {
    '#dropshipping': { title: 'Dropshipping', excerpt: 'Assign a supplier to a product and paid orders route automatically — by email and/or HMAC-signed webhook — with a token link the supplier uses to post tracking back, which fulfills the order.' },
    '#gift-cards': { title: 'Gift cards & store credit', excerpt: 'Gift cards lists every card your store has issued, what is left on each one, and what that adds up to.' },
    '#inventory': { title: 'Inventory', excerpt: 'Per-variant stock; blank = untracked, 0 = sold out.' },
    '#orders': { title: 'Orders', excerpt: 'Every paid checkout becomes an order with a sequential number, line-item snapshots, totals, and a timeline: Statuses: pending → paid → fulfilled (or partially) → delivered, with cancel/refund exits guarded by a…' },
    '#orders-screen': { title: 'The Orders page', excerpt: 'Open your site\'s Products hub and choose the Orders tab. Before your first sale the tab is an invitation rather than a table: it explains where orders come from and offers Draft order, so you can invoice a customer…' },
    '#payment-methods': { title: 'Payment methods', excerpt: 'Settings → Payment methods chooses what shoppers may pay with besides a card.' },
    '#pickup-and-local-delivery': { title: 'Pickup and local delivery', excerpt: 'Buyers can choose to pick up an order at one of your locations, or have your own driver deliver it, instead of shipping.' },
    '#products-hub': { title: 'Products hub', excerpt: 'The Products page is the catalog manager: Products with up to 3 options and 100 variants each — per-variant SKU, barcode, price, compare-at (sale badge), weight, and stock.' },
    '#recovery-and-alerts': { title: 'Recovery & alerts', excerpt: 'Two queues the storefront fills and Aglyn drains for you, both visible so you can see they are moving.' },
    '#shipping--taxes': { title: 'Shipping & taxes', excerpt: 'Shipping zones own countries (\'*\' = rest of world); rates are flat, free-over-subtotal, or subtotal/weight tiers; optional local pickup.' },
    '#stock-movements': { title: 'Stock movements', excerpt: 'Inventory → Stock movements is the history behind every tracked count — the answer to "the shelf says four and the console says six, what happened?"' },
    '#storefront-sales-tax': { title: 'Storefront sales tax', excerpt: 'Analytics → Storefront sales tax shows what your storefront collected in a period.' },
  },
  commerceEndToEnd: {
    '#1-connect-payments': { title: '1. Connect payments', excerpt: 'Aglyn sells from your own Stripe account via Stripe Connect.' },
    '#4-what-checkout-does': { title: '4. What checkout does', excerpt: 'Both buy buttons and the cart\'s Checkout open the payment form in place, on your own site, below the button.' },
    '#the-product-page-template': { title: 'The product page template', excerpt: 'Individual product URLs (/products/{slug}) render through a template page: design a page containing a Product detail block, then set it as the Product page template in the Products hub\'s Settings tab (store settings).' },
  },
  companies: {
    '#a-companys-page': { title: 'A company\'s page', excerpt: 'The page names the company in the heading and the trail, and holds its properties, its contacts, its deals, its open tasks and the activity logged against it.' },
    '#contacts-at-a-company': { title: 'Contacts at a company', excerpt: 'The Contacts card lists the people linked to this company a page at a time, most recently updated first, with the total counted by the database in its footer; each row opens the person\'s page.' },
    '#create-a-company': { title: 'Create a company', excerpt: 'Choose New company above the list. A company needs a name; everything else is optional: Domain — the bare hostname (acme.com).' },
    '#the-companies-list': { title: 'The companies list', excerpt: 'The list shows every company your site may see, most recently changed first, with its domain, how many contacts are linked to it, its owner, when it was last changed and its next activity — when the earliest open…' },
  },
  consoleTour: {
    '#a-sites-dashboard': { title: 'A site\'s dashboard', excerpt: 'Opening a site lands you on its dashboard.' },
    '#alerts-on-this-device': { title: 'Alerts on this device', excerpt: 'At the foot of the Settings section, three switches control how a new notification reaches you in this browser: Unread count in tab title — badges the browser tab, e.g.' },
    '#daily-digests': { title: 'Daily digests', excerpt: 'Daily CRM digest is on by default. Each morning it sends you one notification and one email listing your overdue and due-today tasks and the leads nobody has worked, across every workspace you belong to.' },
    '#notification-settings': { title: 'Notification settings', excerpt: 'Everything about what reaches you lives on the second section, Settings.' },
    '#the-app-bar': { title: 'The app bar', excerpt: 'Site switcher (left) — jump between the sites you belong to, search them by name with Find site…, or create a new one.' },
    '#the-sites-list': { title: 'The Sites list', excerpt: 'All Sites is the front door of a workspace: one card per site, for the workspace currently selected in the switcher, in name order.' },
    '#workspace-and-site-overrides': { title: 'Workspace and site overrides', excerpt: 'One workspace or one site sets the same answers for a single workspace or a single site, rather than for your whole account.' },
    '#workspace-settings--notifications': { title: 'Workspace settings & notifications', excerpt: 'Organization-wide settings (name, workspace URL) live under Organization → Settings, which also holds Profile, API keys, Branding, Single sign-on, Privacy, Ownership and Delete.' },
  },
  contactActivities: {
    '#four-kinds-of-history': { title: 'Four kinds of history', excerpt: 'A contact\'s timeline is one newest-first stream drawn from four sources, and every entry says which it is: A captured entry from this site carries a link to its record: Open submission lands on the Inbox with the…' },
    '#logging-an-activity': { title: 'Logging an activity', excerpt: 'Open the record — a contact\'s page under CRM › Contacts, a company\'s under Companies, a deal\'s under Deals, or a lead\'s under Leads — and choose Log activity in the header of the Timeline or Activity card.' },
    '#the-recent-activity-feed': { title: 'The recent activity feed', excerpt: 'The Contacts section shows the newest activity logged across the CRM in a Recent activity card of its own under the contacts list — the calls, emails, meetings and notes anyone on the team filed against any record —…' },
  },
  contactFields: {
    '#define-a-field': { title: 'Define a field', excerpt: 'Open CRM → Fields, pick the tab for the record the field describes — Contacts, Companies, Deals or Leads — and choose New field.' },
    '#save-a-form-field': { title: 'Save a form field into a custom field', excerpt: 'On a form\'s own page (Forms → the form), Saves to contact fields lists every field the published design declares, with a choice beside each.' },
  },
  contactRecord: {
    '#likely-duplicates': { title: 'Likely duplicates', excerpt: 'The Likely duplicates card on the record page looks for other records with the same name and the same phone number, or the same name and the same company, among the contacts your site may see.' },
    '#the-record-page': { title: 'The record page', excerpt: 'Clicking a row in the list opens the person\'s own page at …/crm/contacts/{id} — an address you can paste and that every other CRM record links to.' },
    '#what-each-site-keeps-to-itself': { title: 'What each site keeps to itself', excerpt: 'A contact document is shared by every site in your workspace — one human who touched two of your sites is one row.' },
  },
  contacts: {
    '#at-the-organization-level': { title: 'At the organization level', excerpt: 'The CRM tab under Organization opens the same hub over every site in the organization at once: the same eight sections, the same record pages, the same bulk actions, import, saved views, reports and settings, at…' },
    '#the-contacts-page': { title: 'The contacts page', excerpt: 'The Contacts section is the list the rest of the CRM is built on.' },
  },
  crmEmailTemplates: {
    '#managing-templates': { title: 'Managing templates', excerpt: 'CRM → Settings carries an Email templates card: every template and snippet you can use, with its kind and whether it is shared or personal.' },
  },
  crmLeads: {
    '#a-leads-page': { title: 'A lead\'s page', excerpt: 'Click a row to open the lead. Lead holds what the team decides: the status and the owner.' },
    '#filter-the-leads': { title: 'Filter and search the leads', excerpt: 'The table\'s own toolbar filters the list: Filters opens the filter panel, and Search finds a lead by a word of its name, its email address — and each part of the address, so the domain alone finds it — its company,…' },
    '#lead-source-filled-in': { title: 'Lead source, filled in for you', excerpt: 'Aglyn\'s own doors and outreach each have a built-in lead source, and fill it in on a person they meet first: The value lands on the lead, and on your site\'s own record of a contact, only when it has no lead source…' },
    '#what-a-lead-holds': { title: 'What a lead holds', excerpt: 'A lead is a record of its own — the way it is in Salesforce — and carries the person and their company as text until it converts.' },
    '#working-a-lead-from-the-row': { title: 'Working a lead from the row', excerpt: 'Status — click the status chip to change it to New, Nurturing or Working.' },
  },
  crmReports: {
    '#activity-by-teammate': { title: 'Activity by teammate', excerpt: 'Who did what in the period, busiest first. Activities logged — every call, email, meeting, note and other activity logged in the period, counted on the server, with the change against the previous period.' },
    '#contacts': { title: 'Contacts', excerpt: 'New contacts in the period, with the change against the previous period.' },
    '#conversion-by-source': { title: 'Conversion by source', excerpt: 'Of the people each capture surface brought in during the period, how many are customers now.' },
    '#crm-at-a-glance': { title: 'CRM at a glance', excerpt: 'The site dashboard carries a CRM at a glance card with five numbers: contacts, new contacts this week, the value of every open deal, tasks due today or overdue, and leads to work — the leads on this site that are…' },
    '#forecast-by-close-month': { title: 'Forecast by close month', excerpt: 'Every open deal, laid out by the month it is expected to close — one row per month for the next six, starting with the current month — and one column per pipeline, with a column for all of them together when there is…' },
    '#lead-funnel': { title: 'Lead funnel', excerpt: 'Of the leads this site captured in the period, where each one stands now, and why the ones closed without converting were closed.' },
    '#lead-sources': { title: 'Lead sources', excerpt: 'Of the leads first seen in the period, how many came from each lead source, and how many of each were qualified — converted to a contact.' },
    '#pipeline': { title: 'Pipeline', excerpt: 'Open deals and their pipeline value — the face value of every open deal, counted on the server.' },
    '#sources-and-lifecycle': { title: 'Sources and lifecycle', excerpt: 'By source — how many contacts came through each capture surface (forms, orders, bookings, members, and so on).' },
    '#tasks': { title: 'Tasks', excerpt: 'Open tasks, Overdue (due before today) and Due today. Today and overdue are decided on your calendar day, the same way the Tasks list decides them, so the two never disagree about the same task.' },
    '#won-and-lost': { title: 'Won and lost', excerpt: 'Won in the period, with the value of what was won.' },
    '#won-and-lost-by-owner': { title: 'Won and lost by owner', excerpt: 'The same closed deals, grouped by the person who owned each one at the close — not by whoever created it, so a deal reassigned mid-cycle counts for whoever carried it over the line.' },
  },
  crmSettings: {
    '#assignment-rules': { title: 'Assignment rules', excerpt: 'An ordered list of rules tried, top to bottom, for every new contact captured on any site in the workspace.' },
    '#default-owner': { title: 'Default owner', excerpt: 'Who gets the contacts captured on this site when no assignment rule claims them.' },
    '#email-capture': { title: 'Email capture', excerpt: 'The Email capture card holds the workspace\'s one capture address — crm+…@in.aglyn.com — with Copy and Rotate address.' },
    '#recipes': { title: 'Recipes', excerpt: 'At the organization level only — …/{organization}/crm/settings — the Settings section ends with a Recipes card: the four automation recipes, each with the sites that already carry it and an Install button.' },
    '#round-robin': { title: 'Round robin', excerpt: 'The members handed contacts in turn by a round-robin rule, or by an automation set to round robin.' },
    '#your-sending-addresses': { title: 'Your sending addresses', excerpt: 'Directly under Email capture, Your sending addresses lists the addresses you send from besides the one you sign in with, such as a Gmail Send mail as alias on an outbound domain.' },
  },
  crmSharing: {
    '#access-read-only-or-read-and-edit': { title: 'Access: read-only or read and edit', excerpt: 'Read-only is the default. A site with read-only access can see the record, open its page, and add its own tasks, notes and activity to it.' },
    '#sharing-rules': { title: 'Sharing rules', excerpt: 'CRM → Settings → Sharing rules, at the organization level, lists your rules.' },
  },
  crmTasks: {
    '#tasks-on-a-contact-company-or-deal': { title: 'Tasks on a contact, company or deal', excerpt: 'Each record\'s page has a Tasks card listing that record\'s open tasks, soonest due first, with the same checkbox to complete one inline; the card\'s heading counts how many are open and how many are done.' },
    '#the-dashboard-card': { title: 'The dashboard card', excerpt: 'The site dashboard shows a Tasks due card: how many of your tasks are overdue, how many are due today, and the next five assigned to you, each with its due date.' },
    '#the-tasks-page': { title: 'The tasks page', excerpt: 'The Tasks section is one list with six views, chosen under Show in the table\'s Filters panel — My tasks unless you choose another.' },
  },
  crmViews: {
    '#the-views-control': { title: 'The views control', excerpt: 'Above each list, a button names the view the list is showing — All contacts when none is — and opens the views menu: My views are the ones you saved for yourself.' },
  },
  datasets: {
    '#filter-records': { title: 'Filter and search the records', excerpt: 'The records table filters through its own toolbar: Filters opens the filter panel, where each filterable field of the dataset\'s model is a column, and Search finds records by the words in their text.' },
    '#who-a-dataset-is-shared-with': { title: 'Who a dataset is shared with', excerpt: 'Datasets belong to the workspace, not to a single site, so one dataset can drive pages on every site you run.' },
  },
  deals: {
    '#a-deals-page': { title: 'A deal\'s page', excerpt: 'Opening a deal shows: The header — the deal\'s title in the page heading and the trail, the pipeline and stage under its kind, its status, amount and owner as chips, Back to deals, Edit, and a menu (⋮) carrying Delete…' },
    '#contact-roles': { title: 'Contact roles', excerpt: 'A deal can name more than one person: Salesforce\'s Opportunity Contact Roles.' },
    '#line-items': { title: 'Line items', excerpt: 'A deal\'s amount can be a number you type, or the sum of the products behind it.' },
    '#moving-winning-and-losing': { title: 'Moving, winning and losing', excerpt: 'Stage changes go through the server rather than being written directly, so that automations can hear them.' },
    '#the-board-and-the-table': { title: 'The board and the table', excerpt: 'The section opens as a board of the chosen pipeline: one column per open stage, with Won and Lost folded away at the end until you expand them; a board wider than the window scrolls sideways.' },
  },
  deliveryApps: {
    '#taking-orders': { title: 'Taking orders', excerpt: 'Delivery orders appear on the register, oldest first, and a short message announces each new one.' },
  },
  designedEmails: {
    '#find-a-template': { title: 'Find a template', excerpt: 'The templates table filters through its toolbar by Template, the name (it contains a word, it is, or it starts with), and Search matches the start of any word of a template\'s name, up to its first twelve characters.' },
    '#send-it': { title: 'Send it', excerpt: 'Open the email you want to send and choose Write this email.' },
  },
  emailCampaigns: {
    '#a-domain-we-set-up-is-a-request': { title: 'A domain we set up is asked for, not included', excerpt: 'This is the part worth reading before you plan around it. Nothing is provisioned automatically.' },
    '#add-to-a-list': { title: 'Add someone by hand', excerpt: 'Type an address (or paste a whole column of them) and press Check.' },
    '#campaigns-group-emails': { title: 'A campaign holds many emails', excerpt: 'A campaign is a container, not a single message. It carries a name, a start and end date, and the lists it is aimed at; the emails you send inside it are its contents, and the campaign\'s page adds their figures up.' },
    '#compliance': { title: 'Compliance', excerpt: 'Every send includes an unsubscribe link in its footer, and by default the header mailbox providers look for — Gmail and Yahoo\'s one-click List-Unsubscribe — which is what makes a mail app show its own Unsubscribe button.' },
    '#consent-group-confirmation': { title: 'When the site asking is part of a consent group', excerpt: 'Where your organization has declared several sites one sender — a consent group, named on every signup form — a confirmation belongs to the site whose form asked for it.' },
    '#consent-group-join': { title: 'Add or move a site', excerpt: 'Edit group, in a group\'s menu, opens the same dialog with its sites ticked.' },
    '#consent-groups': { title: 'Sites that send as one', excerpt: 'Every site is its own sender until you say otherwise: someone who signs up on one site hears only from that site, and an unsubscribe applies to that site alone.' },
    '#domain-states': { title: 'The states a domain can be in', excerpt: 'Add a domain and you are given the exact DNS records to publish — an authorization record, a signing key and a bounce-routing record.' },
    '#email-lists': { title: 'Email lists', excerpt: 'Lists are audiences shared across your organization\'s sites.' },
    '#experiments': { title: 'Experiments', excerpt: 'Business plans can A/B test pages, sections, and emails from the Experiments card on the Marketing page: weighted variants, deterministic visitor assignment, a conversion goal, and per-variant exposure/conversion…' },
    '#experiments-across-sites': { title: 'Across your organization\'s sites', excerpt: 'Your organization\'s own Marketing → A/B testing lists every site\'s tests, grouped by site, with what each one tests, how many variants it has and its status.' },
    '#list-members': { title: 'See and manage who is on a list', excerpt: 'Press Members on any list row to open it. You get the membership a page at a time — address, name, when they joined, how they got there, and what their consent record says — plus the controls to change it.' },
    '#lists-built-from-a-rule': { title: 'Lists built from a rule', excerpt: 'A dynamic list holds everyone matching a rule, re-checked about every fifteen minutes.' },
    '#manual-lists': { title: 'Manual lists', excerpt: 'A manual list holds the people you put in it. Grow it with the "Enroll in a list" automation step (e.g.' },
    '#monthly-send-cap': { title: 'Your monthly send cap', excerpt: 'From Pro up, a plan includes a number of campaign emails per calendar month.' },
    '#opens--clicks': { title: 'Opens & clicks', excerpt: 'With the Resend webhook configured, campaign history shows opens and clicks per campaign, and clicks on A/B sends count as that variant\'s conversions — so the experiment results table fills in by itself.' },
    '#organization-emails-page': { title: 'Your organization\'s Emails page', excerpt: 'Your organization has its own Emails page beside CRM and Marketing, with the same seven sections a site\'s has, each answering for every site at once.' },
    '#preference-page': { title: 'The preference page', excerpt: 'The link at the bottom of every campaign opens a page where the recipient sees your topics, ticks the ones they want to keep, and saves.' },
    '#send-a-campaign': { title: 'Send a campaign', excerpt: 'Create a campaign on Marketing → Campaigns — a name, the dates it runs between, the lists it is aimed at, and the sites it runs on.' },
    '#senders': { title: 'The addresses this site may send as', excerpt: 'Under the domain, the same page lists this site\'s senders. Each one is a mailbox on the site\'s sending domain with a display name and a reply address stored beside it, and every email you compose goes out as one of them.' },
    '#sending-domains': { title: 'Which domain your mail leaves on', excerpt: 'Emails → Sending is where you see what this site sends as, and where a workspace proves it owns a domain of its own.' },
    '#suppressions': { title: 'Suppressions', excerpt: 'Emails ▸ Suppressions lists every address your campaigns skip, with the reason and the date: This is where the gap between a campaign\'s recipient count and what it actually sent comes from, and a rising Bounced count…' },
    '#the-campaign-report': { title: 'The campaign report', excerpt: 'Report, beside any campaign that has been sent, opens the full picture for that one send.' },
    '#topics': { title: 'Topics', excerpt: 'A topic is a stream of email somebody can leave on its own. Every campaign belongs to one, picked in the composer, and the link in that email offers to stop that stream rather than all of them.' },
    '#two-ways-to-get-a-domain': { title: 'The two ways to get a domain of this site\'s own', excerpt: 'A site\'s mail can leave from three places, and only the first is guaranteed.' },
    '#what-belongs-to-a-campaign': { title: 'What belongs to a campaign', excerpt: 'A push is rarely only its mail. A campaign can also hold the landing pages, the forms those pages place, the contacts and leads you have filed under it, and the sequences a rep sends as part of it — so the campaign\'s…' },
  },
  events: {
    '#manage-events': { title: 'Manage events', excerpt: 'The console Events page lists your site\'s events, newest start first.' },
  },
  forms: {
    '#build-a-form': { title: 'Build a form', excerpt: 'Drop form components onto a page in the Besigner (fields, submit button).' },
    '#every-sites-inbox-at-once': { title: 'Every site\'s Inbox at once', excerpt: 'Your organization has an Inbox of its own, beside CRM and Marketing, for the people who span the whole organization — owners, admins, and members with access to every site.' },
    '#field-types': { title: 'Field types', excerpt: 'Each Form Field has a type that controls what visitors see and what is submitted: Dropdown, radio, and checkbox fields take their choices from the field\'s Options setting — enter one choice per line (or separate them…' },
    '#filter-the-inbox': { title: 'Filter the Inbox tables', excerpt: 'Every Inbox table filters and searches through its toolbar, and every filter and the search reach everything the site holds, not only the page on screen: the table asks for the matches, newest first, and paging…' },
    '#find-a-form': { title: 'Find a form in the list', excerpt: 'The Forms table filters through its toolbar by every column it shows: Display name, by the start of a word in it: contains "audit" finds "Multi-brand site audit".' },
    '#one-forms-own-page': { title: 'One form\'s own page', excerpt: 'The Inbox answers "who is waiting for a reply" for the whole site.' },
    '#replying-to-a-submission': { title: 'Replying to a submission', excerpt: 'Open a submission and, under the fields, there is a Reply composer.' },
    '#the-inbox': { title: 'The inbox', excerpt: 'The site\'s Inbox page collects everything visitors send, in three tabs — Submissions, Members & leads, and Campaigns.' },
    '#where-submissions-go': { title: 'Where submissions go', excerpt: 'Inbox — every submission is captured; open it in the console\'s mail reader dialog.' },
  },
  installYourFirstPlugin: {
    '#step-3-reviews': { title: 'Step 3 — Read the reviews, and know who can leave one', excerpt: 'Ratings on a listing come only from people with a verified email whose organization actually installed it.' },
    '#step-4-targeting': { title: 'Step 4 — Choose which sites get it', excerpt: 'This is the step to read. On the detail page you\'ll find an Install to dropdown with two options.' },
    '#step-7-off': { title: 'Step 7 — Turn it off, or take it back off', excerpt: 'Three different actions, often confused: Uninstalling never deletes the data a plugin created.' },
  },
  inviteTeammates: {
    '#activity-log': { title: 'Activity log', excerpt: 'The organization\'s Team page shows a Recent Activity log: what happened at organization level — renames, workspace URL changes, ownership transfers, members added/removed or re-roled, and invites sent, revoked, or…' },
    '#ai-usage': { title: 'AI usage per member', excerpt: 'Each member\'s page carries an AI usage card: their AI credits this month and last, their share of the workspace\'s pool, their requests, the kinds of request they mostly made, and the split by site.' },
    '#how-team-members-act': { title: 'How team members act', excerpt: 'Team members act in the owner\'s organization, not their own — so their changes apply to your site, and permissions are enforced across the console\'s APIs and surfaces.' },
    '#invite-someone': { title: 'Invite someone', excerpt: 'Open the organization\'s Team page and choose Add or invite.' },
  },
  loyalty: {
    '#members-and-store-credit': { title: 'Members and store credit', excerpt: 'The Rewards members card under Products → Promotions lists every member, newest first.' },
    '#on-an-order': { title: 'On an order', excerpt: 'An order\'s dialog shows a Rewards section when rewards touched it: the points it earned and for whom, the rewards it spent, and anything a refund changed.' },
    '#set-up-your-program': { title: 'Set up your program', excerpt: 'Go to Products → Promotions and find the Rewards card. The card also shows how many members you have, the points they hold and what those points are worth, and the store credit they hold.' },
  },
  manifestAndEnvs: {
    '#review--trust-lifecycle': { title: 'Review & trust lifecycle', excerpt: 'Listed/verified (or legacy/absent) plugin listings appear in browse; everything else is owner-and-staff-only.' },
  },
  marketingOverlays: {
    '#across-your-sites': { title: 'Across your organization\'s sites', excerpt: 'Your organization has its own Marketing page beside CRM, with the same sections as a site\'s — Overview, Campaigns, Conversions, Overlays and A/B testing — each answering for every site at once.' },
    '#announcement-bar': { title: 'Announcement bar', excerpt: 'A site-wide announcement bar shows a message across every page — ideal for sales, notices, or launches.' },
    '#engagement-stats': { title: 'Engagement stats', excerpt: 'Each overlay tracks its own lifetime views, clicks, and dismissals, shown in the Engagement column of the overlays table — so you can tell whether a bar earns its screen space.' },
    '#frequency': { title: 'Frequency: how often a popup comes back', excerpt: 'In the popup editor, Frequency offers two mutually exclusive choices.' },
    '#promotional-popups': { title: 'Promotional popups', excerpt: 'Popups give you more control: Triggers — After a delay (a number of seconds), On scroll (a percentage of the page), or On exit intent.' },
  },
  membersOnly: {
    '#manage-your-members': { title: 'Manage your members', excerpt: 'The site\'s Users page lists everyone who signed up on your published site — paged, newest first.' },
  },
  orderNotifications: {
    '#customer-emails': { title: 'What your customers get', excerpt: 'A dropship supplier who posts tracking for their part of an order sends the customer the same Order shipped email.' },
  },
  ordersAndReturns: {
    '#buyer-requests': { title: 'How a buyer asks', excerpt: 'A buyer asks for a return themselves, from either of two places: the Request a return link beside an order in their account on your store, when they are signed in;' },
    '#order-webhooks': { title: 'Order webhooks', excerpt: 'An order webhook posts each order event to an address you choose, as it happens: a warehouse system, an ERP, a spreadsheet script.' },
    '#run-a-return': { title: 'Run a return', excerpt: 'Open a return from the list, or from the Returns section of its order\'s dialog, where Start return opens one for the buyer.' },
  },
  orgAutomations: {
    '#every-sites-own-automations': { title: 'Every site\'s own automations', excerpt: 'The organization hub\'s Workflows, Actions and Webhooks sections list every site\'s own workflows, actions and webhooks side by side, with the site each belongs to.' },
    '#pause-it-on-one-site': { title: 'Pause it on one site', excerpt: 'Each site\'s Automation → Actions section shows Org automations on this site: the ones placed on it, whether each runs here, and Pause here / Resume here.' },
    '#what-an-org-automation-is': { title: 'What an org automation is', excerpt: 'An org automation has a trigger, optional conditions and an ordered list of steps, exactly like an action — and a placement: the sites it runs on.' },
  },
  plugins: {
    '#a-dependency-that-is-off-for-one-site': { title: 'A dependency that is off for one site', excerpt: 'A site can switch off a plugin that another plugin on that same site depends on — by disabling it directly, or simply by never opting in.' },
    '#browse-card': { title: 'What a browse card shows', excerpt: 'Every card in Browse All carries the same four claims, so two listings side by side are comparable: A price chip, always.' },
    '#configure': { title: 'Configure', excerpt: 'A plugin declares the settings it takes, and the console renders the form.' },
    '#configure-site': { title: 'Settings for one site', excerpt: 'A site that needs a different answer overrides that one field and keeps inheriting the rest — including later changes the workspace makes to the fields it did not override.' },
    '#how-plugins-run': { title: 'How plugins run', excerpt: 'Each plugin loads into a sandboxed PluginFrame host runtime, isolated by origin.' },
    '#install--upgrade': { title: 'Install & upgrade', excerpt: 'Open Marketplace in the organization navigation and Browse the listings.' },
    '#what-the-badges-on-a-listing-mean': { title: 'What the badges on a listing mean', excerpt: 'Two badges can appear on a listing, and they say different things.' },
    '#when-one-plugin-depends-on-another': { title: 'When one plugin depends on another', excerpt: 'Some plugins cannot run without another one. User Accounts is the case that exists today: its Members blocks and its membership/* API handlers ship inside the Commerce bundle, so User Accounts with Commerce switched…' },
  },
  pos: {
    '#card-readers': { title: 'Card readers', excerpt: 'A card reader takes card payments at the counter: the customer taps, inserts or swipes, and the reader can ask for a tip.' },
    '#registers': { title: 'Registers', excerpt: 'Create your registers under Commerce → Settings → POS registers — one per till or device that takes in-person payments.' },
    '#reservations': { title: 'Reservations', excerpt: 'For stays (cabins, rooms, rentals): Add resources on the Products page — nightly rate, weekend multiplier, minimum nights, deposit percent, and free-cancellation window.' },
  },
  posHardware: {
    '#receipt-printers': { title: 'Receipt printers', excerpt: 'A cloud receipt printer collects its work from Aglyn over the internet, so a receipt prints from the register on any device, even one with no printer driver, and even when the printer is on a different network.' },
  },
  posOperations: {
    '#shifts-and-the-cash-drawer': { title: 'Shifts and the cash drawer', excerpt: 'A shift is one stretch of trading on one register, counted against one cash drawer.' },
    '#staff-pins': { title: 'Staff PINs', excerpt: 'A shared tablet stays signed in; each person switches in with their own PIN instead of signing out.' },
  },
  postPurchase: {
    '#connect-a-service': { title: 'Connect a service', excerpt: 'Go to Commerce → Settings and find the card for the service: AfterShip, Route or Narvar.' },
    '#on-the-order': { title: 'On the order', excerpt: 'Open an order to see its Tracking and protection section: the protection status and what the buyer paid for it, each parcel a service is following, and when the order was last sent to Narvar.' },
  },
  publishAPlugin: {
    '#paid-listings': { title: 'Paid listings', excerpt: 'You can list a plugin as paid: Payments run through Stripe Connect.' },
    '#your-publisher-profile': { title: 'Your publisher profile', excerpt: 'Your publisher profile is a storefront: its own page in the marketplace listing everything you\'ve published, reachable from the Publisher card on any of your listings and from the by @handle link on every browse card.' },
  },
  publisherHandbook: {
    '#asking-to-be-verified': { title: 'Asking to be verified', excerpt: 'Verification used to be something only a reviewer could start, which meant there was no way to ask and no sign that asking was allowed.' },
    '#authoring-your-listing': { title: 'Authoring your listing', excerpt: 'Your listing IS your storefront — it renders on the detail page every buyer sees.' },
    '#before-you-publish': { title: 'Before you publish', excerpt: 'The last section of the page asks you to confirm a short checklist, in full view of the publish button, and publishing is blocked until you do.' },
    '#before-your-first-publish': { title: 'Before your first publish', excerpt: 'Publisher profile (Marketplace → Profile) — your handle and display name appear on every listing.' },
    '#getting-paid': { title: 'Getting paid', excerpt: 'One-time prices in whole USD: $0 (free), or $3 to $1000. Purchases flow through the platform\'s Stripe; your share (80%, or 70% on free plans) pays out via your Connect account.' },
    '#how-installs-work-the-buyer-side': { title: 'How installs work (the buyer side)', excerpt: 'Browse is a catalog — cards link to the detail page, which is the only place an install happens.' },
    '#private-plugins': { title: 'Private plugins', excerpt: 'Choose Only this organization under Who can install this when you upload, and the listing becomes private: never browsable in the marketplace by anyone, and installable only by your own organization\'s sites.' },
    '#publishing-a-version': { title: 'Publishing a version', excerpt: 'Run the local verifier first — the publish API enforces the same checks and rejects with the exact problem list: The verifier parses your bundle rather than reading it as text, so it sees what a source scan could…' },
    '#review-what-happens-after-you-publish': { title: 'Review: what happens after you publish', excerpt: 'New plugin listings enter the queue as submitted and don\'t appear in public browse until staff list them.' },
    '#shipping-a-new-version': { title: 'Shipping a new version', excerpt: 'Publish new version on your listing — the button on the listing\'s own detail page, or the action in the row menu on Marketplace → Listings.' },
    '#the-publisher-agreement': { title: 'The publisher agreement', excerpt: 'Your organization — not you personally — is the publishing party, so the organization accepts the Marketplace Publisher Agreement once.' },
    '#the-two-badges-and-what-each-one-promises': { title: 'The two badges, and what each one promises', excerpt: 'The marketplace shows two separate claims, because they answer different questions and conflating them would let one vouch for the other.' },
    '#where-to-publish-from': { title: 'Where to publish from', excerpt: 'Publishing lives at the organization level — Marketplace → Publish.' },
  },
  redirects: {
    '#manage-redirects': { title: 'Manage redirects', excerpt: 'Create, edit, and delete redirect rules from the redirect manager page.' },
  },
  salesChannels: {
    '#brand-barcode-and-category': { title: 'Brand, barcode and category', excerpt: 'Channels match listings to products they know by their identifiers.' },
    '#how-fresh-the-feed-is': { title: 'How fresh the feed is', excerpt: 'A product you edit and save reaches the next fetch at once. Stock that a sale takes reaches it within 30 minutes.' },
    '#turn-on-a-channel': { title: 'Turn on a channel', excerpt: 'On the channel\'s card, switch the feed On. The card shows the feed\'s address.' },
  },
  sequences: {
    '#allowed-countries': { title: 'Allowed countries', excerpt: 'The countries a sequence may send to at all, United States by default.' },
    '#build-a-sequence': { title: 'Build a sequence', excerpt: 'Select New sequence, name it, and choose the site whose CRM the people you enroll are contacts of and the mailbox it sends from.' },
    '#compliance-settings': { title: 'Compliance settings', excerpt: 'Every email a sequence sends ends with a footer saying who sent it, where they can be reached by post, that the email is a sales email, and how to stop more of them.' },
    '#connect-a-mailbox': { title: 'Connect a mailbox', excerpt: 'Each rep connects their own Google or Microsoft 365 mailbox in Sequences → Mailboxes: Select Connect with Google or Connect with Microsoft and choose your account.' },
    '#do-not-contact-domains': { title: 'Do not contact domains', excerpt: 'The domains no sequence emails anyone at, whoever enrolls them.' },
    '#enroll': { title: 'Enroll people', excerpt: 'Select Enroll people on an active sequence, and choose them from a saved Contacts or Leads view, by searching your contacts at the sequence\'s site, or from the Leads tab — the site\'s open leads — up to 50 at a time.' },
    '#link-domains': { title: 'Link domains', excerpt: 'With Count link clicks on, every link in a sequence email is a short link that counts the click and then takes the reader where you meant.' },
    '#mailbox-actions': { title: 'Test, pause and disconnect', excerpt: 'Send a test to myself sends a short plain-text message from the mailbox to its own address, so you can check it arrives.' },
    '#person-history': { title: 'See one person\'s history', excerpt: 'Select a person\'s row — or focus it and press Enter — to open their page.' },
    '#send-a-test': { title: 'Send yourself a test of a step', excerpt: 'Send a test on any email step of a saved sequence sends that step to your own inbox through the sequence\'s mailbox, so you read it as a recipient would — the merge fields filled, the footer on, the links as they will…' },
    '#sequences': { title: 'Sequences', excerpt: 'A sequence is the emails, and the tasks between them, one person gets from one rep.' },
  },
  shipping: {
    '#carrier-accounts': { title: 'Carrier accounts', excerpt: 'The Carrier accounts card lists the carriers your labels and checkout rates come from, for every site in the workspace.' },
    '#shipping-labels': { title: 'Shipping labels', excerpt: 'A label bought on Aglyn\'s carrier accounts is charged to the workspace at the carrier\'s price, with nothing added.' },
    '#where-parcels-ship-from': { title: 'Where parcels ship from', excerpt: 'Each inventory location (Products → Settings → Inventory locations) can carry a postal address: choose Add address on its row, or Edit address once it has one.' },
  },
  staffConsole: {
    '#acquisition': { title: 'Acquisition', excerpt: 'An Acquisition card on the detail page — and on each organization\'s page, for the account that created it — says where the account came from in one line ("Referral from g2.com → /pricing → signed up with password"):…' },
    '#audit-archival': { title: 'Audit archival', excerpt: 'A nightly cron moves audit entries past the 90-day retention window into a Storage compliance trail (JSON lines, month-partitioned) and reminds staff of GDPR erasure requests past their 7-day hold.' },
    '#audit-log': { title: 'Audit log viewer', excerpt: 'A record of staff actions, newest first. Click an entry to read its reason, note and before/after below the list.' },
    '#billing-insight': { title: 'Billing insight', excerpt: 'Every organization\'s Stripe invoice history and default payment method (with delinquency state) render on its detail page.' },
    '#contact-suppressions': { title: 'Do not contact', excerpt: 'The platform do-not-contact list for phone numbers — calls and texts.' },
    '#coupons': { title: 'Coupons', excerpt: 'Discount codes for Aglyn\'s own subscriptions. They live in Stripe — the console creates them there and reads them back, so a coupon made in the Stripe Dashboard shows up here and vice versa.' },
    '#email-delivery': { title: 'Email delivery', excerpt: 'An Email delivery card on the same detail page answers "they say they never got it." It lists every message we sent the account\'s addresses, newest first, a page at a time: the subject, which of our senders produced…' },
    '#emails-sent': { title: 'Emails sent', excerpt: 'Emails sent — on a site\'s staff page, and on an organization\'s for all of its sites — lists every email the site sent, newest first: the recipient, the subject and the sender tag (a campaign, a form notification,…' },
    '#entitlement-editor': { title: 'Entitlement editor', excerpt: 'Full override editor for an organization\'s entitlements, its plan, and per-organization release flags.' },
    '#existing-coupons': { title: 'Existing coupons', excerpt: 'Existing coupons lists Stripe coupons with their promotion codes, redemption count, and a valid or expired state, a page at a time.' },
    '#filter-the-directory': { title: 'Filter the directory', excerpt: 'The grid\'s toolbar filters and searches the whole directory, not the page on screen.' },
    '#filter-the-site-list': { title: 'Filter the site list', excerpt: 'The grid\'s toolbar filters and searches every site, not the page on screen.' },
    '#first-party-hosts': { title: 'First-party hosts', excerpt: 'The hosts the platform serves itself, on Staff → Platform settings.' },
    '#free-workspace-limit': { title: 'Free workspace limit', excerpt: 'How many free workspaces one account may hold, on a card at the top of the organizations page.' },
    '#organizations-admin': { title: 'Organization management', excerpt: 'Audited plan and entitlement overrides, suspension, and GDPR-erasure flags, per organization.' },
    '#password-help': { title: 'Password help', excerpt: 'On that detail page, a Password card can email the account a reset link, or set its password directly for an account that cannot receive mail.' },
    '#platform-suppressions': { title: 'Platform suppressions', excerpt: 'Also on the System emails page: every address that bounced permanently or reported spam on any send from any site.' },
    '#plugin-reviews': { title: 'Plugin reviews & realm trust', excerpt: 'The marketplace review queue, plus a Listed plugins — realm trust table for granting or revoking realm trust per version.' },
    '#sign-one-device-out': { title: 'Sign one device out', excerpt: 'A Sign-in history card on the same detail page lists every device that has signed in to the account — browser and system, location, IP, first and last seen — and can end the sessions on one of them.' },
    '#site-content': { title: 'Site content', excerpt: 'The Content card lists what the site is built from, one tab per kind: Pages, Email designs, Layouts, Components, Templates and Forms.' },
    '#site-detail': { title: 'Site detail', excerpt: 'A site\'s staff page opens from its row in Sites, or from the Sites card on its organization\'s page.' },
    '#site-ownership': { title: 'Site ownership', excerpt: 'A site belongs to an organization, and the organization has one owner.' },
    '#sites-admin': { title: 'Site management', excerpt: 'Sites lists every site on the platform, across every organization, read server-side with the Admin SDK so it shows sites you are not a member of.' },
    '#staff-automations': { title: 'Automations', excerpt: 'The Automations card — on a site\'s page, and Organization automations on an organization\'s — comes from the Automation plugin.' },
    '#staff-org-email': { title: 'Organization email campaigns', excerpt: 'The Email campaigns card, from the Marketing plugin, has two tabs, each paged in id order: Sends — every campaign send: its subject and site, status (and held for review when the outbound screen stopped it), how many…' },
    '#system-emails': { title: 'System emails', excerpt: 'The mail Aglyn itself sends: organization invites, the monthly usage summary, the email copy of console notifications, staff alerts, workspace notices, the CRM digest and task reminders, the weekly insights digest,…' },
    '#users-admin': { title: 'Users admin', excerpt: 'Staff-claim management and disabling users, with gated listing; a whole email address typed in the search box looks the account up directly.' },
  },
  taxServices: {
    '#connect': { title: 'Connect', excerpt: 'Go to Commerce → Settings and find the Tax service card. Only an admin of the site can connect, test or disconnect a service and change its address.' },
    '#how-sales-are-taxed': { title: 'How sales are taxed', excerpt: 'A product you marked tax-exempt is sent as non-taxable and charged no tax.' },
  },
  webhooks: {
    '#outbound-webhooks': { title: 'Outbound webhooks', excerpt: 'Send an HTTP request to a URL you control when a site event fires — for example, post to a Slack endpoint or your own API when a form is submitted or a new booking comes in.' },
  },
  zapier: {
    '#see-and-disconnect-your-zaps': { title: 'See and disconnect your Zaps', excerpt: 'The Zapier card on a site\'s setup page lists every Zap that takes the site\'s records: what it takes, the API key it connected with, and when it was last sent something.' },
  },
}

type PluginAnchorMap = typeof PLUGIN_DOCS_ANCHORS

/** Valid heading anchors for a plugin docs page (`never` when none). */
export type PluginDocsAnchor<K extends PluginDocsKey> =
  K extends keyof PluginAnchorMap ? PluginAnchorMap[K][number] : never
