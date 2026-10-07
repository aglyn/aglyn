/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The release flags plugins declare (AGL-3080): each catalog row's
 * `releaseFlagDefinition` in plugins.config.json, in catalog order. Core's
 * `release-flags.ts` folds them into `RELEASE_FLAGS`.
 */

import type { PluginReleaseFlagDefinition } from './release-flags'

/** Every release flag a plugin declares. */
export type PluginReleaseFlagKey =
  | 'release_member_accounts'
  | 'release_bookings'
  | 'release_commerce_v2'
  | 'release_marketplace'
  | 'release_crm'
  | 'release_outreach'
  | 'release_data_store'
  | 'release_email'
  | 'release_events'
  | 'release_inbox'
  | 'release_logic'
  | 'release_marketing'
  | 'release_redirects'
  | 'release_workflows'
  | 'release_accounting'

export const PLUGIN_RELEASE_FLAGS: readonly PluginReleaseFlagDefinition[] = [
  {
    "key": "release_member_accounts",
    "label": "User Accounts",
    "description": "Visitor accounts on published sites: the /signin, /signup and /recover pages and the Members blocks (AGL-2486). Platform-wide kill switch only — whether a given SITE serves those pages is the per-site User Accounts toggle, which is off until a site opts in.",
    "defaultEnabled": true
  },
  {
    "key": "release_bookings",
    "label": "Bookings",
    "description": "Bookings & scheduling for host sites.",
    "defaultEnabled": true,
    "navTabId": "nav-tab-bookings"
  },
  {
    "key": "release_commerce_v2",
    "label": "Commerce v2",
    "description": "Full ecommerce wave: catalog/variants, cart + checkout, digital goods, reservations, POS, and the repriced commerce tiers (AGL-276..331).",
    "defaultEnabled": true
  },
  {
    "key": "release_marketplace",
    "label": "Marketplace",
    "description": "Marketplace browsing, publishing and plugin installs.",
    "defaultEnabled": true,
    "navTabId": "nav-tab-org-marketplace"
  },
  {
    "key": "release_crm",
    "label": "CRM",
    "description": "The CRM: contacts, leads, companies, deals, tasks, reports and fields.",
    "defaultEnabled": true,
    "navTabId": "nav-tab-contacts"
  },
  {
    "key": "release_outreach",
    "label": "Sequences",
    "description": "One-to-one, multi-step email sequences sent from a rep’s own connected mailbox and logged in the CRM (AGL-2974). OFF by default and staff preview only. An organization also needs the `outreach` entitlement, which no plan carries, so a customer reaches it only through a per-org entitlement override.",
    "defaultEnabled": false,
    "navTabId": "nav-tab-org-outreach"
  },
  {
    "key": "release_data_store",
    "label": "Data store",
    "description": "Datasets, models and dynamic data bindings.",
    "defaultEnabled": true,
    "navTabId": "nav-tab-data"
  },
  {
    "key": "release_email",
    "label": "Email",
    "description": "Designed emails, campaigns, and audience sending.",
    "defaultEnabled": true
  },
  {
    "key": "release_events",
    "label": "Events",
    "description": "Event calendar management (AGL-145 add-on surface).",
    "defaultEnabled": true,
    "navTabId": "nav-tab-events"
  },
  {
    "key": "release_inbox",
    "label": "Inbox",
    "description": "Form submissions, site members, and the lead inbox.",
    "defaultEnabled": true,
    "navTabId": "nav-tab-inbox"
  },
  {
    "key": "release_logic",
    "label": "Logic",
    "description": "Variables, no-code functions, and reference health.",
    "defaultEnabled": true,
    "navTabId": "nav-tab-logic"
  },
  {
    "key": "release_marketing",
    "label": "Marketing",
    "description": "Overlays, campaigns at-a-glance, and A/B experiments.",
    "defaultEnabled": true,
    "navTabId": "nav-tab-marketing"
  },
  {
    "key": "release_redirects",
    "label": "Redirects",
    "description": "Redirect manager with usage analytics.",
    "defaultEnabled": true,
    "navTabId": "nav-tab-redirects"
  },
  {
    "key": "release_workflows",
    "label": "Automation",
    "description": "Workflows, actions, webhooks and their run history.",
    "defaultEnabled": true,
    "navTabId": "nav-tab-workflows"
  },
  {
    "key": "release_accounting",
    "label": "Accounting",
    "description": "QuickBooks Online and Xero sync for commerce: sales receipts or a daily summary journal, refunds, platform fees and Stripe payouts, with a mapping page and a sync log (AGL-3614). OFF by default; needs the deployment's Intuit or Xero app credentials and the accounting token key on the console.",
    "defaultEnabled": false,
    "navTabId": "nav-tab-org-accounting"
  }
]
