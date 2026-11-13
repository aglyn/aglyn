/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The part of the switchboard catalog (AGL-3080) a published page runs on
 * (AGL-4220): each row's switches without its console copy, and the small
 * declarations the published page reads. The full rows, copy included, are
 * `FIRST_PARTY_PLUGINS` in first-party-plugins.generated.ts, which
 * re-exports the rest of this file.
 */

import type { FirstPartyPluginSwitch, PluginEditBarLink, PublishedSiteImpact } from './enabled-plugins'
import type { FunctionBindings } from './plugin-contributions'
import type { AnalyticsProviderDeclaration } from '../app-utils/analytics-provider'

/** Every catalog row without `description` or `siteOff`, in catalog order. */
export const FIRST_PARTY_PLUGIN_SWITCHES: readonly FirstPartyPluginSwitch[] = [
  {
    "id": "mui",
    "label": "Components",
    "alwaysOn": true
  },
  {
    "id": "forms",
    "label": "Forms",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "ai",
    "label": "AI",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "theme-presets",
    "label": "Themes",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "funnels",
    "label": "Funnels",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "accounts",
    "label": "User Accounts",
    "releaseFlag": "release_member_accounts",
    "defaultOffPerSite": true,
    "requires": [
      "commerce"
    ]
  },
  {
    "id": "bookings",
    "label": "Bookings",
    "releaseFlag": "release_bookings"
  },
  {
    "id": "commerce",
    "label": "Commerce",
    "releaseFlag": "release_commerce_v2"
  },
  {
    "id": "marketplace",
    "label": "Marketplace",
    "releaseFlag": "release_marketplace"
  },
  {
    "id": "crm",
    "label": "CRM",
    "releaseFlag": "release_crm"
  },
  {
    "id": "outreach",
    "label": "Sequences",
    "releaseFlag": "release_outreach"
  },
  {
    "id": "data",
    "label": "Data",
    "releaseFlag": "release_data_store"
  },
  {
    "id": "email",
    "label": "Email",
    "releaseFlag": "release_email"
  },
  {
    "id": "events-calendar",
    "label": "Events Calendar",
    "releaseFlag": "release_events"
  },
  {
    "id": "inbox",
    "label": "Inbox",
    "releaseFlag": "release_inbox"
  },
  {
    "id": "logic",
    "label": "Logic",
    "releaseFlag": "release_logic"
  },
  {
    "id": "marketing",
    "label": "Marketing",
    "releaseFlag": "release_marketing"
  },
  {
    "id": "redirects",
    "label": "Redirects",
    "releaseFlag": "release_redirects"
  },
  {
    "id": "workflows",
    "label": "Automation",
    "releaseFlag": "release_workflows"
  },
  {
    "id": "accounting",
    "label": "Accounting",
    "releaseFlag": "release_accounting"
  },
  {
    "id": "shipping",
    "label": "Shipping",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "tax-engines",
    "label": "Tax services",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "sales-channels",
    "label": "Sales channels",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "marketing-platforms",
    "label": "Email platforms",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "fonts",
    "label": "Fonts",
    "alwaysOn": true
  },
  {
    "id": "post-purchase",
    "label": "Tracking and protection",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "fulfillment-networks",
    "label": "Fulfillment networks",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "marketplaces",
    "label": "Marketplaces",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "print-on-demand",
    "label": "Print on demand",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "inventory-sync",
    "label": "Inventory sync",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "delivery-apps",
    "label": "Delivery apps",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "loyalty",
    "label": "Rewards",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "couriers",
    "label": "Couriers",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "lightbox",
    "label": "Lightbox",
    "alwaysOn": true
  },
  {
    "id": "live-chat",
    "label": "Live chat",
    "alwaysOnForWorkspace": true,
    "defaultOffPerSite": true
  },
  {
    "id": "review-platforms",
    "label": "Review platforms",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "weglot",
    "label": "Weglot translation",
    "releaseFlag": "release_weglot",
    "defaultOffPerSite": true
  },
  {
    "id": "music",
    "label": "Music player",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "help-desks",
    "label": "Help desks",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "waivers",
    "label": "Waivers",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "ad-conversions",
    "label": "Ad conversions",
    "alwaysOnForWorkspace": true
  },
  {
    "id": "domains",
    "label": "Domains",
    "alwaysOnForWorkspace": true
  },
]

export const PUBLISHED_SITE_IMPACT: Readonly<Record<string, PublishedSiteImpact>> = {
  "mui": "elements",
  "forms": "elements",
  "ai": "console-only",
  "theme-presets": "console-only",
  "funnels": "console-only",
  "accounts": "routes",
  "bookings": "elements",
  "commerce": "elements",
  "marketplace": "console-only",
  "crm": "console-only",
  "outreach": "console-only",
  "data": "routes",
  "email": "elements",
  "events-calendar": "elements",
  "inbox": "console-only",
  "logic": "console-only",
  "marketing": "elements",
  "redirects": "routes",
  "workflows": "routes",
  "accounting": "console-only",
  "shipping": "console-only",
  "tax-engines": "console-only",
  "sales-channels": "routes",
  "marketing-platforms": "console-only",
  "fonts": "console-only",
  "post-purchase": "console-only",
  "fulfillment-networks": "console-only",
  "marketplaces": "console-only",
  "print-on-demand": "console-only",
  "inventory-sync": "console-only",
  "delivery-apps": "console-only",
  "loyalty": "console-only",
  "couriers": "console-only",
  "lightbox": "elements",
  "live-chat": "elements",
  "review-platforms": "console-only",
  "weglot": "elements",
  "music": "elements",
  "help-desks": "console-only",
  "waivers": "elements",
  "ad-conversions": "console-only",
  "domains": "console-only",
}

/**
 * The admin edit bar's quick links, in the order they are drawn — each
 * declared by the plugin whose console page it opens (AGL-3080).
 */
export const PLUGIN_EDIT_BAR_LINKS: readonly PluginEditBarLink[] = [
  {
    "pluginId": "inbox",
    "order": 20,
    "label": "Inbox",
    "path": "/inbox"
  },
  {
    "pluginId": "commerce",
    "order": 30,
    "label": "Orders",
    "path": "/products/orders"
  },
]

/**
 * The analytics settings each provider mounts a tag for, declared by the
 * plugin that adapts the vendor (AGL-3080). Empty when none does, and then no
 * setting configures a tag.
 */
export const ANALYTICS_PROVIDERS_DECLARED: readonly AnalyticsProviderDeclaration[] = [
  {
    "pluginId": "marketing",
    "settings": [
      "gaMeasurementId",
      "gtmContainerId"
    ]
  },
]

/**
 * Every first-party element that runs a site function, and the prop naming
 * it, declared by that element's plugin (AGL-3393). Core names no element.
 */
export const FIRST_PARTY_FUNCTION_BINDINGS: FunctionBindings = {}
