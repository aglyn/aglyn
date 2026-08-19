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
  actionsBuilder: {
    path: '/marketing-and-automation/workflows-and-actions/actions-builder',
    title: 'Actions builder',
    excerpt: 'Map a single event to a single action without building a full workflow.',
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
  datasets: {
    path: '/content-and-data/datasets/overview',
    title: 'Datasets & Dynamic Content',
    excerpt: 'Model structured content with typed fields and relations, then bind it into repeatable components.',
  },
  designedEmails: {
    path: '/marketing-and-automation/email-campaigns/designed-emails',
    title: 'Designed emails',
    excerpt: 'Build campaign emails in the besigner with email-safe blocks and merge tokens — no separate editor.',
  },
  emailCampaigns: {
    path: '/marketing-and-automation/email-campaigns/overview',
    title: 'Email Campaigns',
    excerpt: 'Send email to audiences built from your contacts, with tiered send caps and unsubscribe handling.',
  },
  events: {
    path: '/content-and-data/events/overview',
    title: 'Events Calendar',
    excerpt: 'Keep a schedule of events in the console and publish the ones you choose to any screen, with search-engine event markup.',
  },
  forms: {
    path: '/content-and-data/forms/overview',
    title: 'Forms & Lead Capture',
    excerpt: 'Add forms to your site, collect submissions in an inbox, and write them into datasets.',
  },
  installYourFirstPlugin: {
    path: '/guides/install-your-first-plugin',
    title: 'Install your first marketplace item',
    excerpt: 'A click-by-click walkthrough of the Marketplace — find something, choose which sites get it, install it, and turn it off again.',
  },
  marketingOverlays: {
    path: '/marketing-and-automation/marketing-overlays/overview',
    title: 'Marketing Overlays',
    excerpt: 'Site-wide announcement bars and promotional popups with triggers, scheduling, and email capture.',
  },
  membersOnly: {
    path: '/workspace-and-billing/teams-and-roles/members-only',
    title: 'Members-only areas',
    excerpt: 'Let visitors sign up as members and gate screens so only members can view them.',
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
  webhooks: {
    path: '/marketing-and-automation/workflows-and-actions/webhooks',
    title: 'Webhooks',
    excerpt: 'Connect Aglyn to other systems with outbound and inbound webhooks.',
  },
} as const satisfies Record<string, PluginDocsTopic>

export type PluginDocsKey = keyof typeof PLUGIN_DOCS

export const PLUGIN_DOCS_ANCHORS = {
  actionsBuilder: ['#create-an-action', '#triggers', '#only-run-when-a-field-matches', '#chain-multiple-conditions-andor', '#steps', '#run-history', '#what-is-and-isnt-recorded', '#interactions-from-the-besigner', '#when-to-use-which', '#related'],
  bindings: ['#binding-tokens', '#rename-safe-id-tokens', '#insert-a-variable', '#token-pills', '#in-the-canvas-text-editor', '#typed-variables', '#no-code-functions', '#where-used--safety', '#workflows', '#related'],
  bookings: ['#set-up-bookings', '#taking-bookings', '#payments-and-fees', '#manage', '#cancelling-and-refunding', '#related'],
  buildAWorkflow: ['#1-open-the-workflows-page', '#2-choose-a-trigger', '#3-add-steps', '#4-save-and-test', '#tips', '#related'],
  catalog: ['#products-options-and-variants', '#billing-modes-and-subscriptions', '#categories-and-tags', '#collections', '#slugs', '#merchant-center-feed', '#related'],
  commerce: ['#products-hub', '#inventory', '#stock-movements', '#gift-cards', '#recovery-and-alerts', '#orders', '#orders-screen', '#order-statuses', '#order-money-tiles', '#a-lost-dispute', '#shipping--taxes', '#destination-coverage', '#dropshipping', '#related'],
  commerceEndToEnd: ['#1-connect-payments', '#2-create-products', '#3-design-the-storefront', '#catalog-search-filters-and-sort', '#category-pages', '#the-product-page-template', '#4-what-checkout-does', '#paying-without-leaving-your-site', '#5-run-orders-from-the-console', '#6-subscriptions--the-stripe-portal', '#related'],
  consoleTour: ['#the-app-bar', '#in-context-help', '#primary-navigation', '#editing-vs-managing', '#the-sites-list', '#the-status-pill', '#how-the-pill-is-decided', '#your-site-allowance', '#a-sites-dashboard', '#next', '#workspace-settings--notifications', '#alerts-on-this-device'],
  contacts: ['#unified-ingestion', '#the-contacts-page', '#segments', '#related'],
  datasets: ['#model-builder', '#typed-documents', '#relations', '#query-layer', '#repeatable-components', '#who-a-dataset-is-shared-with', '#import--export', '#related'],
  designedEmails: ['#create-a-template', '#styling-email-blocks', '#merge-tokens', '#send-it'],
  emailCampaigns: ['#send-a-campaign', '#monthly-send-cap', '#personalize-with-merge-tags', '#recipient-count', '#schedule-a-send', '#email-lists', '#experiments', '#opens--clicks', '#compliance', '#related'],
  events: ['#manage-events', '#show-events-on-a-screen', '#search-engines', '#related'],
  forms: ['#reading-submissions-from-code', '#build-a-form', '#monthly-allowance-per-plan', '#spam-and-abuse-protection', '#the-per-site-monthly-ceiling', '#field-types', '#labels-and-placeholders', '#example-a-quick-survey', '#after-submit', '#example-grow-an-email-list-from-a-signup-form', '#where-submissions-go', '#the-inbox', '#who-a-submission-is-from', '#where-this-one-went', '#related'],
  installYourFirstPlugin: ['#before-you-start', '#step-1-open', '#step-2-browse', '#step-3-reviews', '#step-4-targeting', '#step-5-install', '#step-6-use', '#step-7-off', '#what-to-do-next', '#related'],
  marketingOverlays: ['#announcement-bar', '#promotional-popups', '#frequency', '#popup-v2', '#multiple-overlays-scheduling--page-targeting', '#engagement-stats', '#related'],
  membersOnly: ['#let-visitors-sign-up', '#sign-in-sign-up-and-recovery-pages', '#forgotten-passwords', '#gate-a-screen', '#manage-your-members', '#suspend-or-reactivate-a-member', '#tips', '#related'],
  plugins: ['#install--upgrade', '#browse-card', '#whats-included', '#what-the-badges-on-a-listing-mean', '#how-plugins-run', '#configure', '#publish-your-own', '#related'],
  pos: ['#registers', '#the-register', '#selling-past-the-count', '#when-something-disconnects', '#reservations', '#related'],
  publisherHandbook: ['#before-your-first-publish', '#the-publisher-agreement', '#where-to-publish-from', '#what-installing-each-type-does', '#publishing-a-version', '#before-you-publish', '#review-what-happens-after-you-publish', '#the-two-badges-and-what-each-one-promises', '#asking-to-be-verified', '#testing-a-version-before-it-is-approved', '#watching-your-own-submission', '#disabled-versions', '#private-plugins', '#authoring-your-listing', '#versioning--updates', '#shipping-a-new-version', '#how-installs-work-the-buyer-side', '#getting-paid', '#low-prices-and-processing'],
  redirects: ['#manage-redirects', '#metrics', '#match-modes-v2', '#related'],
  webhooks: ['#outbound-webhooks', '#inbound-webhooks', '#tips', '#related'],
} as const satisfies Partial<Record<PluginDocsKey, readonly `#${string}`[]>>

type PluginAnchorMap = typeof PLUGIN_DOCS_ANCHORS

/** Valid heading anchors for a plugin docs page (`never` when none). */
export type PluginDocsAnchor<K extends PluginDocsKey> =
  K extends keyof PluginAnchorMap ? PluginAnchorMap[K][number] : never
