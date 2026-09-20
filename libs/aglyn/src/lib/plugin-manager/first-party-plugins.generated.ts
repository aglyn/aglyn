/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The switchboard catalog (AGL-3080): one row per plugin and capability, each
 * declared by its own `catalog` block in plugins.config.json. The core holds
 * the types and the resolvers in `enabled-plugins.ts`; it holds no row.
 */

import type { FirstPartyPlugin, PublishedSiteImpact } from './enabled-plugins'

export const FIRST_PARTY_PLUGINS: readonly FirstPartyPlugin[] = [
  {
    "id": "mui",
    "label": "Components",
    "alwaysOn": true,
    "description": "The base component and theme library every site builds on."
  },
  {
    "id": "forms",
    "label": "Forms",
    "alwaysOnForWorkspace": true,
    "description": "Forms on the site and the catalog that owns them.",
    "siteOff": {
      "stops": "Switching Forms off for this site stops forms rendering on its published pages, refuses every submission sent to it, and blocks publishing a form, or a page that carries one, until Forms is back on.",
      "keeps": "Submissions already received, the workspace’s form catalog and the CRM leads its forms created are kept, and forms keep working on the workspace’s other sites.",
      "confirm": true,
      "pages": {
        "heading": "These published pages carry a form. Their forms stop rendering and stop accepting submissions:",
        "none": "No published page on this site carries a form."
      }
    }
  },
  {
    "id": "ai",
    "label": "AI",
    "alwaysOnForWorkspace": true,
    "description": "The assistant, generative building and automation, and the AI add-on.",
    "siteOff": {
      "stops": "Switching AI off for this site hides the assistant, Describe it, the AI cards and the editor’s AI controls on this site, refuses every AI request made for it, and stops its queued AI jobs without spending credits.",
      "keeps": "It does not stop the workspace’s AI add-on, credits, allotments or overage billing, and AI keeps working on the workspace’s other sites."
    }
  },
  {
    "id": "accounts",
    "label": "User Accounts",
    "description": "Visitor accounts on the site: the /signin, /signup and /recover pages, and the Members blocks. Off for a site until you turn it on.",
    "releaseFlag": "release_member_accounts",
    "defaultOffPerSite": true,
    "requires": [
      "commerce"
    ]
  },
  {
    "id": "bookings",
    "label": "Bookings",
    "description": "Services, open slots, and paid bookings.",
    "releaseFlag": "release_bookings"
  },
  {
    "id": "commerce",
    "label": "Commerce",
    "description": "Products, carts, checkout, orders, POS.",
    "releaseFlag": "release_commerce_v2"
  },
  {
    "id": "marketplace",
    "label": "Marketplace",
    "description": "Marketplace listings, templates, and installs.",
    "releaseFlag": "release_marketplace"
  },
  {
    "id": "crm",
    "label": "CRM",
    "description": "Leads, contacts, companies, deals, tasks and reports.",
    "releaseFlag": "release_crm"
  },
  {
    "id": "outreach",
    "label": "Sequences",
    "description": "One-to-one email sequences sent from connected mailboxes.",
    "releaseFlag": "release_outreach"
  },
  {
    "id": "data",
    "label": "Data",
    "description": "Datasets, records, and CSV import/export.",
    "releaseFlag": "release_data_store"
  },
  {
    "id": "email",
    "label": "Email",
    "description": "Designed emails and campaign sending.",
    "releaseFlag": "release_email"
  },
  {
    "id": "events-calendar",
    "label": "Events Calendar",
    "description": "Event lists and calendars.",
    "releaseFlag": "release_events"
  },
  {
    "id": "inbox",
    "label": "Inbox",
    "description": "Form submissions and lead inbox.",
    "releaseFlag": "release_inbox"
  },
  {
    "id": "logic",
    "label": "Logic",
    "description": "Variables, functions, and reference health.",
    "releaseFlag": "release_logic"
  },
  {
    "id": "marketing",
    "label": "Marketing",
    "description": "Overlays, campaigns, and experiments.",
    "releaseFlag": "release_marketing"
  },
  {
    "id": "redirects",
    "label": "Redirects",
    "description": "URL redirect rules.",
    "releaseFlag": "release_redirects"
  },
  {
    "id": "workflows",
    "label": "Automation",
    "description": "Workflows, actions, webhooks, and run logs.",
    "releaseFlag": "release_workflows"
  },
]

export const PUBLISHED_SITE_IMPACT: Readonly<Record<string, PublishedSiteImpact>> = {
  "mui": "elements",
  "forms": "elements",
  "ai": "console-only",
  "accounts": "routes",
  "bookings": "elements",
  "commerce": "elements",
  "marketplace": "console-only",
  "crm": "console-only",
  "outreach": "console-only",
  "data": "console-only",
  "email": "elements",
  "events-calendar": "elements",
  "inbox": "console-only",
  "logic": "console-only",
  "marketing": "elements",
  "redirects": "routes",
  "workflows": "routes",
}
