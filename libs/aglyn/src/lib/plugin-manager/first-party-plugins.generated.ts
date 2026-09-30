/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The switchboard catalog (AGL-3080): one row per plugin and capability, each
 * declared by its own `catalog` block in plugins.config.json. The core holds
 * the types and the resolvers in `enabled-plugins.ts`; it holds no row.
 */

import type { FirstPartyPlugin, PluginEditBarLink, PublishedSiteImpact } from './enabled-plugins'
import type { ResolvedPluginHostCollection, ResolvedPluginOrgCollection } from './plugin-host-collections'
import type { ResolvedPluginOrgCapacity } from './plugin-org-capacity'
import type { FunctionBindings } from './plugin-contributions'
import type { PluginDistribution } from './plugin-distribution'
import type { RepeatSourceDeclaration } from './repeat-rows'
import type { FormRecordTargetDeclaration } from './submission-record-target'
import type { PluginOrgKeyedCollection } from './plugin-org-erasure'
import type { ResolvedVideoEmbedProvider } from './video-embed-provider'
import type { AnalyticsProviderDeclaration } from '../app-utils/analytics-provider'
import type { NotificationCategoryDeclaration, NotificationDigestDeclaration } from '../app-utils/notifications'

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
    "id": "theme-presets",
    "label": "Themes",
    "alwaysOnForWorkspace": true,
    "description": "Built-in themes to pick from on Setup → Theme: Bootstrap, Minimal and Material 3.",
    "siteOff": {
      "stops": "Switching Themes off for this site removes its built-in themes from the theme picker.",
      "keeps": "A site already using one keeps it, with every edit made to it: picking a theme copies it onto the site, so nothing on the published site changes."
    }
  },
  {
    "id": "accounts",
    "label": "User Accounts",
    "description": "Visitor accounts on the site: the /signin, /signup and /recover pages, and the Members blocks. On for a new site; a site created before that stays off until you turn it on.",
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
  "theme-presets": "console-only",
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
 * Every host subcollection a first-party plugin owns, declared by that plugin
 * (AGL-3080). Core's readers ask this list; core names no collection.
 */
export const PLUGIN_HOST_COLLECTIONS_DECLARED: readonly ResolvedPluginHostCollection[] = [
  {
    "pluginId": "forms",
    "name": "forms",
    "routeSlug": "forms"
  },
  {
    "pluginId": "bookings",
    "name": "services",
    "routeSlug": "bookings"
  },
  {
    "pluginId": "bookings",
    "name": "bookings",
    "mediaScan": "none",
    "mediaScanReason": "Booking records — a customer, a time and a service pointer. The service holds the imagery and IS scanned; a booking is the transaction against it."
  },
  {
    "pluginId": "commerce",
    "name": "products",
    "routeSlug": "products"
  },
  {
    "pluginId": "commerce",
    "name": "productCategories",
    "routeSlug": "products"
  },
  {
    "pluginId": "commerce",
    "name": "suppliers",
    "routeSlug": "products"
  },
  {
    "pluginId": "commerce",
    "name": "locations",
    "routeSlug": "products"
  },
  {
    "pluginId": "commerce",
    "name": "coupons",
    "routeSlug": "products"
  },
  {
    "pluginId": "commerce",
    "name": "discounts",
    "routeSlug": "products"
  },
  {
    "pluginId": "commerce",
    "name": "reviews",
    "routeSlug": "products"
  },
  {
    "pluginId": "commerce",
    "name": "memberPosts",
    "routeSlug": "products"
  },
  {
    "pluginId": "commerce",
    "name": "resources",
    "routeSlug": "products"
  },
  {
    "pluginId": "commerce",
    "name": "settings",
    "label": "Store settings",
    "routeSlug": "products"
  },
  {
    "pluginId": "commerce",
    "name": "siteMembers"
  },
  {
    "pluginId": "commerce",
    "name": "siteMemberCredentials",
    "mediaScan": "none",
    "mediaScanReason": "A site member's password hash, one document per member, read and written only by the membership routes (AGL-3308). A credential with no content field, and no client may read it."
  },
  {
    "pluginId": "commerce",
    "name": "orders",
    "mediaScan": "none",
    "mediaScanReason": "Completed orders. Line items COPY a product's `imageUrl` at purchase time, so these would match — and matching would be the wrong answer: an order is an immutable record of what was sold, deleting the asset changes nothing about it, and no author can edit one. A busy store also holds more of these than the whole read budget."
  },
  {
    "pluginId": "commerce",
    "name": "carts",
    "mediaScan": "none",
    "mediaScanReason": "Live and abandoned carts, with the same copied line-item image and the same reasoning, at higher volume — one document per shopper session."
  },
  {
    "pluginId": "commerce",
    "name": "checkouts",
    "mediaScan": "none",
    "mediaScanReason": "In-flight checkout sessions. Transient buyer state carrying the same line-item snapshot as `carts`."
  },
  {
    "pluginId": "commerce",
    "name": "reservations",
    "mediaScan": "none",
    "mediaScanReason": "POS and booking holds. Short-lived transaction rows pointing at a resource that is itself scanned."
  },
  {
    "pluginId": "commerce",
    "name": "stockHolds",
    "mediaScan": "none",
    "mediaScanReason": "Inventory holds taken during checkout. Machine-written, short-lived, and a quantity rather than content."
  },
  {
    "pluginId": "commerce",
    "name": "subscriptions",
    "mediaScan": "none",
    "mediaScanReason": "Site membership subscriptions: a plan pointer, a status and Stripe ids. Server-written from the billing webhook."
  },
  {
    "pluginId": "commerce",
    "name": "registers",
    "mediaScan": "none",
    "mediaScanReason": "POS register allocations — a count against the register add-on, read by billing (AGL-1775). No content field at all."
  },
  {
    "pluginId": "commerce",
    "name": "giftCards",
    "mediaScan": "none",
    "mediaScanReason": "Gift card balances and redemption history. Money, not content."
  },
  {
    "pluginId": "commerce",
    "name": "licenseKeys",
    "mediaScan": "none",
    "mediaScanReason": "Digital-product license keys issued at fulfilment: a code, an order pointer and a revocation flag."
  },
  {
    "pluginId": "commerce",
    "name": "inventoryAdjustments",
    "mediaScan": "none",
    "mediaScanReason": "The append-only stock adjustment ledger (AGL-2269). One row per manual stock edit and per cancellation release, unbounded over a store's life."
  },
  {
    "pluginId": "commerce",
    "name": "inventoryReconciliation",
    "mediaScan": "none",
    "mediaScanReason": "Reconciliation runs comparing counted stock against recorded stock. Machine-written totals."
  },
  {
    "pluginId": "commerce",
    "name": "restockAlerts",
    "mediaScan": "none",
    "mediaScanReason": "Back-in-stock requests: an email address and a product pointer, written by visitors."
  },
  {
    "pluginId": "commerce",
    "name": "stripeTaxRates",
    "mediaScan": "none",
    "mediaScanReason": "Cached Stripe tax rate ids, written by the tax sync. Vendor ids."
  },
  {
    "pluginId": "marketplace",
    "name": "installs"
  },
  {
    "pluginId": "crm",
    "name": "leads",
    "mediaScan": "none",
    "mediaScanReason": "Captured leads, on the same footing as `formSubmissions`: visitor-submitted, unbounded, and never a place an author places an asset."
  },
  {
    "pluginId": "email",
    "name": "suppressions",
    "mediaScan": "none",
    "mediaScanReason": "Unsubscribes, bounces and spam complaints. Email addresses and a reason."
  },
  {
    "pluginId": "events-calendar",
    "name": "events",
    "routeSlug": "events"
  },
  {
    "pluginId": "inbox",
    "name": "formSubmissions",
    "mediaScan": "none",
    "mediaScanReason": "Visitor form submissions. Unbounded, PII-heavy, and a file attached to one is the visitor's upload — not a library asset an author picked, and not something deleting a library asset would break."
  },
  {
    "pluginId": "logic",
    "name": "functions",
    "routeSlug": "logic"
  },
  {
    "pluginId": "logic",
    "name": "variables",
    "routeSlug": "logic"
  },
  {
    "pluginId": "marketing",
    "name": "experiments",
    "routeSlug": "marketing"
  },
  {
    "pluginId": "marketing",
    "name": "overlays",
    "routeSlug": "marketing"
  },
  {
    "pluginId": "marketing",
    "name": "campaignAttributions",
    "mediaScan": "none",
    "mediaScanReason": "One row per conversion — a form submission, a lead, a contact or a booking — recording which campaign the visitor arrived from. Written only by the Admin SDK, and the whole record is three sanitized UTM strings capped at a hundred characters: there is no field an asset could occupy and no surface that could pick one into it. Unbounded on the same footing as the conversions it credits."
  },
  {
    "pluginId": "redirects",
    "name": "redirects",
    "routeSlug": "redirects"
  },
  {
    "pluginId": "workflows",
    "name": "workflows",
    "routeSlug": "automation"
  },
  {
    "pluginId": "workflows",
    "name": "webhooks",
    "routeSlug": "automation"
  },
  {
    "pluginId": "workflows",
    "name": "actions",
    "routeSlug": "automation"
  },
]

/**
 * Every org collection a first-party plugin owns whose documents the media
 * scan reads, declared by that plugin (AGL-3273).
 */
export const PLUGIN_ORG_COLLECTIONS_DECLARED: readonly ResolvedPluginOrgCollection[] = [
  {
    "pluginId": "marketing",
    "name": "campaigns",
    "routeSlug": "marketing",
    "siteField": "hostId",
    "holdsTransferWhile": {
      "field": "status",
      "values": [
        "scheduled",
        "sending"
      ]
    }
  },
  {
    "pluginId": "marketing",
    "name": "emailCampaigns",
    "mediaScan": "none",
    "mediaScanReason": "The campaign CONTAINER — a name, a date window, the list ids it is aimed at, a topic and the sites it runs on. Distinct from `campaigns`, which holds the sends and IS scanned because a send carries the copy that went out. A container carries no copy and no asset reference: the design a send renders is a screen, and the screen is where the picker writes."
  },
  {
    "pluginId": "workflows",
    "name": "automations",
    "mediaScan": "none",
    "mediaScanReason": "An org automation (AGL-3302) — a trigger, its conditions, the sites it is placed on, and a step list drawn from the server steps only: email subject and body as plain text, list, dataset and campaign ids, CRM fields and waits. No step it may hold carries a media reference, the in-page steps that could (custom HTML, popups) are refused by its save route, and it is written only by that route."
  },
]

/**
 * Every org capacity a first-party plugin backs, declared by that plugin
 * (AGL-3080). Core owns the money; this says what is counted and what it is
 * called.
 */
export const PLUGIN_ORG_CAPACITIES_DECLARED: readonly ResolvedPluginOrgCapacity[] = [
  {
    "pluginId": "data",
    "kind": "datasets",
    "order": 30,
    "collection": "datasets",
    "addonKind": "datasets",
    "includedEntitlement": "datasetsPerOrg",
    "purchaseCeilingEntitlement": "maxDatasetsPerOrg",
    "nouns": {
      "one": "dataset",
      "many": "datasets",
      "addon": "extra datasets"
    }
  },
]

/**
 * Every top-level plugin collection a workspace erasure sweeps by the field
 * naming the organization, declared by the plugin that owns it (AGL-3080).
 */
export const PLUGIN_ORG_KEYED_COLLECTIONS: readonly PluginOrgKeyedCollection[] = [
  {
    "pluginId": "outreach",
    "name": "outreachMailboxCredentials",
    "orgField": "orgId"
  },
  {
    "pluginId": "outreach",
    "name": "outreachLinks",
    "orgField": "orgId"
  },
]

/**
 * The plugins whose org eraser a workspace erasure may not run without
 * (AGL-3080): each holds a record the erasure promises to destroy.
 */
export const PLUGIN_REQUIRED_ORG_ERASERS: readonly string[] = ["marketplace"]

/**
 * The plugins whose sales the operator's sales tax return may not be filed
 * without (AGL-3080): each registers a tax return source, and one that did
 * not is refused rather than read as nothing sold.
 */
export const PLUGIN_TAX_RETURN_SOURCES: readonly string[] = ["commerce","marketplace"]

/**
 * The plugins whose earnings the operator's revenue report may not be read
 * without (AGL-3080): each registers a revenue source, and one that did not
 * is refused rather than read as nothing earned.
 */
export const PLUGIN_REVENUE_SOURCES: readonly string[] = ["commerce","marketplace"]

/**
 * Where published plugin versions and their kill switches are stored, declared
 * by the plugin that distributes them (AGL-3080). `null` when none does, and
 * the realm loader then resolves nothing.
 */
export const PLUGIN_DISTRIBUTION: PluginDistribution | null = {
  "pluginId": "marketplace",
  "listings": "marketplaceListings",
  "versions": "pluginVersions",
  "revocations": "revocations"
}

/**
 * The plugin that answers a published page's repeats, declared by that plugin
 * (AGL-3080). `null` when none does, and a repeat then renders its element
 * once, as written.
 */
export const PLUGIN_REPEAT_SOURCE_DECLARED: RepeatSourceDeclaration | null = {
  "pluginId": "data",
  "id": "dataset"
}

/**
 * The plugin whose records a form's submission may also be filed as, declared
 * by that plugin (AGL-3080). `null` when none does, and no form writes one.
 */
export const PLUGIN_FORM_RECORD_TARGET_DECLARED: FormRecordTargetDeclaration | null = {
  "pluginId": "data",
  "id": "dataset"
}

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

/**
 * Every video host whose own player the Video element frames, declared by
 * the plugin that plays it (AGL-3080). Core names no host.
 */
export const FIRST_PARTY_VIDEO_EMBED_PROVIDERS: readonly ResolvedVideoEmbedProvider[] = [
  {
    "pluginId": "mui",
    "id": "wistia",
    "label": "Wistia",
    "domains": [
      "wistia.com",
      "wistia.net",
      "wi.st"
    ],
    "mediaIdPaths": [
      "^\\/medias\\/([^/]+)(?:\\/manage)?\\/?$",
      "^\\/m\\/([^/]+)\\/?$",
      "^\\/embed\\/iframe\\/([^/]+)\\/?$",
      "^\\/embed\\/medias\\/([^/.]+)(?:\\.jsonp?)?\\/?$"
    ],
    "mediaIdPattern": "^[a-z0-9]{10}$",
    "playerOrigin": "https://fast.wistia.net",
    "playerPath": "/embed/iframe/{id}",
    "playerQuery": [
      {
        "param": "autoPlay",
        "option": "autoPlay",
        "on": "true",
        "off": "false"
      },
      {
        "param": "roundedPlayer",
        "value": "false"
      },
      {
        "param": "doNotTrack",
        "option": "doNotTrack",
        "on": "true"
      },
      {
        "param": "muted",
        "option": "muted",
        "on": "true"
      },
      {
        "param": "endVideoBehavior",
        "option": "loop",
        "on": "loop"
      }
    ]
  },
]

/**
 * The notification categories first-party plugins add to the settings page
 * and to every recipient's preferences, declared by each plugin (AGL-3080).
 */
export const PLUGIN_NOTIFICATION_CATEGORIES_DECLARED: readonly NotificationCategoryDeclaration[] = [
  {
    "pluginId": "marketplace",
    "id": "marketplace",
    "label": "Marketplace",
    "description": "Decisions on plugin listings you submitted for review.",
    "defaults": {
      "console": true,
      "email": false
    }
  },
]

/**
 * The digests first-party plugins send on their own schedule, each with the
 * key its switch is stored under, declared by the plugin that sends it
 * (AGL-3080).
 */
export const PLUGIN_NOTIFICATION_DIGESTS_DECLARED: readonly NotificationDigestDeclaration[] = [
  {
    "pluginId": "crm",
    "key": "crmDaily",
    "label": "Daily CRM digest",
    "description": "Each morning: your overdue and due-today tasks and the leads nobody has worked, here and by email."
  },
]
