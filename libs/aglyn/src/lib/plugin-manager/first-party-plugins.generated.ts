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
import type { ResolvedPluginSitemapSection } from './plugin-sitemap-sections'
import type { ResolvedPluginSitemapReaderDeclaration } from './plugin-sitemap-readers'
import type { ResolvedPluginSiteBundleSectionDeclaration } from './plugin-site-bundle'
import type { ResolvedTransferResourceDeclaration } from './plugin-transfer-resources'
import type { ResolvedPluginOrgCapacity } from './plugin-org-capacity'
import type { ResolvedPluginEntityPicker } from './plugin-entity-pickers'
import type { ResolvedPluginRecordPage } from './plugin-record-pages'
import type { ResolvedVisitorDoor } from './plugin-visitor-doors'
import type { ResolvedPluginCostAxis, ResolvedPluginSpendLine, ResolvedPluginUsageBand, ResolvedPluginUsageMeter } from './plugin-usage-axes'
import type { ResolvedPluginPlanFeature, ResolvedPluginPlanQuota } from './plugin-plan-entitlements'
import type { FunctionBindings } from './plugin-contributions'
import type { PluginDistribution } from './plugin-distribution'
import type { RepeatSourceDeclaration } from './repeat-rows'
import type { PluginTemplateSource } from './plugin-template-sources'
import type { FormRecordTargetDeclaration } from './submission-record-target'
import type { ArtifactTypeDeclaration } from './plugin-artifact-types'
import type { ResolvedBesignerDocument } from './besigner-documents'
import type { PluginOrgKeyedCollection } from './plugin-org-erasure'
import type { ResolvedVideoEmbedProvider } from './video-embed-provider'
import type { AnalyticsProviderDeclaration } from '../app-utils/analytics-provider'
import type { InteractionStepDeclaration } from '../app-utils/site-interactions'
import type { ServerStepDeclaration } from './plugin-server-steps'
import type { InteractionRecipeDeclaration } from './interaction-recipes'
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
      "stops": "Switching AI off for this site hides the assistant, Create with AI, the AI cards and the editor’s AI controls on this site, refuses every AI request made for it, and stops its queued AI jobs without spending credits.",
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
    "id": "funnels",
    "label": "Funnels",
    "alwaysOnForWorkspace": true,
    "description": "Step-by-step conversion on a site's Analytics page: visits at each step, drop-off and time between steps.",
    "siteOff": {
      "stops": "Switching Funnels off for this site removes the Funnels card from its Analytics page.",
      "keeps": "Saved funnels are kept, and visits keep being recorded while the site has one; delete the funnels to stop recording."
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
    "routeSlug": "forms",
    "siteExport": {
      "limit": 200,
      "fields": [
        "displayName",
        "slug",
        "fields",
        "consentFieldName",
        "routing",
        "legacyMatch",
        "rootId",
        "nodes",
        "archivedAt",
        "retired",
        "campaignIds",
        "inCampaign",
        "stats",
        "nameLower",
        "nameTokens",
        "nameReversed",
        "searchTokens"
      ],
      "package": {
        "kind": "form",
        "label": "Forms",
        "nameField": "displayName",
        "slugField": "slug",
        "placements": [
          {
            "componentId": "form",
            "prop": "formId"
          }
        ]
      },
      "count": {
        "quotaKey": "formsPerHost"
      }
    }
  },
  {
    "pluginId": "forms",
    "name": "formSubmissions",
    "mediaScan": "none",
    "mediaScanReason": "Visitor form submissions. Unbounded, PII-heavy, and a file attached to one is the visitor's upload — not a library asset an author picked, and not something deleting a library asset would break."
  },
  {
    "pluginId": "bookings",
    "name": "services",
    "routeSlug": "bookings",
    "resource": {
      "kind": "service",
      "label": "services",
      "activityNoun": "service",
      "quotaKey": "servicesPerHost",
      "entitlement": "bookings",
      "fields": [
        "name",
        "description",
        "durationMinutes",
        "priceUsd",
        "timezone",
        "windows",
        "crmFollowUpTask",
        "crmMeetingActivity",
        "askPhone",
        "askAddress",
        "priceDisplay"
      ]
    },
    "siteExport": {
      "limit": 50,
      "fields": [
        "name",
        "description",
        "durationMinutes",
        "priceUsd",
        "timezone",
        "windows",
        "crmFollowUpTask",
        "crmMeetingActivity",
        "askPhone",
        "askAddress",
        "priceDisplay"
      ],
      "package": {
        "kind": "service",
        "label": "Booking services",
        "nameField": "name"
      }
    }
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
    "routeSlug": "products",
    "resource": {
      "kind": "product",
      "label": "products",
      "activityNoun": "product",
      "quotaKey": "productsPerHost",
      "entitlement": "commerce",
      "fields": [
        "name",
        "slug",
        "description",
        "type",
        "status",
        "mediaUrls",
        "categoryIds",
        "tags",
        "options",
        "variants",
        "seo",
        "supplierId",
        "oversellPolicy",
        "taxExempt",
        "digitalFiles",
        "downloadLimit",
        "subscription",
        "subscriptionOptional",
        "gatedVideos",
        "relatedProductIds",
        "giftCard",
        "lowStockThreshold",
        "createdAtMs",
        "updatedAtMs",
        "nameLower",
        "nameTokens",
        "nameReversed",
        "skus",
        "barcodes",
        "priceFromCents",
        "soldOut",
        "collectionIds",
        "priceUsd",
        "inventory",
        "imageUrl"
      ],
      "stamps": {
        "deletedAt": null
      }
    }
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
    "routeSlug": "products",
    "resource": {
      "kind": "location",
      "label": "inventory locations",
      "activityNoun": "inventory location",
      "quotaKey": "inventoryLocations",
      "entitlement": "commerce",
      "fields": [
        "name",
        "isDefault",
        "address"
      ]
    }
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
    "mediaScanReason": "POS register allocations — a count against the register add-on, read by billing (AGL-1775). No content field at all.",
    "resource": {
      "kind": "register",
      "label": "POS registers",
      "activityNoun": "POS register",
      "quotaKey": "posRegisters",
      "entitlement": "pos",
      "fields": [
        "name",
        "locationId"
      ]
    }
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
    "pluginId": "commerce",
    "name": "returns",
    "mediaScan": "none",
    "mediaScanReason": "Returns (AGL-3611): line indexes, quantities, reasons and a return label link, written only by the returns routes. A return names no image of its own; the order's lines carry the copies, and the order is not scanned for the same reason."
  },
  {
    "pluginId": "commerce",
    "name": "orderWebhooks",
    "mediaScan": "none",
    "mediaScanReason": "The merchant's outbound order webhook endpoints (AGL-3611): a URL and the event names it takes. Scanning reads every endpoint for a URL that is never a media file."
  },
  {
    "pluginId": "commerce",
    "name": "orderWebhookSecrets",
    "mediaScan": "none",
    "mediaScanReason": "Sealed HMAC signing secrets for the order webhooks (AGL-3611). Reading them for media would put a secret on a scan path to match nothing."
  },
  {
    "pluginId": "commerce",
    "name": "orderWebhookDeliveries",
    "mediaScan": "none",
    "mediaScanReason": "The webhook delivery log (AGL-3611): one row per event per endpoint, expiring after 30 days. A body copies the order, whose image URLs record what was sold rather than use the file, so a match would be wrong, and a busy store holds thousands."
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
    "pluginId": "data",
    "name": "recordPages",
    "label": "record template",
    "mediaScan": "none",
    "mediaScanReason": "A binding holds a dataset id, a base path and field ids — never a value. The images a record page shows are the record's own, in the organization's dataset records, which no site collection holds."
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
    "routeSlug": "events",
    "siteExport": {
      "limit": 200,
      "fields": [
        "title",
        "startsAtMs",
        "endsAtMs",
        "location",
        "organizer",
        "description",
        "coverImage",
        "coverImageAlt",
        "status"
      ],
      "package": {
        "kind": "event",
        "label": "Events",
        "nameField": "title"
      },
      "count": {
        "uncapped": "The events page creates an event with a client write and no count, so a restore mints nothing an editor could not already."
      }
    }
  },
  {
    "pluginId": "logic",
    "name": "functions",
    "routeSlug": "logic",
    "resource": {
      "kind": "function",
      "label": "functions",
      "activityNoun": "function",
      "activityType": "function",
      "quotaKey": "functionsPerHost",
      "fields": [
        "name",
        "parameters",
        "variables",
        "operations",
        "returnValue"
      ]
    },
    "siteExport": {
      "limit": 100,
      "fields": [
        "name",
        "parameters",
        "variables",
        "operations",
        "returnValue"
      ],
      "package": {
        "kind": "function",
        "label": "Functions",
        "nameField": "name",
        "bindingToken": "fn"
      }
    }
  },
  {
    "pluginId": "logic",
    "name": "variables",
    "routeSlug": "logic",
    "resource": {
      "kind": "variable",
      "label": "variables",
      "activityNoun": "variable",
      "activityType": "variable",
      "quotaKey": "variablesPerHost",
      "fields": [
        "name",
        "type",
        "value",
        "workflowId",
        "workflowName"
      ]
    },
    "siteExport": {
      "limit": 100,
      "fields": [
        "name",
        "type",
        "value",
        "workflowId",
        "workflowName"
      ],
      "package": {
        "kind": "variable",
        "label": "Variables",
        "nameField": "name",
        "references": [
          {
            "field": "workflowId",
            "kind": "workflow"
          }
        ],
        "bindingToken": "var"
      }
    }
  },
  {
    "pluginId": "marketing",
    "name": "experiments",
    "routeSlug": "marketing",
    "siteExport": {
      "limit": 100,
      "fields": [
        "name",
        "nameLower",
        "nameTokens",
        "nameReversed",
        "status",
        "target",
        "screenId",
        "nodeId",
        "variants",
        "goal",
        "winnerVariantId",
        "endAtMs",
        "autoWinner",
        "autoCompleted",
        "completedAt"
      ],
      "package": {
        "kind": "experiment",
        "label": "Experiments",
        "nameField": "name",
        "references": [
          {
            "field": "screenId",
            "kind": "page"
          }
        ]
      },
      "count": {
        "uncapped": "The experiments card creates an experiment with a client write and no count, so a restore mints nothing an editor could not already."
      }
    }
  },
  {
    "pluginId": "marketing",
    "name": "overlays",
    "routeSlug": "marketing",
    "siteExport": {
      "limit": 100,
      "fields": [
        "kind",
        "name",
        "enabled",
        "startAtMs",
        "endAtMs",
        "pathPatterns",
        "excludePathPatterns",
        "order",
        "bar",
        "popup",
        "stats"
      ],
      "package": {
        "kind": "overlay",
        "label": "Bars and popups",
        "nameField": "name"
      },
      "count": {
        "uncapped": "The overlays card creates a bar or popup with a client write and no count, so a restore mints nothing an editor could not already."
      }
    }
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
    "routeSlug": "redirects",
    "resource": {
      "kind": "redirect",
      "label": "redirects",
      "activityNoun": "redirect",
      "quotaKey": "redirectsPerHost",
      "entitlement": "redirects",
      "requiresPublishRole": true,
      "fields": [
        "source",
        "destination",
        "statusCode",
        "kind",
        "priority",
        "enabled"
      ],
      "externalDestination": {
        "field": "destination",
        "approvedByField": "externalDestinationApprovedBy"
      },
      "livePathField": "source"
    },
    "siteExport": {
      "limit": 500,
      "fields": [
        "source",
        "destination",
        "statusCode",
        "kind",
        "priority",
        "enabled"
      ],
      "package": {
        "kind": "redirect",
        "label": "Redirects",
        "nameField": "source"
      }
    }
  },
  {
    "pluginId": "workflows",
    "name": "workflows",
    "routeSlug": "automation",
    "resource": {
      "kind": "workflow",
      "label": "workflows",
      "activityNoun": "workflow",
      "activityType": "workflow",
      "quotaKey": "workflowsPerHost",
      "entitlement": "workflows",
      "fields": [
        "name",
        "steps",
        "returnValue",
        "trigger"
      ],
      "duplicate": {
        "nameField": "name",
        "fields": [
          "steps",
          "returnValue"
        ],
        "stamps": {
          "trigger": null
        }
      }
    },
    "siteExport": {
      "limit": 100,
      "fields": [
        "name",
        "steps",
        "returnValue",
        "trigger"
      ],
      "package": {
        "kind": "workflow",
        "label": "Workflows",
        "nameField": "name"
      }
    }
  },
  {
    "pluginId": "workflows",
    "name": "webhooks",
    "routeSlug": "automation",
    "resource": {
      "kind": "webhook",
      "label": "webhooks",
      "activityNoun": "webhook",
      "entitlement": "webhooks",
      "platformCap": "WEBHOOK_MAX_PER_HOST",
      "softDeletes": true,
      "fields": [
        "name",
        "direction",
        "url",
        "workflowName",
        "secret",
        "enabled"
      ]
    }
  },
  {
    "pluginId": "workflows",
    "name": "actions",
    "routeSlug": "automation",
    "resource": {
      "kind": "action",
      "label": "interactions and actions",
      "activityNoun": "action",
      "platformCap": "ACTIONS_MAX_PER_HOST",
      "softDeletes": true,
      "fields": [
        "name",
        "description",
        "trigger",
        "steps",
        "enabled",
        "frequency",
        "cooldownMinutes",
        "audience",
        "nodeId",
        "screenId"
      ]
    },
    "siteExport": {
      "limit": 100,
      "fields": [
        "name",
        "trigger",
        "steps",
        "enabled",
        "recipe"
      ],
      "package": {
        "kind": "action",
        "label": "Interactions and actions",
        "nameField": "name"
      }
    }
  },
  {
    "pluginId": "funnels",
    "name": "funnels",
    "mediaScan": "none",
    "mediaScanReason": "A funnel is a name and its steps — paths and record ids, never an asset. Written only by the funnels save route."
  },
  {
    "pluginId": "funnels",
    "name": "funnelJourneys",
    "mediaScan": "none",
    "mediaScanReason": "One document per recorded visit: step types, paths or record ids, server times and UTM labels. Written only by the site collector on the Admin SDK, read only by the results route; expires 90 days after the visit."
  },
  {
    "pluginId": "funnels",
    "name": "funnelResults",
    "mediaScan": "none",
    "mediaScanReason": "A computed funnel result — counts, shares and durations — kept up to a day by the results route and expiring on its own."
  },
]

/**
 * Every child sitemap a first-party plugin's documents fill, declared by that
 * plugin (AGL-3080), in the order the index lists them.
 */
export const PLUGIN_SITEMAP_SECTIONS_DECLARED: readonly ResolvedPluginSitemapSection[] = [
  {
    "pluginId": "commerce",
    "section": "products",
    "collection": "products",
    "where": {
      "field": "status",
      "equals": "active"
    },
    "enabledBy": {
      "doc": "settings/store",
      "field": "pdpScreenId"
    },
    "path": "/products/{slug}",
    "skipWhen": "deletedAt",
    "lastmod": [
      "updatedAtMs",
      "createdAtMs"
    ]
  },
  {
    "pluginId": "commerce",
    "section": "catalog",
    "collection": "collections",
    "where": {
      "field": "kind",
      "equals": "catalog"
    },
    "enabledBy": {
      "doc": "settings/store",
      "field": "collectionScreenId"
    },
    "path": "/collections/{slug}",
    "lastmod": [
      "updatedAt",
      "createdAt"
    ]
  },
]

/**
 * Every child-sitemap family a first-party plugin's reader lists, declared by
 * that plugin (AGL-3475), in the order the index lists them.
 */
export const PLUGIN_SITEMAP_READERS_DECLARED: readonly ResolvedPluginSitemapReaderDeclaration[] = [
  {
    "pluginId": "data",
    "section": "records"
  }
]

/**
 * Every section of the whole-site backup a first-party plugin answers for,
 * declared by that plugin (AGL-3080), in the order the bundle carries them.
 */
export const PLUGIN_SITE_BUNDLE_SECTIONS_DECLARED: readonly ResolvedPluginSiteBundleSectionDeclaration[] = [
  {
    "pluginId": "data",
    "key": "datasets",
    "limit": 50,
    "package": {
      "kind": "dataset",
      "label": "Datasets",
      "nameField": "displayName",
      "placements": [
        {
          "prop": "repeatDataset"
        },
        {
          "componentId": "form",
          "prop": "datasetId"
        }
      ]
    }
  }
]

/**
 * Every resource a first-party plugin can import or export, declared by that
 * plugin (AGL-3523), in the order the transfer hub lists them.
 */
export const PLUGIN_TRANSFER_RESOURCES_DECLARED: readonly ResolvedTransferResourceDeclaration[] = [
  {
    "pluginId": "forms",
    "key": "forms.submissions",
    "label": "Form submissions",
    "singularLabel": "Form submission",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "description": "What visitors sent through this site’s forms: each answer, and when, on which page and through which form it arrived.",
    "exportOnly": true
  },
  {
    "pluginId": "bookings",
    "key": "bookings",
    "featureFlag": "bookings",
    "label": "Bookings",
    "singularLabel": "Booking",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "description": "Every booking on this site: the service, the time, the customer’s details, its status and what was paid.",
    "exportOnly": true
  },
  {
    "pluginId": "commerce",
    "key": "commerce.products",
    "label": "Products",
    "singularLabel": "Product",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 50000
    },
    "description": "Products with their options, variants, prices, stock, images and search listing."
  },
  {
    "pluginId": "commerce",
    "key": "commerce.categories",
    "label": "Product categories",
    "singularLabel": "Product category",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 2000
    },
    "description": "The category tree products are filed under, matched by slug, then name."
  },
  {
    "pluginId": "commerce",
    "key": "commerce.orders",
    "label": "Orders",
    "singularLabel": "Order",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "exportOnly": true,
    "description": "Every order with its items, money, customer and addresses. Exported only."
  },
  {
    "pluginId": "commerce",
    "key": "commerce.discounts",
    "label": "Discounts",
    "singularLabel": "Discount",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 5000
    },
    "description": "Discount codes and automatic promotions, matched by code, then name. New ones start switched off."
  },
  {
    "pluginId": "commerce",
    "key": "commerce.coupons",
    "label": "Coupons",
    "singularLabel": "Coupon",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 5000
    },
    "description": "Percent-off coupon codes, matched by code. New ones start switched off."
  },
  {
    "pluginId": "commerce",
    "key": "commerce.gift-cards",
    "featureFlag": "giftCards",
    "featureFlagExempt": [
      "export"
    ],
    "importRoles": [
      "admin"
    ],
    "label": "Gift cards",
    "singularLabel": "Gift card",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 2000
    },
    "description": "Every gift card's code, balance and status. An import issues each card, confirmed by the total."
  },
  {
    "pluginId": "commerce",
    "key": "commerce.tracking",
    "label": "Tracking numbers",
    "singularLabel": "Tracking number",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 5000
    },
    "description": "Tracking numbers from a label tool, each recorded as a shipment on the order it names."
  },
  {
    "pluginId": "crm",
    "key": "crm.contacts",
    "featureFlag": "crm",
    "featureFlagExempt": [
      "export"
    ],
    "label": "Contacts",
    "singularLabel": "Contact",
    "scope": "org",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 50000
    },
    "description": "Every contact field, custom fields included, with the company, the manager and the owner by name."
  },
  {
    "pluginId": "crm",
    "key": "crm.companies",
    "featureFlag": "crm",
    "label": "Companies",
    "singularLabel": "Company",
    "scope": "org",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 50000
    },
    "description": "Every company field, custom fields included, with the parent company and the owner by name."
  },
  {
    "pluginId": "crm",
    "key": "crm.email-templates",
    "featureFlag": "crm",
    "label": "Email templates",
    "singularLabel": "Email template",
    "scope": "org",
    "kinds": [
      "package"
    ],
    "formats": [
      "json"
    ],
    "limits": {
      "maxRows": 200
    },
    "description": "Shared email templates and snippets, and your own personal ones."
  },
  {
    "pluginId": "crm",
    "key": "crm.leads",
    "featureFlag": "crm",
    "featureFlagExempt": [
      "export"
    ],
    "label": "Leads",
    "singularLabel": "Lead",
    "scope": "org",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 50000
    },
    "description": "Every lead field, custom fields included, with the status, the owner and the campaigns by name."
  },
  {
    "pluginId": "crm",
    "key": "crm.deals",
    "featureFlag": "crm",
    "label": "Deals",
    "singularLabel": "Deal",
    "scope": "org",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 50000
    },
    "description": "Every deal field, custom fields and contact roles included, with the pipeline, stage, contact and company by name."
  },
  {
    "pluginId": "crm",
    "key": "crm.tasks",
    "featureFlag": "crm",
    "label": "Tasks",
    "singularLabel": "Task",
    "scope": "org",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 50000
    },
    "description": "Every task, with its type, priority and status as your lists label them and the contact, company and deal it is for."
  },
  {
    "pluginId": "crm",
    "key": "crm.activities",
    "featureFlag": "crm",
    "label": "Activities",
    "singularLabel": "Activity",
    "scope": "org",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "exportOnly": true,
    "description": "Every call, email, meeting and note the team logged, with who logged it and what it was about."
  },
  {
    "pluginId": "crm",
    "key": "crm.pipelines",
    "featureFlag": "crm",
    "label": "Pipelines and stages",
    "singularLabel": "Stage",
    "scope": "org",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "exportOnly": true,
    "description": "Each pipeline with its stages in order: their kind, probability and forecast category."
  },
  {
    "pluginId": "crm",
    "key": "crm.fields",
    "featureFlag": "crm",
    "label": "Custom fields",
    "singularLabel": "Custom field",
    "scope": "org",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "exportOnly": true,
    "description": "Every custom field you defined, on which record, of what type, with its choices."
  },
  {
    "pluginId": "outreach",
    "key": "outreach.sequences",
    "featureFlag": "outreach",
    "label": "Sequences",
    "singularLabel": "Sequence",
    "scope": "org",
    "kinds": [
      "package"
    ],
    "formats": [
      "json"
    ],
    "limits": {
      "maxRows": 500
    },
    "description": "Each sequence's steps and settings, imported as a draft. Never who was enrolled or what was sent."
  },
  {
    "pluginId": "outreach",
    "key": "outreach.do-not-contact",
    "featureFlag": "outreach",
    "label": "Do-not-contact list",
    "singularLabel": "Do-not-contact entry",
    "scope": "org",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "description": "The domains and addresses sequences never email. An import only adds to it; an address is kept as a fingerprint, so only domains are exported."
  },
  {
    "pluginId": "data",
    "key": "data.dataset",
    "featureFlag": "dataStore",
    "label": "Dataset records",
    "singularLabel": "Dataset record",
    "description": "The records of one dataset, with every field it defines.",
    "scope": "org",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 50000
    },
    "instances": true,
    "readableByMembers": true
  },
  {
    "pluginId": "email",
    "key": "email.list-members",
    "label": "List members",
    "singularLabel": "List member",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 50000
    },
    "instances": true,
    "description": "The people on one email list, with the consent each was added under."
  },
  {
    "pluginId": "email",
    "key": "email.suppressions",
    "label": "Suppressions",
    "singularLabel": "Suppression",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 50000
    },
    "description": "The addresses a site's marketing email skips, and why."
  },
  {
    "pluginId": "email",
    "key": "email.topics",
    "label": "Email topics",
    "singularLabel": "Email topic",
    "scope": "org",
    "kinds": [
      "package"
    ],
    "formats": [
      "json"
    ],
    "limits": {
      "maxRows": 200
    },
    "description": "Each topic's name, what recipients are told they get, and whether it is retired. Never who chose it."
  },
  {
    "pluginId": "events-calendar",
    "key": "events",
    "featureFlag": "eventCalendar",
    "label": "Events",
    "singularLabel": "Event",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 2000
    },
    "description": "This site’s calendar events, matched on their ID, then the title and start together."
  },
  {
    "pluginId": "marketing",
    "key": "marketing.campaigns",
    "label": "Campaigns",
    "singularLabel": "Campaign",
    "scope": "org",
    "kinds": [
      "package"
    ],
    "formats": [
      "json"
    ],
    "limits": {
      "maxRows": 500
    },
    "description": "Each campaign's name, dates, lists and its emails' copy, imported as drafts. Never what was sent or its results."
  },
  {
    "pluginId": "redirects",
    "key": "redirects",
    "featureFlag": "redirects",
    "label": "Redirects",
    "singularLabel": "Redirect",
    "scope": "host",
    "kinds": [
      "records"
    ],
    "formats": [
      "csv",
      "json",
      "ndjson"
    ],
    "limits": {
      "maxRows": 5000
    },
    "description": "This site’s redirect rules, matched on the path they redirect from."
  },
  {
    "pluginId": "workflows",
    "key": "workflows.org-automations",
    "featureFlag": "actions",
    "label": "Org automations",
    "singularLabel": "Org automation",
    "scope": "org",
    "kinds": [
      "package"
    ],
    "formats": [
      "json"
    ],
    "limits": {
      "maxRows": 100
    },
    "description": "The organization's automations — trigger, steps and sites — imported switched off."
  }
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
  {
    "pluginId": "ai",
    "name": "aiJobs",
    "label": "AI job",
    "siteField": "hostId",
    "mediaScan": "none",
    "mediaScanReason": "An AI job is the machine's record of one request: the brief, scalar inputs, the step ledger and the ids of the documents it produced. What it produced is a screen, layout, product or other document of the site, and the scan reads that document; scanning the job would report a request as using an asset the page it built uses. Jobs expire on their own (`expiresAt`, 180 days)."
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
 * Every kind of entity a besigner picker lists, declared by the plugin that
 * keeps it (AGL-3080). Core reads, browses and resolves; this says where and
 * in what words.
 */
export const PLUGIN_ENTITY_PICKERS_DECLARED: readonly ResolvedPluginEntityPicker[] = [
  {
    "pluginId": "forms",
    "kind": "forms",
    "attribute": "form-select",
    "scope": "host",
    "collection": "forms",
    "nameField": "displayName",
    "singular": "form",
    "plural": "forms",
    "page": "the Forms page"
  },
  {
    "pluginId": "commerce",
    "kind": "products",
    "attribute": "product-select",
    "scope": "host",
    "collection": "products",
    "nameField": "name",
    "searchable": true,
    "singular": "product",
    "plural": "products",
    "page": "the Products page"
  },
  {
    "pluginId": "commerce",
    "kind": "collections",
    "attribute": "collection-select",
    "scope": "host",
    "collection": "collections",
    "nameField": "name",
    "where": [
      {
        "field": "kind",
        "equals": "catalog"
      }
    ],
    "singular": "collection",
    "plural": "collections",
    "page": "the Collections page"
  },
  {
    "pluginId": "commerce",
    "kind": "categories",
    "attribute": "category-select",
    "scope": "host",
    "collection": "productCategories",
    "nameField": "name",
    "singular": "category",
    "plural": "categories",
    "page": "the Categories page"
  },
  {
    "pluginId": "data",
    "kind": "datasets",
    "attribute": "dataset-select",
    "fieldsAttribute": "dataset-field-select",
    "fieldsFrom": "dataset",
    "scope": "orgData",
    "collection": "datasets",
    "nameField": "displayName",
    "singular": "dataset",
    "plural": "datasets",
    "page": "the Data page"
  },
]

/**
 * Every public door a first-party plugin keeps a ceiling and a honeypot on,
 * with its counters and words, declared by that plugin (AGL-3080).
 */
export const PLUGIN_VISITOR_DOORS_DECLARED: readonly ResolvedVisitorDoor[] = [
  {
    "pluginId": "forms",
    "door": "form",
    "refusedCounter": "formSubmissionsRefused",
    "caughtCounter": "formSubmissionsSpam",
    "words": {
      "pausedTitle": "Form submissions are paused",
      "noun": {
        "one": "submission",
        "other": "submissions"
      },
      "staffNoun": {
        "one": "form submission",
        "other": "form submissions"
      },
      "cause": "This usually means a bot is filling in one of your forms — if it is real traffic, contact support and we will raise the limit.",
      "pausedChip": "forms paused",
      "caught": {
        "one": "bot submission",
        "other": "bot submissions"
      },
      "caughtBy": "the honeypot",
      "caughtChip": {
        "one": "bot hit",
        "other": "bot hits"
      }
    }
  },
]

/**
 * Where a person reads each record kind a first-party plugin's console page
 * shows, declared by that plugin (AGL-3080), for a server's notification link.
 */
export const PLUGIN_RECORD_PAGES_DECLARED: readonly ResolvedPluginRecordPage[] = [
  {
    "pluginId": "inbox",
    "kind": "formSubmission",
    "path": "/inbox",
    "record": {
      "path": "/inbox/submissions",
      "param": "submission"
    }
  },
]

/**
 * What each plan includes of every quota a first-party plugin owns, declared
 * by that plugin (AGL-3080). `PLAN_ENTITLEMENTS` composes these; core names
 * no key.
 */
export const PLUGIN_PLAN_QUOTAS_DECLARED: readonly ResolvedPluginPlanQuota[] = [
  {
    "pluginId": "forms",
    "key": "formSubmissionsPerMonth",
    "label": "Form subs / mo",
    "byPlan": {
      "free": 20,
      "starter": 200,
      "pro": 1000,
      "business": 5000,
      "scale": 10000,
      "advanced": 10000,
      "agency": 10000,
      "enterprise": 20000
    }
  },
  {
    "pluginId": "marketplace",
    "key": "marketplaceFeePct",
    "label": "Marketplace fee %",
    "price": true,
    "byPlan": {
      "free": 30,
      "starter": 20,
      "pro": 20,
      "business": 20,
      "scale": 20,
      "advanced": 20,
      "agency": 20,
      "enterprise": 20
    }
  },
  {
    "pluginId": "crm",
    "key": "crmEmailsPerDay",
    "label": "One-to-one emails / day",
    "byPlan": {
      "free": 0,
      "starter": 35,
      "pro": 150,
      "business": 200,
      "scale": 300,
      "advanced": 500,
      "agency": 1000,
      "enterprise": 2000
    }
  },
  {
    "pluginId": "workflows",
    "key": "workflowRunsPerMonth",
    "label": "Workflow runs / mo",
    "byPlan": {
      "free": 0,
      "starter": 500,
      "pro": 5000,
      "business": 50000,
      "scale": 150000,
      "advanced": 500000,
      "agency": 2000000,
      "enterprise": 4000000
    }
  },
  {
    "pluginId": "ai",
    "key": "assistCreditsPerMonth",
    "label": "AI credits / mo",
    "byPlan": {
      "free": 300,
      "starter": 750,
      "pro": 2750,
      "business": 7500,
      "scale": 10000,
      "advanced": 13000,
      "agency": 58000,
      "enterprise": 116000
    }
  },
]

/**
 * What each plan includes of every feature a first-party plugin owns,
 * declared by that plugin (AGL-3080).
 */
export const PLUGIN_PLAN_FEATURES_DECLARED: readonly ResolvedPluginPlanFeature[] = [
  {
    "pluginId": "commerce",
    "key": "storefrontSubscriptions",
    "label": "Storefront subscriptions",
    "byPlan": {
      "free": false,
      "starter": false,
      "pro": false,
      "business": true,
      "scale": true,
      "advanced": true,
      "agency": true,
      "enterprise": true
    }
  },
  {
    "pluginId": "commerce",
    "key": "giftCards",
    "label": "Gift cards",
    "byPlan": {
      "free": false,
      "starter": false,
      "pro": false,
      "business": true,
      "scale": true,
      "advanced": true,
      "agency": true,
      "enterprise": true
    }
  },
  {
    "pluginId": "commerce",
    "key": "commerceAnalytics",
    "label": "Commerce analytics",
    "byPlan": {
      "free": false,
      "starter": false,
      "pro": true,
      "business": true,
      "scale": true,
      "advanced": true,
      "agency": true,
      "enterprise": true
    }
  },
  {
    "pluginId": "marketplace",
    "key": "marketplaceSelling",
    "label": "Sell on the marketplace",
    "byPlan": {
      "free": false,
      "starter": false,
      "pro": true,
      "business": true,
      "scale": true,
      "advanced": true,
      "agency": true,
      "enterprise": true
    }
  },
]

/**
 * Every meter a first-party plugin contributes to the platform's cost model,
 * in breakdown order, declared by that plugin (AGL-3080). Core keeps the rates.
 */
export const PLUGIN_COST_AXES_DECLARED: readonly ResolvedPluginCostAxis[] = [
  {
    "pluginId": "forms",
    "id": "formSubmissions",
    "order": 30,
    "fields": [
      "formSubmissions"
    ],
    "rate": "perFormSubmission"
  },
  {
    "pluginId": "crm",
    "id": "contacts",
    "order": 60,
    "fields": [
      "crmRecordsCount"
    ],
    "fallbackFields": [
      "contactsCount"
    ],
    "recordedFields": [
      "companiesCount",
      "dealsCount"
    ],
    "rate": "perContactMonth"
  },
  {
    "pluginId": "ai",
    "id": "assist",
    "order": 80,
    "fields": [
      "assistCostUsd"
    ],
    "staffFields": [
      "assistCredits",
      "assistOverageUsd"
    ],
    "live": {
      "collection": "assistUsage",
      "fields": [
        "providerCostUsd",
        "estCostUsd"
      ]
    }
  },
  {
    "pluginId": "workflows",
    "id": "runs",
    "order": 90,
    "fields": [
      "workflowRuns",
      "actionRuns"
    ],
    "rate": "perRun"
  },
]

/**
 * Every band a first-party plugin contributes to the utilization table, in
 * column order, declared by that plugin (AGL-3080).
 */
export const PLUGIN_USAGE_BANDS_DECLARED: readonly ResolvedPluginUsageBand[] = [
  {
    "pluginId": "forms",
    "id": "formSubmissions",
    "label": "Form submissions",
    "order": 40,
    "fields": [
      "formSubmissions"
    ],
    "entitlement": "formSubmissionsPerMonth",
    "perHost": true,
    "hostCounter": "formSubmissions",
    "metered": {
      "rate": "perFormSubmission",
      "quotedPer": 1000,
      "noun": "form submissions",
      "withheldUntil": "release_inbox"
    }
  },
  {
    "pluginId": "crm",
    "id": "contactsCount",
    "label": "CRM records",
    "order": 70,
    "fields": [
      "crmRecordsCount"
    ],
    "fallbackFields": [
      "contactsCount"
    ],
    "entitlement": "contactsPerHost"
  },
  {
    "pluginId": "ai",
    "id": "assistCredits",
    "label": "Assist credits",
    "order": 90,
    "fields": [
      "assistCostUsd"
    ],
    "entitlement": "assistCreditsPerMonth",
    "unitCostUsd": 0.001,
    "consoleWarning": {
      "standing": "/api/ai/billing/credits",
      "member": "credits",
      "approach": "You're above 80% of your included AI assist credits.",
      "reached": {
        "stops": "You've used your included AI assist credits — AI assist stops until next month or an upgrade, and nothing is billed for it.",
        "bills": "You've used your included AI assist credits — extra credits are billed at your plan’s rate unless you set a stop under Billing → Usage."
      },
      "linksUsage": true
    }
  },
  {
    "pluginId": "workflows",
    "id": "workflowRuns",
    "label": "Workflow runs",
    "order": 100,
    "fields": [
      "workflowRuns"
    ],
    "entitlement": "workflowRunsPerMonth",
    "hostCounter": "workflowRuns",
    "orgCounter": "workflowRuns",
    "alert": {
      "label": "monthly workflow runs",
      "noun": "workflow runs",
      "outcome": "stops",
      "reached": "Workflows pause until next month and nothing is charged — upgrade in Billing to keep them running.",
      "approach": "Nothing changes and nothing is charged — at the included amount, workflows pause until next month unless you upgrade in Billing."
    }
  },
  {
    "pluginId": "workflows",
    "id": "actionRuns",
    "label": "Action runs",
    "order": 110,
    "fields": [
      "actionRuns"
    ],
    "entitlement": "actionRunsPerMonth",
    "orgCounter": "actionRuns"
  },
]

/**
 * Every line of a workspace's monthly spend a first-party plugin contributes
 * to its usage budget, in catalog order, declared by that plugin (AGL-3080).
 */
export const PLUGIN_SPEND_LINES_DECLARED: readonly ResolvedPluginSpendLine[] = [
  {
    "pluginId": "ai",
    "id": "assist",
    "label": "Assist",
    "live": {
      "collection": "assistUsage",
      "field": "estCostUsd"
    },
    "billedFromEnv": "BILL_ASSIST_TOKENS_FROM",
    "unit": {
      "costUsd": 0.001,
      "label": "Assist credits"
    }
  },
]

/**
 * Every meter a first-party plugin measures in the monthly usage sweep, in
 * catalog order, declared by that plugin (AGL-3080). The sweep refuses to bill
 * a month while one of these is unregistered.
 */
export const PLUGIN_USAGE_METERS_DECLARED: readonly ResolvedPluginUsageMeter[] = [
  {"pluginId":"crm","id":"records"},
  {"pluginId":"data","id":"dataset-storage"},
  {"pluginId":"ai","id":"assist"},
  {"pluginId":"sms","id":"sms-texts"},
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
 * The plugins whose person eraser a person erasure may not run without
 * (AGL-3080): each keeps a share of the person the erasure promises to remove.
 */
export const PLUGIN_REQUIRED_PERSON_ERASERS: readonly string[] = ["bookings","commerce","crm","email"]

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
 * The site documents a plugin authors in the besigner, declared by that
 * plugin (AGL-3080). Empty when none does, and the console's plugin-document
 * editor routes answer 404.
 */
export const PLUGIN_BESIGNER_DOCUMENTS_DECLARED: readonly ResolvedBesignerDocument[] = [
  {
    "pluginId": "forms",
    "kind": "form",
    "segment": "forms",
    "collection": "forms",
    "noun": "form",
    "publish": {
      "path": "/api/forms/promote",
      "idField": "formId"
    }
  },
]

/**
 * The plugin whose records a form's submission may also be filed as, declared
 * by that plugin (AGL-3080). `null` when none does, and no form writes one.
 */
export const PLUGIN_FORM_RECORD_TARGET_DECLARED: FormRecordTargetDeclaration | null = {
  "pluginId": "data",
  "id": "dataset"
}

/**
 * The installable artifact types a first-party plugin keeps the copies of,
 * declared by that plugin (AGL-3080). Empty when none does, and an installer
 * then refuses every listing of a type nobody keeps.
 */
export const PLUGIN_ARTIFACT_TYPES_DECLARED: readonly ArtifactTypeDeclaration[] = [
  {"pluginId":"data","type":"datasetSchema"},
]

/**
 * What a site's template library calls a template a plugin installed, by the
 * `source.type` that plugin stamps, declared by that plugin (AGL-3080).
 * Core names no installer.
 */
export const PLUGIN_TEMPLATE_SOURCES: readonly PluginTemplateSource[] = [
  {
    "pluginId": "marketplace",
    "type": "marketplace",
    "label": "Marketplace",
    "description": "Installed from the marketplace"
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
 * Every interaction step a first-party plugin offers in the interaction
 * builder, declared by that plugin (AGL-3080). Core names no plugin step.
 */
export const PLUGIN_INTERACTION_STEPS_DECLARED: readonly InteractionStepDeclaration[] = [
  {
    "pluginId": "crm",
    "type": "setContactStage",
    "label": "Set the contact’s lifecycle stage",
    "offered": false
  },
  {
    "pluginId": "crm",
    "type": "addContactTag",
    "label": "Tag the contact",
    "offered": false,
    "typedFields": [
      {
        "key": "tag",
        "names": "the tag"
      }
    ]
  },
  {
    "pluginId": "crm",
    "type": "assignContactOwner",
    "label": "Assign the contact an owner",
    "offered": false
  },
  {
    "pluginId": "crm",
    "type": "createCrmTask",
    "label": "Create a CRM task",
    "offered": false,
    "typedFields": [
      {
        "key": "title",
        "names": "the title"
      }
    ]
  },
  {
    "pluginId": "crm",
    "type": "logCrmActivity",
    "label": "Log a CRM activity",
    "offered": false,
    "typedFields": [
      {
        "key": "body",
        "names": "the text"
      }
    ]
  },
  {
    "pluginId": "data",
    "type": "datasetAppend",
    "label": "Write to a dataset",
    "offered": false,
    "typedFields": [
      {
        "key": "datasetName",
        "names": "the dataset"
      }
    ]
  },
  {
    "pluginId": "data",
    "type": "updateDataset",
    "label": "Update a dataset record",
    "offered": false,
    "typedFields": [
      {
        "key": "datasetName",
        "names": "the dataset"
      }
    ]
  },
  {
    "pluginId": "marketing",
    "type": "showOverlay",
    "label": "Open an overlay",
    "picks": {
      "collection": "overlays",
      "limit": 50,
      "idField": "overlayId",
      "nameField": "overlayName",
      "label": "Overlay",
      "missing": "pick an overlay"
    }
  },
  {
    "pluginId": "workflows",
    "type": "runWorkflow",
    "label": "Run a workflow",
    "typedFields": [
      {
        "key": "workflowName",
        "names": "the workflow"
      }
    ],
    "picks": {
      "collection": "workflows",
      "limit": 100,
      "idField": "workflowId",
      "nameField": "workflowName",
      "label": "Workflow",
      "missing": "pick a workflow"
    }
  },
  {
    "pluginId": "workflows",
    "type": "customEvent",
    "label": "Fire a custom event",
    "offered": false
  },
  {
    "pluginId": "workflows",
    "type": "webhookPost",
    "label": "Send a webhook (Business)",
    "offered": false,
    "typedFields": [
      {
        "key": "webhookName",
        "names": "the webhook"
      }
    ]
  },
  {
    "pluginId": "workflows",
    "type": "sendEmail",
    "label": "Send an email",
    "offered": false,
    "typedFields": [
      {
        "key": "subject",
        "names": "the subject"
      },
      {
        "key": "body",
        "names": "the text"
      }
    ]
  },
  {
    "pluginId": "workflows",
    "type": "notifyAdmins",
    "label": "Notify site admins",
    "offered": false,
    "typedFields": [
      {
        "key": "title",
        "names": "the title"
      },
      {
        "key": "body",
        "names": "the text"
      }
    ]
  },
  {
    "pluginId": "workflows",
    "type": "enrollList",
    "label": "Enroll in a list",
    "offered": false,
    "typedFields": [
      {
        "key": "listName",
        "names": "the list"
      }
    ]
  },
  {
    "pluginId": "workflows",
    "type": "assignCampaign",
    "label": "Assign to a campaign",
    "offered": false,
    "typedFields": [
      {
        "key": "campaignName",
        "names": "the campaign"
      }
    ]
  },
  {
    "pluginId": "workflows",
    "type": "wait",
    "label": "Wait",
    "offered": false,
    "holds": {
      "minMinutes": 1,
      "maxMinutes": 129600
    }
  },
  {
    "pluginId": "workflows",
    "type": "waitForEvent",
    "label": "Wait for something to happen",
    "offered": false,
    "holds": {
      "minMinutes": 1,
      "maxMinutes": 129600,
      "timeoutField": "_waitTimedOut"
    }
  },
  {
    "pluginId": "workflows",
    "type": "exitFlow",
    "label": "End the flow here",
    "offered": false
  },
]

/**
 * Every server step a first-party plugin runs for the automation engine,
 * declared by that plugin (AGL-3080). Core names no plugin step.
 */
export const PLUGIN_SERVER_STEPS_DECLARED: readonly ServerStepDeclaration[] = [
  {
    "pluginId": "crm",
    "type": "setContactStage"
  },
  {
    "pluginId": "crm",
    "type": "addContactTag"
  },
  {
    "pluginId": "crm",
    "type": "assignContactOwner"
  },
  {
    "pluginId": "crm",
    "type": "createCrmTask"
  },
  {
    "pluginId": "crm",
    "type": "logCrmActivity"
  },
  {
    "pluginId": "data",
    "type": "datasetAppend"
  },
  {
    "pluginId": "data",
    "type": "updateDataset"
  },
]

/**
 * Every ready-to-edit interaction a first-party plugin offers, by the id a
 * stored interaction's stamp names it with, declared by that plugin
 * (AGL-3080). Core names no recipe.
 */
export const PLUGIN_INTERACTION_RECIPES_DECLARED: readonly InteractionRecipeDeclaration[] = [
  {
    "pluginId": "crm",
    "id": "welcomeNewLead"
  },
  {
    "pluginId": "crm",
    "id": "followUpWonDeal"
  },
  {
    "pluginId": "crm",
    "id": "reengageStaleLead"
  },
  {
    "pluginId": "crm",
    "id": "tagByForm"
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
