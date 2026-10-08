/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The plugins' SUBPROCESSORS (AGL-2984): what each plugin's
 * `subprocessors` entry returned when this file was generated, written
 * down as data. The subprocessor inventory folds it in through core's
 * `foldPluginSubprocessors`, naming every plugin's recipients without
 * importing a plugin.
 * Source of truth: plugins.config.json and the entries it names.
 */

import type { PluginSubprocessorManifestEntry } from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'

export const PLUGIN_SUBPROCESSORS: readonly PluginSubprocessorManifestEntry[] = [
  {
    pluginId: 'commerce',
    subprocessors: [],
    hosts: [
      {
        host: "tools.usps.com",
        disposition: "no-request",
        reason: "USPS's public tracking page. Commerce builds a link to it from a shipment’s carrier and tracking number (`libs/plugins/commerce/src/lib/model/tracking-url.ts`) and prints it in the buyer’s shipping email and order status page; no platform server ever requests it.",
        dataReceived: "Nothing from the platform. When the buyer clicks the link, their own browser sends the carrier the tracking number in the URL; no customer record, email or order detail goes with it.",
      },
      {
        host: "www.ups.com",
        disposition: "no-request",
        reason: "UPS's public tracking page. Commerce builds a link to it from a shipment’s carrier and tracking number (`libs/plugins/commerce/src/lib/model/tracking-url.ts`) and prints it in the buyer’s shipping email and order status page; no platform server ever requests it.",
        dataReceived: "Nothing from the platform. When the buyer clicks the link, their own browser sends the carrier the tracking number in the URL; no customer record, email or order detail goes with it.",
      },
      {
        host: "www.fedex.com",
        disposition: "no-request",
        reason: "FedEx's public tracking page. Commerce builds a link to it from a shipment’s carrier and tracking number (`libs/plugins/commerce/src/lib/model/tracking-url.ts`) and prints it in the buyer’s shipping email and order status page; no platform server ever requests it.",
        dataReceived: "Nothing from the platform. When the buyer clicks the link, their own browser sends the carrier the tracking number in the URL; no customer record, email or order detail goes with it.",
      },
      {
        host: "www.dhl.com",
        disposition: "no-request",
        reason: "DHL's public tracking page. Commerce builds a link to it from a shipment’s carrier and tracking number (`libs/plugins/commerce/src/lib/model/tracking-url.ts`) and prints it in the buyer’s shipping email and order status page; no platform server ever requests it.",
        dataReceived: "Nothing from the platform. When the buyer clicks the link, their own browser sends the carrier the tracking number in the URL; no customer record, email or order detail goes with it.",
      },
      {
        host: "www.canadapost-postescanada.ca",
        disposition: "no-request",
        reason: "Canada Post's public tracking page. Commerce builds a link to it from a shipment’s carrier and tracking number (`libs/plugins/commerce/src/lib/model/tracking-url.ts`) and prints it in the buyer’s shipping email and order status page; no platform server ever requests it.",
        dataReceived: "Nothing from the platform. When the buyer clicks the link, their own browser sends the carrier the tracking number in the URL; no customer record, email or order detail goes with it.",
      },
      {
        host: "www.royalmail.com",
        disposition: "no-request",
        reason: "Royal Mail's public tracking page. Commerce builds a link to it from a shipment’s carrier and tracking number (`libs/plugins/commerce/src/lib/model/tracking-url.ts`) and prints it in the buyer’s shipping email and order status page; no platform server ever requests it.",
        dataReceived: "Nothing from the platform. When the buyer clicks the link, their own browser sends the carrier the tracking number in the URL; no customer record, email or order detail goes with it.",
      },
      {
        host: "auspost.com.au",
        disposition: "no-request",
        reason: "Australia Post's public tracking page. Commerce builds a link to it from a shipment’s carrier and tracking number (`libs/plugins/commerce/src/lib/model/tracking-url.ts`) and prints it in the buyer’s shipping email and order status page; no platform server ever requests it.",
        dataReceived: "Nothing from the platform. When the buyer clicks the link, their own browser sends the carrier the tracking number in the URL; no customer record, email or order detail goes with it.",
      },
      {
        host: "www.epson-pos.com",
        disposition: "no-request",
        reason: "The ePOS-Print XML namespace (`libs/plugins/commerce/src/lib/printing/render-epson.ts`) on the print job an Epson receipt printer receives when it polls. A namespace is an identifier that happens to look like a URL; neither the platform nor the printer requests it.",
        dataReceived: "Nothing. No request is made.",
      },
      {
        host: "app.shippingeasy.com",
        disposition: "not-a-subprocessor",
        reason: "ShippingEasy’s order API (`libs/plugins/commerce/src/lib/server/shippingeasy.ts`, AGL-3633). A site admin connects their OWN ShippingEasy account with its API key, secret and store key, and commerce sends that site’s paid orders into it and cancels canceled ones there. The customer chose and contracts with ShippingEasy; the platform sends nothing to it for a site that has not connected it.",
        dataReceived: "For a connected site only: each shippable order’s number, date, totals, ship-to and billing name, address, email and phone, and its items (name, SKU, quantity, price, weight, options), signed with the merchant’s own API key. Nothing from any other site or account.",
      },
    ],
  },
  {
    pluginId: 'outreach',
    subprocessors: [],
    hosts: [
      {
        host: "gmail.googleapis.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Gmail REST API of the rep's own Google Workspace mailbox, which the rep connects in Sequences → Mailboxes (`libs/plugins/outreach/src/lib/transport/gmail-client.ts`): the account's profile and verified send-as addresses at connect, a plain-text test the rep sends to themselves, and — for the sending runtime (AGL-2981) — the sequence messages it sends, and the reads and searches of that same mailbox that find what came back: replies, out-of-office answers, bounces and unsubscribe requests. The provider is the one the customer runs its mail on; nothing is sent to a mailbox the rep did not connect.",
        dataReceived: "The rep's own OAuth access token, and the mail the rep sends from their own mailbox — each recipient's address, the subject and the plain-text body. The runtime's searches carry the addresses of the people the rep is writing to, the rep's `+unsubscribe` address and the Message-IDs of mail it sent. What the runtime reads back is the rep's own mail: the ids of newly received messages, and whole messages — headers and plain-text or HTML bodies, delivery reports included — of the rep's sequence threads and of the replies, bounces and unsubscribe requests its searches find. No other customer record, and nothing about a site visitor.",
      },
      {
        host: "accounts.google.com",
        disposition: "no-request",
        reason: "Google's OAuth consent address, built by `buildGoogleAuthorizationUrl` in `libs/plugins/outreach/src/lib/transport/google-oauth.ts` and handed to the rep's own browser, which opens it to grant Sequences access to the rep's own mailbox. No server of ours requests it; the browser's visit is between the rep and their Google account.",
        dataReceived: "Nothing from our servers. The rep's browser carries the OAuth client id, the requested scopes, a signed state, a PKCE challenge and a login hint — the rep's own sign-in address.",
      },
      {
        host: "graph.microsoft.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. Microsoft Graph for the rep's own Microsoft 365 (Exchange Online) mailbox, which the rep connects in Sequences → Mailboxes (`libs/plugins/outreach/src/lib/transport/graph-client.ts`): the account's id, address and display name at connect, a plain-text test the rep sends, the sequence messages the sending runtime sends — each created as a draft in the rep's mailbox and sent from there — and the reads of that same mailbox that find what came back: replies, out-of-office answers, bounces and unsubscribe requests. The provider is the one the customer runs its mail on; nothing is sent to a mailbox the rep did not connect.",
        dataReceived: "The rep's own OAuth access token, and the mail the rep sends from their own mailbox — each recipient's address, the subject and the body. The runtime's reads carry a received-time window, conversation ids and the Message-IDs of mail it sent. What the runtime reads back is the rep's own mail: the ids, senders, recipients and received times of the window's messages, and whole messages — headers and bodies, delivery reports included — of the rep's sequence conversations and of the replies, bounces and unsubscribe requests among them. No other customer record, and nothing about a site visitor.",
      },
      {
        host: "login.microsoftonline.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. Microsoft's identity platform for the rep's own Microsoft 365 account (`libs/plugins/outreach/src/lib/transport/microsoft-oauth.ts`): the consent address `buildMicrosoftAuthorizationUrl` hands the rep's browser, and the token endpoint the console calls for the code exchange at connect and the access-token refresh before each Graph call — the rep's own account at the rep's own provider, the same footing as `graph.microsoft.com`.",
        dataReceived: "From the rep's browser, the app registration's client id, the requested permissions, a signed state, a PKCE challenge and a login hint. From our servers, the deployment's client credentials and, for the rep's own grant, the authorization code, PKCE verifier and the refresh token Microsoft itself issued — credentials, never message content.",
      },
    ],
    uses: [
      {
        host: "oauth2.googleapis.com",
        reason: "Since AGL-2978 also the Sequences OAuth token endpoint for a rep's own Google mailbox grant — the code exchange at connect, the access-token refresh before each Gmail call, and the revocation on disconnect, org erasure or account erasure — which is the rep's own account at the rep's own provider, the same footing as `gmail.googleapis.com`.",
        dataReceived: "For Sequences: the deployment's OAuth client credentials and, for the rep's own grant, the authorization code, PKCE verifier, refresh token and access token Google itself issued — credentials, never message content. ⚑ Legal to confirm the Annex III cell needs no change for the Sequences use.",
      },
    ],
  },
  {
    pluginId: 'accounting',
    subprocessors: [
      {
        host: "api.codat.io",
        entity: "Codat Limited",
        region: "United Kingdom",
        purpose: "Connecting a merchant’s accounting software that the Services do not connect to directly, such as QuickBooks Desktop, NetSuite, Sage, FreshBooks, Zoho Books or Wave, and posting the merchant’s sales, refunds, fees and payouts to it",
        publishedOn: "2026-10-07",
        reason: "The Codat adapter (`libs/plugins/accounting/src/lib/server/providers/codat.ts`): one Codat company per workspace, tagged with the workspace's id, made when a member starts a connect; reads of the linked ledger's company details, chart of accounts and tax rates for the mapping; and writes of the workspace's direct incomes, direct costs, transfers or journals, and one walk-in customer and one fee supplier, through Codat into the linked software. The company is deleted on disconnect or erasure. Reached only while `CODAT_API_KEY` and the accounting plugin's token key are set.",
        dataReceived: "The workspace's name and id, as its Codat company. The workspace's own sales as ledger documents: per order, its number, date, line descriptions, quantities and prices, shipping, discount, sales tax and total, with the buyer's name and email address in the document's note; per refund, its amount and the order it reverses; per sale, the platform's fee; per Stripe payout, its amount and date. In daily-summary mode, one journal of the day's totals instead of the per-order documents. The platform's own API key authenticates; Codat holds the credentials to the merchant's software. Nothing about a site visitor who did not buy, and no card data.",
      },
    ],
    hosts: [
      {
        host: "quickbooks.api.intuit.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The QuickBooks Online Accounting API of the business's own QuickBooks company, which an owner or admin connects on the Accounting page (`libs/plugins/accounting/src/lib/server/providers/quickbooks.ts`): reading its chart of accounts and tax codes for the mapping, and writing the workspace's sales receipts, refund receipts, fee expenses, payout transfers or daily journals into it.",
        dataReceived: "The workspace's own sales as ledger documents: per order, its number, date, line descriptions, quantities and prices, shipping, discount, sales tax and total, and the buyer's name and email address as the customer or contact it is filed under; per refund, its amount and the order it reverses; per sale, the platform's fee; per Stripe payout, its amount and date. In daily-summary mode, one journal of the day's totals instead of the per-order documents. Also the deployment's OAuth client credentials and the grant's own tokens. Nothing about a site visitor who did not buy, and no card data.",
      },
      {
        host: "sandbox-quickbooks.api.intuit.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The QuickBooks Online Accounting API of the business's own QuickBooks company, which an owner or admin connects on the Accounting page (`libs/plugins/accounting/src/lib/server/providers/quickbooks.ts`): reading its chart of accounts and tax codes for the mapping, and writing the workspace's sales receipts, refund receipts, fee expenses, payout transfers or daily journals into it.",
        dataReceived: "The workspace's own sales as ledger documents: per order, its number, date, line descriptions, quantities and prices, shipping, discount, sales tax and total, and the buyer's name and email address as the customer or contact it is filed under; per refund, its amount and the order it reverses; per sale, the platform's fee; per Stripe payout, its amount and date. In daily-summary mode, one journal of the day's totals instead of the per-order documents. Also the deployment's OAuth client credentials and the grant's own tokens. Nothing about a site visitor who did not buy, and no card data.",
      },
      {
        host: "oauth.platform.intuit.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. Intuit's OAuth token endpoint for the business's own QuickBooks grant: the code exchange at connect and each access-token refresh (`quickbooks.ts`).",
        dataReceived: "The deployment's OAuth client credentials, and the authorization code and refresh token Intuit itself issued — credentials, never ledger content.",
      },
      {
        host: "developer.api.intuit.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. Intuit's token revocation endpoint, called when the workspace disconnects QuickBooks or is erased (`quickbooks.ts`).",
        dataReceived: "The deployment's OAuth client credentials and the grant's refresh token, to revoke it.",
      },
      {
        host: "appcenter.intuit.com",
        disposition: "no-request",
        reason: "Intuit's consent page, built by the QuickBooks adapter's `authorizeUrl` and opened by the member's own browser to grant access to their own company. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the OAuth client id, the scope, the redirect address and a signed state.",
      },
      {
        host: "api.xero.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Xero Accounting API of the business's own Xero organization, which an owner or admin connects on the Accounting page (`libs/plugins/accounting/src/lib/server/providers/xero.ts`): listing the organizations the grant reaches, reading its chart of accounts and tax rates, and writing the workspace's invoices and payments, credit notes, fee bank transactions, payout bank transfers or daily manual journals into it; and deleting the connection on disconnect.",
        dataReceived: "The workspace's own sales as ledger documents: per order, its number, date, line descriptions, quantities and prices, shipping, discount, sales tax and total, and the buyer's name and email address as the customer or contact it is filed under; per refund, its amount and the order it reverses; per sale, the platform's fee; per Stripe payout, its amount and date. In daily-summary mode, one journal of the day's totals instead of the per-order documents. Also the deployment's OAuth client credentials and the grant's own tokens. Nothing about a site visitor who did not buy, and no card data.",
      },
      {
        host: "identity.xero.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. Xero's identity endpoints for the business's own grant: the code exchange, each refresh, and the revocation on disconnect or erasure (`xero.ts`).",
        dataReceived: "The deployment's OAuth client credentials, and the authorization code and refresh token Xero itself issued — credentials, never ledger content.",
      },
      {
        host: "login.xero.com",
        disposition: "no-request",
        reason: "Xero's consent page, built by the Xero adapter's `authorizeUrl` and opened by the member's own browser to grant access to their own organization. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the OAuth client id, the scopes, the redirect address and a signed state.",
      },
      {
        host: "link.codat.io",
        disposition: "no-request",
        reason: "Codat Link, whose address the Codat adapter's `authorizeUrl` answers and the member's own browser opens to pick their accounting software and sign in to it. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the Codat company's id and a signed state; what the member types there goes to Codat.",
      },
    ],
    uses: [
      {
        host: "api.stripe.com",
        reason: "Since AGL-3614 also the accounting sync's read of the merchant's own paid payouts (`GET /v1/payouts` on their connected account, `libs/plugins/accounting/src/lib/server/payouts.ts`), so each payout can be posted to their books as a transfer.",
        dataReceived: "The platform key and the connected account's id; Stripe answers with the account's payouts. Nothing is written.",
      },
    ],
  },
  {
    pluginId: 'ai',
    subprocessors: [
      {
        host: "api.anthropic.com",
        entity: "Anthropic, PBC",
        region: "United States",
        purpose: "AI features of the Services, including the Aglyn Assist helper: creating, editing and reviewing content, drafts and settings for a customer’s site, store and CRM, and explaining and summarizing the customer’s own setup and data",
        publishedOn: "2026-10-07",
        reason: "Reached through the AI plugin's Anthropic adapter (`libs/plugins/ai/src/lib/providers/anthropic.ts`) by the doors that call the AI runtime. `libs/plugins/ai/src/lib/server/assist-chat.ts` is gated by `release_assist` AND the key, and a generation job's text step by `release_ai_generative`; `libs/plugins/ai/src/lib/server/ai-assist.ts` carries NO release flag, so setting `ANTHROPIC_API_KEY` in production is by itself what starts this flow. `assist-anthropic-subprocessor-gate.spec.ts` holds the per-door detail and is the deeper guard for this one vendor.",
        dataReceived: "What the user submits — a question, instruction or brief, with the earlier messages of the same Assist conversation — and the content of the element, post, section or page being worked on, with the generated response. On Pro and above, the organization's name and the console route and host travel with an Assist question. For an edit the assistant proposes in the besigner, an outline of the open page, component or layout: element and component ids, layer names, shortened setting values and the selected element's styles. For a generation job, the site inventory: the names and addresses of its pages and collections, the names of its components, layouts, templates, forms and datasets with their prop and field names, and the theme's summary, colors and fonts. For a theme change, the site's current theme settings and brand colors as hex values, from the organization's brand settings, the site logo in the media library or a public page the brief links to. For features that review or write search information, the text and structure of the pages concerned. For product copy, the store's name, the product's name, type, description, tags, options and search listing, the store's category names, and the product's first media-library photo as a copy at most 768 px on its longer edge with its metadata stripped; never another media file, a price, stock, an order or a customer. For products, categories and discounts proposed from a brief, the store's name and its existing category names. For an automation drafted from a brief, which of CRM, webhooks and bookings the plan includes; for an explanation, the automation's outline (trigger, conditions, each step's text with the names of the lists, campaigns, workflows, webhooks and datasets it uses and whether each exists, and a workflow's function names and expressions) and, for a failed run, its time, steps and recorded errors, with email addresses removed and never the triggering event's data. For an insight, the figure reports available and aggregate tables: traffic with top page paths, referrers and campaign tags; form views and submissions; revenue, orders and best-selling product names; bookings by service; campaign subjects with delivery, open and click rates; A/B test and variant conversions; and, for a dataset the member can see, field names and types, record and fill counts, number ranges and totals grouped by a value at least three records share. Email addresses and phone numbers are removed, and no individual record is sent. For CRM assistance, the opened record as the CRM shows it, with all of its standard and custom fields, including contact details, notes, timeline and related records. An email draft adds the request and the record's merge field names; an import sends the field names and types and each column's header and value kind, never a row. No account identifiers or authentication tokens, and no email address outside an opened CRM record.",
      },
      {
        host: "aiplatform.googleapis.com",
        entity: "Google LLC (Google Cloud Vertex AI)",
        region: "Global — Google selects where requests are processed",
        purpose: "AI image generation: creating images for a customer's media library from a description a user writes",
        publishedOn: "2026-10-08",
        reason: "Reached through the AI plugin's Vertex AI image adapter (`libs/plugins/ai/src/lib/providers/vertex-image.ts`) by the Media library's Create with AI door (`libs/plugins/ai/src/lib/server/ai-media-image.ts`) for every kind that is not drawn as SVG, as the platform's own service account. Off unless `AI_IMAGE_VERTEX_PROJECT` names a Google Cloud project; the console offers those kinds only where `NEXT_PUBLIC_AI_IMAGE_PHOTOS` is `on`. The request carries the description and the kind's fixed style wording, the shape and fixed settings, and nothing else.",
        dataReceived: "The description the user writes and the shape requested, and the generated image returned. No account identifiers, email addresses, or other content of the customer's site.",
      },
      {
        host: "aiplatform.us.rep.googleapis.com",
        entity: "Google LLC (Google Cloud Vertex AI)",
        region: "Global — Google selects where requests are processed",
        purpose: "AI image generation: creating images for a customer's media library from a description a user writes",
        publishedOn: "2026-10-08",
        reason: "Reached through the AI plugin's Vertex AI image adapter (`libs/plugins/ai/src/lib/providers/vertex-image.ts`) by the Media library's Create with AI door (`libs/plugins/ai/src/lib/server/ai-media-image.ts`) for every kind that is not drawn as SVG, as the platform's own service account. Off unless `AI_IMAGE_VERTEX_PROJECT` names a Google Cloud project; the console offers those kinds only where `NEXT_PUBLIC_AI_IMAGE_PHOTOS` is `on`. The request carries the description and the kind's fixed style wording, the shape and fixed settings, and nothing else.",
        dataReceived: "The description the user writes and the shape requested, and the generated image returned. No account identifiers, email addresses, or other content of the customer's site.",
      },
      {
        host: "aiplatform.eu.rep.googleapis.com",
        entity: "Google LLC (Google Cloud Vertex AI)",
        region: "Global — Google selects where requests are processed",
        purpose: "AI image generation: creating images for a customer's media library from a description a user writes",
        publishedOn: "2026-10-08",
        reason: "Reached through the AI plugin's Vertex AI image adapter (`libs/plugins/ai/src/lib/providers/vertex-image.ts`) by the Media library's Create with AI door (`libs/plugins/ai/src/lib/server/ai-media-image.ts`) for every kind that is not drawn as SVG, as the platform's own service account. Off unless `AI_IMAGE_VERTEX_PROJECT` names a Google Cloud project; the console offers those kinds only where `NEXT_PUBLIC_AI_IMAGE_PHOTOS` is `on`. The request carries the description and the kind's fixed style wording, the shape and fixed settings, and nothing else.",
        dataReceived: "The description the user writes and the shape requested, and the generated image returned. No account identifiers, email addresses, or other content of the customer's site.",
      },
    ],
  },
  {
    pluginId: 'sms',
    subprocessors: [
      {
        host: "api.twilio.com",
        entity: "Twilio Inc.",
        region: "United States",
        purpose: "Delivery of text messages a site sends its own customers, such as order receipts and shipping updates",
        publishedOn: "2026-10-07",
        reason: "The Messages REST API, reached only from the SMS plugin’s Twilio adapter (`libs/plugins/sms/src/lib/twilio-provider.ts`) when a site texts a buyer an order update or a merchant re-sends a receipt by text. Inbound STOP replies arrive from Twilio on a signed webhook.",
        dataReceived: "The recipient’s phone number and the message text (the store name, order number, amounts, carrier tracking link and order status link). Twilio returns delivery status. No email address, payment detail or account credential is sent.",
      },
    ],
  },
  {
    pluginId: 'shipping',
    subprocessors: [
      {
        host: "api.goshippo.com",
        entity: "Popout, Inc. (Shippo)",
        region: "United States",
        purpose: "Shipping for merchants who sell physical goods: carrier rates, shipping labels, address validation and parcel tracking",
        publishedOn: "2026-10-07",
        reason: "The Shippo adapter (`libs/plugins/shipping/src/lib/providers/shippo.ts`), Platform Accounts: one managed account per workspace, every call the platform's token with the managed account's id. Reached from the shipping plugin's checkout quoter and its console label, address and carrier-account routes, only while `SHIPPO_API_TOKEN` and `SHIPPING_TOKEN_KEY` are set.",
        dataReceived: "For each workspace that uses carrier rates or labels: the workspace’s name and the email of the member who first used them, to open the workspace’s account at the provider; the site’s ship-from address; for a rate at checkout, the shopper’s delivery address and the parcel’s weight, size and value; for a label, the customer’s name, delivery address, phone number and email from the order, the parcel’s weight and size, and, for a parcel crossing a border, each item’s description, quantity, value, weight, tariff code and country of origin; tracking numbers to follow; and, for a carrier account the merchant connects, its account number and the account holder’s name, email, phone and billing address. No card or bank details, and no password.",
      },
      {
        host: "api.easypost.com",
        entity: "Simpler Postage, Inc. (EasyPost)",
        region: "United States",
        purpose: "Shipping for merchants who sell physical goods: carrier rates, shipping labels, address validation and parcel tracking",
        publishedOn: "2026-10-07",
        reason: "The EasyPost adapter (`libs/plugins/shipping/src/lib/providers/easypost.ts`), Child Users: one child user per workspace, acting with its own key. The alternative to Shippo, reached only while `EASYPOST_API_KEY` and `SHIPPING_TOKEN_KEY` are set and Shippo's token is not (or `SHIPPING_PROVIDER` names EasyPost).",
        dataReceived: "For each workspace that uses carrier rates or labels: the workspace’s name and the email of the member who first used them, to open the workspace’s account at the provider; the site’s ship-from address; for a rate at checkout, the shopper’s delivery address and the parcel’s weight, size and value; for a label, the customer’s name, delivery address, phone number and email from the order, the parcel’s weight and size, and, for a parcel crossing a border, each item’s description, quantity, value, weight, tariff code and country of origin; tracking numbers to follow; and, for a carrier account the merchant connects, its account number and the account holder’s name, email, phone and billing address. No card or bank details, and no password.",
      },
    ],
    hosts: [
      {
        host: "public-api.easyship.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Easyship API (2024-09) of the merchant’s own Easyship account, connected on the store’s Settings (`libs/plugins/shipping/src/lib/providers/easyship.ts`): rates and draft shipments, label purchase, cancellation, and the label file. Reached only while `SHIPPING_OWN_ACCOUNT_PROVIDERS` names `easyship`.",
        dataReceived: "For each rate and label the merchant asks for on their own account: the site’s ship-from address; the customer’s name, delivery address, phone number and email from the order; the parcel’s weight, size and value; for a parcel crossing a border, each item’s description, quantity, value, weight, tariff code and country of origin; and the order’s reference. The merchant’s own API credentials authenticate each call. No card or bank details.",
      },
      {
        host: "panel.sendcloud.sc",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Sendcloud API v3 of the merchant’s own Sendcloud integration, connected on the store’s Settings (`libs/plugins/shipping/src/lib/providers/sendcloud.ts`): shipping options with quotes, shipment announcement, cancellation, tracking and the label file. Reached only while `SHIPPING_OWN_ACCOUNT_PROVIDERS` names `sendcloud`.",
        dataReceived: "For each rate and label the merchant asks for on their own account: the site’s ship-from address; the customer’s name, delivery address, phone number and email from the order; the parcel’s weight, size and value; for a parcel crossing a border, each item’s description, quantity, value, weight, tariff code and country of origin; and the order’s reference. The merchant’s own API credentials authenticate each call. No card or bank details.",
      },
      {
        host: "api.shipperhq.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The ShipperHQ Rates API of the merchant’s own ShipperHQ website, connected on the store’s Settings (`libs/plugins/shipping/src/lib/providers/shipperhq.ts`): a token from the website’s API key and authentication code, and a shipping quote for each checkout that asks for carrier rates. Reached only while `SHIPPING_OWN_ACCOUNT_PROVIDERS` names `shipperhq`.",
        dataReceived: "For each checkout quote: the shopper’s destination country, state, city, street and postal code, and each parcel’s weight and share of the cart’s value. No name, email, phone or payment details. The merchant’s own API key and authentication code authenticate.",
      },
    ],
  },
  {
    pluginId: 'post-purchase',
    subprocessors: [],
    hosts: [
      {
        host: "api.aftership.com",
        disposition: "not-a-subprocessor",
        reason: "The AfterShip adapter (`libs/plugins/post-purchase/src/lib/providers/aftership.ts`), with the API key the merchant connected from their own AfterShip account: starts following each parcel the merchant ships. Customer-chosen: the merchant chose AfterShip and the data lands in the merchant's account.",
        dataReceived: "For each parcel: its tracking number and carrier, the order's id and number, the buyer's name, and the site's id. No address, email, phone or payment detail.",
      },
      {
        host: "api.route.com",
        disposition: "not-a-subprocessor",
        reason: "The Route adapter (`libs/plugins/post-purchase/src/lib/providers/route.ts`), with the secret token the merchant connected from their own Route account: quotes package protection at the cart and opens, updates and cancels the policy a buyer pays for. Customer-chosen: the merchant chose Route and the data lands in the merchant's account.",
        dataReceived: "For a quote: the basket's shipped items (name, SKU, quantity, price) and subtotal. For a policy: the order's id, number and date, the buyer's name, email and delivery address, the covered items, the premium paid, and each parcel's tracking number and carrier. No phone or payment detail.",
      },
      {
        host: "ws.narvar.com",
        disposition: "not-a-subprocessor",
        reason: "The Narvar adapter (`libs/plugins/post-purchase/src/lib/providers/narvar.ts`), with the account id and auth token the merchant connected from their own Narvar account: sends each order and its parcels so Narvar can run the merchant's tracking page and notifications. Customer-chosen: the merchant chose Narvar and the data lands in the merchant's account.",
        dataReceived: "For each order: its number, date, status and currency, the items (name, SKU, quantity, price), the buyer's name, email and delivery address, and each parcel's tracking number, carrier and ship date. No phone or payment detail.",
      },
    ],
  },
  {
    pluginId: 'tax-engines',
    subprocessors: [],
    hosts: [
      {
        host: "rest.avatax.com",
        disposition: "not-a-subprocessor",
        reason: "AvaTax REST v2, reached only from the tax-engines plugin’s adapter (`libs/plugins/tax-engines/src/lib/providers/avalara.ts`) with the merchant’s own credentials: a quote at checkout and the POS, a committed sale when an order is paid, a refund or void when it is refunded or canceled, and address checks. Customer-chosen: the merchant chose Avalara and the data lands in the merchant’s own AvaTax account.",
        dataReceived: "For each quote and each recorded sale: the store’s ship-from address, the buyer’s shipping address (or the store’s own for an in-person sale), the buyer’s email address as the customer code, the order id, each line’s product id or SKU, name, quantity, amount and tax code, the shipping amount, the tax charged, and an exemption type and certificate number where the merchant recorded one for the buyer. Refunds send the amount refunded. The merchant’s AvaTax account id and license key authenticate each call. No payment details are sent.",
      },
      {
        host: "sandbox-rest.avatax.com",
        disposition: "not-a-subprocessor",
        reason: "AvaTax’s sandbox environment, reached by the same adapter when the merchant’s connection names it. Customer-chosen: the merchant’s own AvaTax sandbox account.",
        dataReceived: "For each quote and each recorded sale: the store’s ship-from address, the buyer’s shipping address (or the store’s own for an in-person sale), the buyer’s email address as the customer code, the order id, each line’s product id or SKU, name, quantity, amount and tax code, the shipping amount, the tax charged, and an exemption type and certificate number where the merchant recorded one for the buyer. Refunds send the amount refunded. The merchant’s AvaTax account id and license key authenticate each call. No payment details are sent.",
      },
      {
        host: "api.taxjar.com",
        disposition: "not-a-subprocessor",
        reason: "TaxJar API v2, reached only from the tax-engines plugin’s adapter (`libs/plugins/tax-engines/src/lib/providers/taxjar.ts`) with the merchant’s own API token: a quote at checkout and the POS, an order transaction when an order is paid, a refund transaction or deletion when it is refunded or canceled, and address checks. Customer-chosen: the merchant chose TaxJar and the data lands in the merchant’s own TaxJar account.",
        dataReceived: "For each quote and each recorded sale: the store’s ship-from address, the buyer’s shipping address (or the store’s own for an in-person sale), the order id, each line’s product id or SKU, name, quantity, unit price, discount and tax code, the shipping amount, the tax charged, and an exemption type where the merchant recorded one for the buyer. Refunds send the amounts refunded. The merchant’s TaxJar API token authenticates each call. No email address or payment details are sent.",
      },
      {
        host: "api.sandbox.taxjar.com",
        disposition: "not-a-subprocessor",
        reason: "TaxJar’s sandbox environment, reached by the same adapter when the merchant’s connection names it. Customer-chosen: the merchant’s own TaxJar sandbox token.",
        dataReceived: "For each quote and each recorded sale: the store’s ship-from address, the buyer’s shipping address (or the store’s own for an in-person sale), the order id, each line’s product id or SKU, name, quantity, unit price, discount and tax code, the shipping amount, the tax charged, and an exemption type where the merchant recorded one for the buyer. Refunds send the amounts refunded. The merchant’s TaxJar API token authenticates each call. No email address or payment details are sent.",
      },
    ],
  },
  {
    pluginId: 'marketing-platforms',
    subprocessors: [],
    hosts: [
      {
        host: "api.mailchimp.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Mailchimp Marketing API of the account a site's owner or admin connects on the site's setup page, at the account's own data-center host (`{dc}.api.mailchimp.com`, named by the merchant's API key or by Mailchimp's metadata endpoint), reached only from `libs/plugins/marketing-platforms/src/lib/providers/mailchimp.ts` with the merchant's own credential, to keep an audience's members, merge fields, tags and subscription status in step with the site.",
        dataReceived: "The site's contacts: each person's email address, name, phone number when it is in E.164 form, the tags the site holds on them, their lifetime value and order count at the site, and whether the site may send them marketing (subscribed or unsubscribed); a person the site holds no usable consent for is not sent at all. Read back: the addresses whose subscription changed in the account since the last sync. Also the merchant's own API key or OAuth token, which authenticates each call.",
      },
      {
        host: "a.klaviyo.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Klaviyo account a site's owner or admin connects on the site's setup page, reached only from the marketing-platforms plugin's adapter (`libs/plugins/marketing-platforms/src/lib/providers/klaviyo.ts`) with the merchant's own credential, to keep its contacts and consent in step with the site and to deliver order events.",
        dataReceived: "The site's contacts: each person's email address, name, phone number when it is in E.164 form, the tags the site holds on them, their lifetime value and order count at the site, and whether the site may send them marketing (subscribed or unsubscribed); a person the site holds no usable consent for is not sent at all. Read back: the addresses whose subscription changed in the account since the last sync. Also the merchant's own API key or OAuth token, which authenticates each call. For a person the site may market to, the commerce events the merchant's flows run on: a started checkout (its items, value and resume link), and a paid, fulfilled, refunded or canceled order (its number, total, currency, line items with product id, SKU, name, quantity and price, and a shipment's carrier and tracking link). No payment details are sent.",
      },
      {
        host: "api.omnisend.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Omnisend account a site's owner or admin connects on the site's setup page, reached only from the marketing-platforms plugin's adapter (`libs/plugins/marketing-platforms/src/lib/providers/omnisend.ts`) with the merchant's own credential, to keep its contacts and consent in step with the site and to deliver order events.",
        dataReceived: "The site's contacts: each person's email address, name, phone number when it is in E.164 form, the tags the site holds on them, their lifetime value and order count at the site, and whether the site may send them marketing (subscribed or unsubscribed); a person the site holds no usable consent for is not sent at all. Read back: the addresses whose subscription changed in the account since the last sync. Also the merchant's own API key or OAuth token, which authenticates each call. For a person the site may market to, the commerce events the merchant's flows run on: a started checkout (its items, value and resume link), and a paid, fulfilled, refunded or canceled order (its number, total, currency, line items with product id, SKU, name, quantity and price, and a shipment's carrier and tracking link). No payment details are sent.",
      },
      {
        host: "api.attentivemobile.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Attentive account a site's owner or admin connects on the site's setup page, reached only from the marketing-platforms plugin's adapter (`libs/plugins/marketing-platforms/src/lib/providers/attentive.ts`) with the merchant's own credential, to keep its contacts and consent in step with the site and to deliver order events.",
        dataReceived: "The site's contacts: each person's email address, name, phone number when it is in E.164 form, the tags the site holds on them, their lifetime value and order count at the site, and whether the site may send them marketing (subscribed or unsubscribed); a person the site holds no usable consent for is not sent at all. Read back: the addresses whose subscription changed in the account since the last sync. Also the merchant's own API key or OAuth token, which authenticates each call. For a person the site may market to, the commerce events the merchant's flows run on: a started checkout (its items, value and resume link), and a paid, fulfilled, refunded or canceled order (its number, total, currency, line items with product id, SKU, name, quantity and price, and a shipment's carrier and tracking link). No payment details are sent.",
      },
      {
        host: "login.mailchimp.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. Mailchimp's OAuth token and metadata endpoints, for a deployment that registered the Mailchimp app: the code exchange when a merchant connects their own account, and the read of which data center it lives in (`libs/plugins/marketing-platforms/src/lib/server/oauth.ts`). Its consent page is on the same host and is opened by the merchant's browser.",
        dataReceived: "The deployment's OAuth client credentials, and the authorization code or refresh token the platform itself issued — credentials, never contacts.",
      },
      {
        host: "www.klaviyo.com",
        disposition: "no-request",
        reason: "Klaviyo's consent page, built by `authorizeUrl` in `libs/plugins/marketing-platforms/src/lib/server/oauth.ts` and opened by the merchant's own browser to connect their own account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the OAuth client id, the scopes, the redirect address and a single-use state.",
      },
      {
        host: "ui.attentivemobile.com",
        disposition: "no-request",
        reason: "Attentive's consent page, built by `authorizeUrl` in `libs/plugins/marketing-platforms/src/lib/server/oauth.ts` and opened by the merchant's own browser to connect their own account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the OAuth client id, the scopes, the redirect address and a single-use state.",
      },
    ],
  },
  {
    pluginId: 'zapier',
    subprocessors: [],
    hosts: [
      {
        host: "hooks.zapier.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The REST hook URL Zapier mints for a Zap the merchant built in their own Zapier account, subscribed with the merchant's own API key through `POST /v1/sites/{siteId}/hooks` and posted to only by the Zapier plugin's delivery (`libs/plugins/zapier/src/lib/server/deliver.ts`), until the Zap is turned off, the key is revoked or Zapier answers 410.",
        dataReceived: "Only the events the merchant's Zap subscribed to, each held to the scope its key holds: an order as the REST API publishes it (number, status, totals, line items, the buyer's name, email and shipping address, shipments and refunds), a booking (service, time, the guest's name, email, phone and address when asked, what was paid), a new contact (id, email, name, source, lifecycle stage), or a form submission (the form, the page and every submitted field). No payment details, API keys or passwords are sent.",
      },
    ],
  },
  {
    pluginId: 'fulfillment-networks',
    subprocessors: [],
    hosts: [
      {
        host: "api.shipbob.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The ShipBob API of the account a site's admin connects in the store's settings, reached only from `libs/plugins/fulfillment-networks/src/lib/providers/shipbob.ts` with the merchant's own grant, to send the orders the merchant routes to it and read their shipments and stock back.",
        dataReceived: "For each paid order the merchant's store sends to the network: the order's number and date, the shipping address (name, street, city, state, postal code, country, and the phone number and email address when the order has them), and the items the network ships (SKU, name, quantity and unit price). Read back: the network's order and shipment records for those orders (status, carrier, tracking number and link, which items each parcel held) and its count of each SKU it holds. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent.",
      },
      {
        host: "sandbox-api.shipbob.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The ShipBob sandbox API of the account a site's admin connects in the store's settings, reached only from `libs/plugins/fulfillment-networks/src/lib/providers/shipbob.ts` with the merchant's own grant, to send the orders the merchant routes to it and read their shipments and stock back. Used only by a deployment pointed at the sandbox, where nothing real ships.",
        dataReceived: "For each paid order the merchant's store sends to the network: the order's number and date, the shipping address (name, street, city, state, postal code, country, and the phone number and email address when the order has them), and the items the network ships (SKU, name, quantity and unit price). Read back: the network's order and shipment records for those orders (status, carrier, tracking number and link, which items each parcel held) and its count of each SKU it holds. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent.",
      },
      {
        host: "auth.shipbob.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. ShipBob's OAuth token endpoint, for a deployment that registered the ShipBob app: the code exchange when a merchant connects their own account, and each refresh (`libs/plugins/fulfillment-networks/src/lib/server/oauth.ts`). Its consent page is on the same host and is opened by the merchant's browser.",
        dataReceived: "The deployment's OAuth client credentials, and the authorization code or refresh token the network itself issued — credentials, never orders.",
      },
      {
        host: "authstage.shipbob.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. ShipBob sandbox's OAuth token endpoint, for a deployment that registered the ShipBob sandbox app: the code exchange when a merchant connects their own account, and each refresh (`libs/plugins/fulfillment-networks/src/lib/server/oauth.ts`). Its consent page is on the same host and is opened by the merchant's browser.",
        dataReceived: "The deployment's OAuth client credentials, and the authorization code or refresh token the network itself issued — credentials, never orders.",
      },
      {
        host: "sellingpartnerapi-na.amazon.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Amazon Selling Partner (North America) API of the account a site's admin connects in the store's settings, reached only from `libs/plugins/fulfillment-networks/src/lib/providers/amazon-mcf.ts` with the merchant's own grant, to send the orders the merchant routes to it and read their shipments and stock back.",
        dataReceived: "For each paid order the merchant's store sends to the network: the order's number and date, the shipping address (name, street, city, state, postal code, country, and the phone number and email address when the order has them), and the items the network ships (SKU, name, quantity and unit price). Read back: the network's order and shipment records for those orders (status, carrier, tracking number and link, which items each parcel held) and its count of each SKU it holds. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent.",
      },
      {
        host: "sellingpartnerapi-eu.amazon.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Amazon Selling Partner (Europe) API of the account a site's admin connects in the store's settings, reached only from `libs/plugins/fulfillment-networks/src/lib/providers/amazon-mcf.ts` with the merchant's own grant, to send the orders the merchant routes to it and read their shipments and stock back.",
        dataReceived: "For each paid order the merchant's store sends to the network: the order's number and date, the shipping address (name, street, city, state, postal code, country, and the phone number and email address when the order has them), and the items the network ships (SKU, name, quantity and unit price). Read back: the network's order and shipment records for those orders (status, carrier, tracking number and link, which items each parcel held) and its count of each SKU it holds. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent.",
      },
      {
        host: "sellingpartnerapi-fe.amazon.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Amazon Selling Partner (Far East) API of the account a site's admin connects in the store's settings, reached only from `libs/plugins/fulfillment-networks/src/lib/providers/amazon-mcf.ts` with the merchant's own grant, to send the orders the merchant routes to it and read their shipments and stock back.",
        dataReceived: "For each paid order the merchant's store sends to the network: the order's number and date, the shipping address (name, street, city, state, postal code, country, and the phone number and email address when the order has them), and the items the network ships (SKU, name, quantity and unit price). Read back: the network's order and shipment records for those orders (status, carrier, tracking number and link, which items each parcel held) and its count of each SKU it holds. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent.",
      },
      {
        host: "sandbox.sellingpartnerapi-na.amazon.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Amazon Selling Partner (North America) sandbox API of the account a site's admin connects in the store's settings, reached only from `libs/plugins/fulfillment-networks/src/lib/providers/amazon-mcf.ts` with the merchant's own grant, to send the orders the merchant routes to it and read their shipments and stock back. Used only by a deployment pointed at the sandbox, where nothing real ships.",
        dataReceived: "For each paid order the merchant's store sends to the network: the order's number and date, the shipping address (name, street, city, state, postal code, country, and the phone number and email address when the order has them), and the items the network ships (SKU, name, quantity and unit price). Read back: the network's order and shipment records for those orders (status, carrier, tracking number and link, which items each parcel held) and its count of each SKU it holds. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent.",
      },
      {
        host: "sandbox.sellingpartnerapi-eu.amazon.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Amazon Selling Partner (Europe) sandbox API of the account a site's admin connects in the store's settings, reached only from `libs/plugins/fulfillment-networks/src/lib/providers/amazon-mcf.ts` with the merchant's own grant, to send the orders the merchant routes to it and read their shipments and stock back. Used only by a deployment pointed at the sandbox, where nothing real ships.",
        dataReceived: "For each paid order the merchant's store sends to the network: the order's number and date, the shipping address (name, street, city, state, postal code, country, and the phone number and email address when the order has them), and the items the network ships (SKU, name, quantity and unit price). Read back: the network's order and shipment records for those orders (status, carrier, tracking number and link, which items each parcel held) and its count of each SKU it holds. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent.",
      },
      {
        host: "sandbox.sellingpartnerapi-fe.amazon.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Amazon Selling Partner (Far East) sandbox API of the account a site's admin connects in the store's settings, reached only from `libs/plugins/fulfillment-networks/src/lib/providers/amazon-mcf.ts` with the merchant's own grant, to send the orders the merchant routes to it and read their shipments and stock back. Used only by a deployment pointed at the sandbox, where nothing real ships.",
        dataReceived: "For each paid order the merchant's store sends to the network: the order's number and date, the shipping address (name, street, city, state, postal code, country, and the phone number and email address when the order has them), and the items the network ships (SKU, name, quantity and unit price). Read back: the network's order and shipment records for those orders (status, carrier, tracking number and link, which items each parcel held) and its count of each SKU it holds. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent.",
      },
      {
        host: "api.amazon.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. Login with Amazon's OAuth token endpoint, for a deployment that registered the Login with Amazon app: the code exchange when a merchant connects their own account, and each refresh (`libs/plugins/fulfillment-networks/src/lib/server/oauth.ts`).",
        dataReceived: "The deployment's OAuth client credentials, and the authorization code or refresh token the network itself issued — credentials, never orders.",
      },
      {
        host: "sellercentral.amazon.com",
        disposition: "no-request",
        reason: "Amazon Seller Central's app consent page, built by `networkAuthorizeUrl` in `libs/plugins/fulfillment-networks/src/lib/server/oauth.ts` and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.",
      },
      {
        host: "sellercentral-europe.amazon.com",
        disposition: "no-request",
        reason: "Amazon Seller Central's app consent page, built by `networkAuthorizeUrl` in `libs/plugins/fulfillment-networks/src/lib/server/oauth.ts` and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.",
      },
      {
        host: "sellercentral.amazon.co.jp",
        disposition: "no-request",
        reason: "Amazon Seller Central's app consent page, built by `networkAuthorizeUrl` in `libs/plugins/fulfillment-networks/src/lib/server/oauth.ts` and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.",
      },
    ],
  },
  {
    pluginId: 'marketplaces',
    subprocessors: [],
    hosts: [
      {
        host: "auth.ebay.com",
        disposition: "no-request",
        reason: "eBay's app consent page, built by the authorize address in `libs/plugins/marketplaces/src/lib/providers/ebay.ts` and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.",
      },
      {
        host: "auth.sandbox.ebay.com",
        disposition: "no-request",
        reason: "eBay sandbox's app consent page, built by the authorize address in `libs/plugins/marketplaces/src/lib/providers/ebay.ts` and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.",
      },
      {
        host: "api.ebay.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The eBay API of the seller account a site's admin connects in the store's settings, reached only from `libs/plugins/marketplaces/src/lib/providers/ebay.ts` with the merchant's own grant, to keep its listings in step with the store and bring its orders in.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "api.sandbox.ebay.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The eBay sandbox API of the seller account a site's admin connects in the store's settings, reached only from `libs/plugins/marketplaces/src/lib/providers/ebay.ts` with the merchant's own grant, to keep its listings in step with the store and bring its orders in. Used only by a deployment pointed at the sandbox, where nothing real sells.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "apiz.ebay.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The eBay identity API of the seller account a site's admin connects in the store's settings, reached only from `libs/plugins/marketplaces/src/lib/providers/ebay.ts` with the merchant's own grant, to keep its listings in step with the store and bring its orders in.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "apiz.sandbox.ebay.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The eBay identity sandbox API of the seller account a site's admin connects in the store's settings, reached only from `libs/plugins/marketplaces/src/lib/providers/ebay.ts` with the merchant's own grant, to keep its listings in step with the store and bring its orders in. Used only by a deployment pointed at the sandbox, where nothing real sells.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "www.etsy.com",
        disposition: "no-request",
        reason: "Etsy's app consent page, built by the authorize address in `libs/plugins/marketplaces/src/lib/providers/etsy.ts` and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.",
      },
      {
        host: "api.etsy.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Etsy API of the seller account a site's admin connects in the store's settings, reached only from `libs/plugins/marketplaces/src/lib/providers/etsy.ts` with the merchant's own grant, to keep its listings in step with the store and bring its orders in.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "services.us.tiktokshop.com",
        disposition: "no-request",
        reason: "TikTok Shop (US)'s app consent page, built by the authorize address in `libs/plugins/marketplaces/src/lib/providers/tiktok.ts` and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.",
      },
      {
        host: "services.tiktokshop.com",
        disposition: "no-request",
        reason: "TikTok Shop's app consent page, built by the authorize address in `libs/plugins/marketplaces/src/lib/providers/tiktok.ts` and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.",
      },
      {
        host: "auth.tiktok-shops.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. TikTok Shop's OAuth token endpoint, for a deployment that registered a TikTok Shop app: the code exchange when a merchant connects their own account, and each refresh (`libs/plugins/marketplaces/src/lib/providers/tiktok.ts`).",
        dataReceived: "The deployment's OAuth client credentials, and the authorization code or refresh token the marketplace itself issued — credentials, never orders or listings.",
      },
      {
        host: "open-api.tiktokglobalshop.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The TikTok Shop API of the seller account a site's admin connects in the store's settings, reached only from `libs/plugins/marketplaces/src/lib/providers/tiktok.ts` with the merchant's own grant, to keep its listings in step with the store and bring its orders in.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "login.account.wal-mart.com",
        disposition: "no-request",
        reason: "Walmart's app consent page, built by the authorize address in `libs/plugins/marketplaces/src/lib/providers/walmart.ts` and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.",
      },
      {
        host: "marketplace.walmartapis.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Walmart Marketplace API of the seller account a site's admin connects in the store's settings, reached only from `libs/plugins/marketplaces/src/lib/providers/walmart.ts` with the merchant's own grant, to keep its listings in step with the store and bring its orders in.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "sandbox.walmartapis.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Walmart Marketplace sandbox API of the seller account a site's admin connects in the store's settings, reached only from `libs/plugins/marketplaces/src/lib/providers/walmart.ts` with the merchant's own grant, to keep its listings in step with the store and bring its orders in. Used only by a deployment pointed at the sandbox, where nothing real sells.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "faire.com",
        disposition: "no-request",
        reason: "Faire's app consent page, built by the authorize address in `libs/plugins/marketplaces/src/lib/providers/faire.ts` and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.",
      },
      {
        host: "www.faire.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Faire API of the seller account a site's admin connects in the store's settings, reached only from `libs/plugins/marketplaces/src/lib/providers/faire.ts` with the merchant's own grant, to keep its listings in step with the store and bring its orders in.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
    ],
    uses: [
      {
        host: "sellingpartnerapi-na.amazon.com",
        reason: "Also the marketplaces plugin (`libs/plugins/marketplaces/src/lib/providers/amazon.ts`): the Listings Items, Orders, Sellers and Finances APIs of the seller account a site's admin connects, with the merchant's own grant, to keep its listings' quantity and price in step with the store, bring its orders in, confirm their shipments and read the fees Amazon charged.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "sandbox.sellingpartnerapi-na.amazon.com",
        reason: "Also the marketplaces plugin (`libs/plugins/marketplaces/src/lib/providers/amazon.ts`): the Listings Items, Orders, Sellers and Finances APIs of the seller account a site's admin connects, with the merchant's own grant, to keep its listings' quantity and price in step with the store, bring its orders in, confirm their shipments and read the fees Amazon charged.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "sellingpartnerapi-eu.amazon.com",
        reason: "Also the marketplaces plugin (`libs/plugins/marketplaces/src/lib/providers/amazon.ts`): the Listings Items, Orders, Sellers and Finances APIs of the seller account a site's admin connects, with the merchant's own grant, to keep its listings' quantity and price in step with the store, bring its orders in, confirm their shipments and read the fees Amazon charged.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "sandbox.sellingpartnerapi-eu.amazon.com",
        reason: "Also the marketplaces plugin (`libs/plugins/marketplaces/src/lib/providers/amazon.ts`): the Listings Items, Orders, Sellers and Finances APIs of the seller account a site's admin connects, with the merchant's own grant, to keep its listings' quantity and price in step with the store, bring its orders in, confirm their shipments and read the fees Amazon charged.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "sellingpartnerapi-fe.amazon.com",
        reason: "Also the marketplaces plugin (`libs/plugins/marketplaces/src/lib/providers/amazon.ts`): the Listings Items, Orders, Sellers and Finances APIs of the seller account a site's admin connects, with the merchant's own grant, to keep its listings' quantity and price in step with the store, bring its orders in, confirm their shipments and read the fees Amazon charged.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "sandbox.sellingpartnerapi-fe.amazon.com",
        reason: "Also the marketplaces plugin (`libs/plugins/marketplaces/src/lib/providers/amazon.ts`): the Listings Items, Orders, Sellers and Finances APIs of the seller account a site's admin connects, with the merchant's own grant, to keep its listings' quantity and price in step with the store, bring its orders in, confirm their shipments and read the fees Amazon charged.",
        dataReceived: "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent.",
      },
      {
        host: "api.amazon.com",
        reason: "Also the marketplaces plugin (`libs/plugins/marketplaces/src/lib/providers/amazon.ts`): the code exchange when a merchant connects their seller account for listings and orders, and each refresh.",
        dataReceived: "The deployment's OAuth client credentials, and the authorization code or refresh token the marketplace itself issued — credentials, never orders or listings.",
      },
      {
        host: "sellercentral.amazon.com",
        reason: "Also the marketplaces plugin (`libs/plugins/marketplaces/src/lib/providers/amazon.ts`): the consent page a merchant's browser opens to connect their seller account for listings and orders. No server of ours requests it.",
        dataReceived: "Nothing from our servers.",
      },
      {
        host: "sellercentral-europe.amazon.com",
        reason: "Also the marketplaces plugin (`libs/plugins/marketplaces/src/lib/providers/amazon.ts`): the consent page a merchant's browser opens to connect their seller account for listings and orders. No server of ours requests it.",
        dataReceived: "Nothing from our servers.",
      },
      {
        host: "sellercentral.amazon.co.jp",
        reason: "Also the marketplaces plugin (`libs/plugins/marketplaces/src/lib/providers/amazon.ts`): the consent page a merchant's browser opens to connect their seller account for listings and orders. No server of ours requests it.",
        dataReceived: "Nothing from our servers.",
      },
    ],
  },
  {
    pluginId: 'print-on-demand',
    subprocessors: [],
    hosts: [
      {
        host: "api.printful.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Printful API of the merchant’s own Printful store, connected with a private token the merchant made (`libs/plugins/print-on-demand/src/lib/providers/printful.ts`): listing and reading the store’s products and their catalog costs for import, sending, confirming, reading and canceling the merchant’s orders, and setting the store’s notice address.",
        dataReceived: "For each paid order whose products the merchant imported from the service: the buyer’s name, shipping address, phone number and email address as the recipient, the order number, and each line’s service variant, quantity and the price the buyer paid. A test-mode order is sent as a draft that is never confirmed. Cancellations and reads of the orders sent. The merchant’s own token authenticates each call. No card or payment details are sent. When the notice address is set: the console’s webhook address, carrying the connection’s secret.",
      },
      {
        host: "api.printify.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Printify API of the merchant’s own Printify shop, connected with a personal access token the merchant made (`libs/plugins/print-on-demand/src/lib/providers/printify.ts`): listing and reading the shop’s products for import, sending, sending to production, reading and canceling the merchant’s orders, and registering the shop’s webhooks.",
        dataReceived: "For each paid order whose products the merchant imported from the service: the buyer’s name, shipping address, phone number and email address as the recipient, the order number, and each line’s service variant, quantity and the price the buyer paid. A test-mode order is sent as a draft that is never confirmed. Cancellations and reads of the orders sent. The merchant’s own token authenticates each call. No card or payment details are sent. When webhooks are registered: the console’s webhook address and the connection’s signing secret.",
      },
      {
        host: "files.cdn.printful.com",
        disposition: "not-a-subprocessor",
        reason: "The service’s own image host. When a member imports a product, its photos are fetched from here once and copied into the site’s media library (`libs/plugins/print-on-demand/src/lib/server/media.ts`), because a published page loads images only from the site’s own addresses.",
        dataReceived: "Nothing but a plain GET of the photo’s address the service itself gave: no customer data, no personal data and no credential.",
      },
      {
        host: "images-api.printify.com",
        disposition: "not-a-subprocessor",
        reason: "The service’s own image host. When a member imports a product, its photos are fetched from here once and copied into the site’s media library (`libs/plugins/print-on-demand/src/lib/server/media.ts`), because a published page loads images only from the site’s own addresses.",
        dataReceived: "Nothing but a plain GET of the photo’s address the service itself gave: no customer data, no personal data and no credential.",
      },
      {
        host: "developers.printful.com",
        disposition: "no-request",
        reason: "A help link on the Print on demand card, to the page where a merchant makes the token they paste. Opened by the member’s own browser; no server of ours requests it.",
        dataReceived: "Nothing from our servers.",
      },
      {
        host: "printify.com",
        disposition: "no-request",
        reason: "A help link on the Print on demand card, to the page where a merchant makes the token they paste. Opened by the member’s own browser; no server of ours requests it.",
        dataReceived: "Nothing from our servers.",
      },
    ],
  },
  {
    pluginId: 'inventory-sync',
    subprocessors: [],
    hosts: [
      {
        host: "inventory.dearsystems.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Cin7 Core (formerly DEAR Inventory) API of the merchant's own Cin7 Core account, reached with the Account ID and application key the merchant made there and pasted into the store's settings (`libs/plugins/inventory-sync/src/lib/providers/cin7-core.ts`), to read its stock and products and to record the merchant's paid orders, count adjustments and products in it.",
        dataReceived: "For each paid order the store sends to the system: its number and our reference, its date, the buyer's name and email address, the shipping address (name, street, city, state, postal code, country and phone), its items (SKU, name, quantity and unit price), shipping, discount, tax and total, under the customer the merchant chose. For stock kept in step from the store: each SKU's count adjustment at the merchant's chosen location. For products made in the system from the store: SKU, name, description, price, weight and barcode. Read back: the system's products (id, SKU, name, description, price, weight, barcode, status), its count of each SKU, its locations and customers, and the orders it recorded under our references. Also the merchant's own API key or access token, which authenticates each call. No payment details are sent.",
      },
      {
        host: "cloudapi.inflowinventory.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The inFlow Cloud API of the merchant's own inFlow Inventory account, reached with the company id and API key the merchant made there and pasted into the store's settings (`libs/plugins/inventory-sync/src/lib/providers/inflow.ts`), to read its stock and products and to record the merchant's paid orders, count adjustments and products in it.",
        dataReceived: "For each paid order the store sends to the system: its number and our reference, its date, the buyer's name and email address, the shipping address (name, street, city, state, postal code, country and phone), its items (SKU, name, quantity and unit price), shipping, discount, tax and total, under the customer the merchant chose. For stock kept in step from the store: each SKU's count adjustment at the merchant's chosen location. For products made in the system from the store: SKU, name, description, price, weight and barcode. Read back: the system's products (id, SKU, name, description, price, weight, barcode, status), its count of each SKU, its locations and customers, and the orders it recorded under our references. Also the merchant's own API key or access token, which authenticates each call. No payment details are sent.",
      },
      {
        host: "oauth.brightpearlapp.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. Brightpearl's OAuth host, for a deployment that registered a Brightpearl app: its consent page, which the merchant's own browser opens to grant access to their own Brightpearl account, and its token endpoint, for the code exchange and each refresh (`libs/plugins/inventory-sync/src/lib/server/oauth.ts`). The grant names the account's own datacenter (a `brightpearl.com` or `brightpearlconnect.com` host), where every API call of `libs/plugins/inventory-sync/src/lib/providers/brightpearl.ts` then goes, with the same data as Cin7 Core and inFlow receive.",
        dataReceived: "At this host: the deployment's app reference (and client secret, for an app with confidential OAuth), the merchant's account code, and the authorization code or refresh token Brightpearl itself issued — credentials, never orders. At the account's datacenter: For each paid order the store sends to the system: its number and our reference, its date, the buyer's name and email address, the shipping address (name, street, city, state, postal code, country and phone), its items (SKU, name, quantity and unit price), shipping, discount, tax and total, under the customer the merchant chose. For stock kept in step from the store: each SKU's count adjustment at the merchant's chosen location. For products made in the system from the store: SKU, name, description, price, weight and barcode. Read back: the system's products (id, SKU, name, description, price, weight, barcode, status), its count of each SKU, its locations and customers, and the orders it recorded under our references. Also the merchant's own API key or access token, which authenticates each call. No payment details are sent.",
      },
    ],
  },
  {
    pluginId: 'delivery-apps',
    subprocessors: [],
    hosts: [
      {
        host: "openapi.doordash.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The DoorDash API for the merchant's own DoorDash store, which a site's admin links by its store id in the store's settings, reached only from `libs/plugins/delivery-apps/src/lib/providers/doordash.ts` to answer that store's orders and send its menu.",
        dataReceived: "For an order the service sent a store connected here: the service's own order id and store id, the answer (accepted with the minutes the kitchen needs, rejected with the merchant's reason, or ready for pickup), and the number of the store order it became. For the menu, when the merchant sends it: each product's name, choices, description, price, photo address and whether it is in stock. No buyer's details are sent: the buyer's name, phone and the order's items come FROM the service, in its webhook or when its order is read. Each call is signed with the deployment's partner credentials.",
      },
      {
        host: "api.uber.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Uber Eats API for the merchant's own Uber Eats store, which a site's admin links by its store id in the store's settings, reached only from `libs/plugins/delivery-apps/src/lib/providers/uber-eats.ts` to answer that store's orders and send its menu.",
        dataReceived: "For an order the service sent a store connected here: the service's own order id and store id, the answer (accepted with the minutes the kitchen needs, rejected with the merchant's reason, or ready for pickup), and the number of the store order it became. For the menu, when the merchant sends it: each product's name, choices, description, price, photo address and whether it is in stock. No buyer's details are sent: the buyer's name, phone and the order's items come FROM the service, in its webhook or when its order is read. Each call is signed with the deployment's partner credentials.",
      },
      {
        host: "auth.uber.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. Uber's OAuth token endpoint, for the client-credentials token each Uber Eats call carries (`libs/plugins/delivery-apps/src/lib/providers/uber-eats.ts`).",
        dataReceived: "The deployment's Uber client id and secret and the scopes asked for — credentials, never orders or menus.",
      },
      {
        host: "api-third-party-gtm.grubhub.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Grubhub API for the merchant's own Grubhub store, which a site's admin links by its store id in the store's settings, reached only from `libs/plugins/delivery-apps/src/lib/providers/grubhub.ts` to answer that store's orders and send its menu.",
        dataReceived: "For an order the service sent a store connected here: the service's own order id and store id, the answer (accepted with the minutes the kitchen needs, rejected with the merchant's reason, or ready for pickup), and the number of the store order it became. For the menu, when the merchant sends it: each product's name, choices, description, price, photo address and whether it is in stock. No buyer's details are sent: the buyer's name, phone and the order's items come FROM the service, in its webhook or when its order is read. Each call is signed with the deployment's partner credentials.",
      },
      {
        host: "api-third-party-gtm-pp.grubhub.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Grubhub API for the merchant's own Grubhub store, which a site's admin links by its store id in the store's settings, reached only from `libs/plugins/delivery-apps/src/lib/providers/grubhub.ts` to answer that store's orders and send its menu. Its pre-production host, used only by a deployment set to the sandbox, where nothing real sells.",
        dataReceived: "For an order the service sent a store connected here: the service's own order id and store id, the answer (accepted with the minutes the kitchen needs, rejected with the merchant's reason, or ready for pickup), and the number of the store order it became. For the menu, when the merchant sends it: each product's name, choices, description, price, photo address and whether it is in stock. No buyer's details are sent: the buyer's name, phone and the order's items come FROM the service, in its webhook or when its order is read. Each call is signed with the deployment's partner credentials.",
      },
    ],
  },
  {
    pluginId: 'sales-channels',
    subprocessors: [],
    hosts: [
      {
        host: "merchantapi.googleapis.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Merchant API of the merchant's own Google Merchant Center account, which a site admin connects on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/server/connect/google-merchant.ts`): listing the Merchant Center accounts the grant reaches, creating one API data source in the chosen account, and inserting and deleting the store's product inputs in it when a member syncs.",
        dataReceived: "The store's own listed products as the channel's feed states them: per product configuration, its id, title, description, page link, photo links, price and sale price, availability, stock quantity (Meta), condition, brand, GTIN, MPN, categories, variant group, color, size, weight and packed size, and the store's shipping price per country. Also the deployment's OAuth client credentials and the grant's own tokens. No order, no buyer and nothing about a site visitor.",
      },
      {
        host: "graph.facebook.com",
        disposition: "not-a-subprocessor",
        reason: "Customer-chosen destination. The Graph API of the merchant's own Meta business, which a site admin connects on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/server/connect/meta-catalog.ts`): the code exchange and long-lived token exchange at connect, listing the businesses and product catalogs the grant reaches, writing the store's products into the chosen catalog through its `items_batch` edge when a member syncs, and revoking the app's permissions on disconnect.",
        dataReceived: "The store's own listed products as the channel's feed states them: per product configuration, its id, title, description, page link, photo links, price and sale price, availability, stock quantity (Meta), condition, brand, GTIN, MPN, categories, variant group, color, size, weight and packed size, and the store's shipping price per country. Also the deployment's OAuth client credentials and the grant's own tokens. No order, no buyer and nothing about a site visitor.",
      },
      {
        host: "merchants.google.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
      {
        host: "support.google.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
      {
        host: "business.facebook.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
      {
        host: "developers.facebook.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
      {
        host: "ads.tiktok.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
      {
        host: "www.pinterest.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
      {
        host: "help.pinterest.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
      {
        host: "ads.snapchat.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
      {
        host: "developers.snap.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
      {
        host: "ads.microsoft.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
      {
        host: "help.ads.microsoft.com",
        disposition: "no-request",
        reason: "A link on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/model/channels.ts`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.",
        dataReceived: "Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.",
      },
    ],
    uses: [
      {
        host: "oauth2.googleapis.com",
        reason: "Since AGL-3637 also the Sales channels OAuth token endpoint for a merchant's own Merchant Center grant — the code exchange at connect, the access-token refresh before each sync, and the revocation on disconnect (`google-merchant.ts`) — the merchant's own account at the merchant's own provider, the same footing as `merchantapi.googleapis.com`.",
        dataReceived: "For Sales channels: the deployment's OAuth client credentials and, for the merchant's own grant, the authorization code, refresh token and access token Google itself issued — credentials, never product data.",
      },
      {
        host: "www.facebook.com",
        reason: "Since AGL-3637 also Facebook Login's consent dialog for a merchant's catalog grant, built by `metaAuthorizeUrl` and opened by the admin's own browser. No server of ours requests it.",
        dataReceived: "Nothing from our servers. The browser carries the app id, the `catalog_management` and `business_management` scopes, the redirect address and a signed state.",
      },
    ],
  },
]
