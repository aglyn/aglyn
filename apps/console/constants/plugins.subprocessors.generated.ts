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
    subprocessors: [],
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
        purpose: "AI-assisted features in the console and the site editor: the Aglyn Assist helper, including changes it proposes to a page, component, or layout open in the editor; editor assistance (rewriting element copy, drafting blog bodies, generating a section layout); and AI generation, which creates drafts and proposals for a customer's site from a brief or from what the site already holds, such as copy, layouts, templates, automations, search titles and descriptions, theme changes, product descriptions and tags, draft products, and store categories and discounts; explanations of a site's automations, including why an automation's run failed; AI insights, which answer a customer's questions about its own figures, such as site traffic, sales, bookings, forms, campaigns, A/B tests and datasets, and write a weekly summary of them for members who ask for one; and AI assistance in the CRM, which summarizes a contact, company, deal or lead for a user and suggests a next step, drafts a one-to-one email for the user to review and send, and suggests how the columns of a spreadsheet the user imports match CRM fields",
        publishedOn: "2026-10-05",
        reason: "Reached through the AI plugin's Anthropic adapter (`libs/plugins/ai/src/lib/providers/anthropic.ts`) by the doors that call the AI runtime. `libs/plugins/ai/src/lib/server/assist-chat.ts` is gated by `release_assist` AND the key, and a generation job's text step by `release_ai_generative`; `libs/plugins/ai/src/lib/server/ai-assist.ts` carries NO release flag, so setting `ANTHROPIC_API_KEY` in production is by itself what starts this flow. `assist-anthropic-subprocessor-gate.spec.ts` holds the per-door detail and is the deeper guard for this one vendor.",
        dataReceived: "What the user submits — a question, instruction or brief, with the earlier messages of the same Assist conversation — and the content of the element, post, section or page being worked on, with the generated response. On Pro and above, the organization's name and the console route and host travel with an Assist question. For an edit the assistant proposes in the besigner, an outline of the open page, component or layout: element and component ids, layer names, shortened setting values and the selected element's styles. For a generation job, the site inventory: the names and addresses of its pages and collections, the names of its components, layouts, templates, forms and datasets with their prop and field names, and the theme's summary, colors and fonts. For a theme change, the site's current theme settings and brand colors as hex values, from the organization's brand settings, the site logo in the media library or a public page the brief links to. For features that review or write search information, the text and structure of the pages concerned. For product copy, the store's name, the product's name, type, description, tags, options and search listing, the store's category names, and the product's first media-library photo as a copy at most 768 px on its longer edge with its metadata stripped; never another media file, a price, stock, an order or a customer. For products, categories and discounts proposed from a brief, the store's name and its existing category names. For an automation drafted from a brief, which of CRM, webhooks and bookings the plan includes; for an explanation, the automation's outline (trigger, conditions, each step's text with the names of the lists, campaigns, workflows, webhooks and datasets it uses and whether each exists, and a workflow's function names and expressions) and, for a failed run, its time, steps and recorded errors, with email addresses removed and never the triggering event's data. For an insight, the figure reports available and aggregate tables: traffic with top page paths, referrers and campaign tags; form views and submissions; revenue, orders and best-selling product names; bookings by service; campaign subjects with delivery, open and click rates; A/B test and variant conversions; and, for a dataset the member can see, field names and types, record and fill counts, number ranges and totals grouped by a value at least three records share. Email addresses and phone numbers are removed, and no individual record is sent. For CRM assistance, the opened record as the CRM shows it, with all of its standard and custom fields, including contact details, notes, timeline and related records. An email draft adds the request and the record's merge field names; an import sends the field names and types and each column's header and value kind, never a row. No account identifiers or authentication tokens, and no email address outside an opened CRM record.",
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
        publishedOn: "2026-10-06",
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
        purpose: "Shipping for merchants who sell physical goods: live carrier rates at checkout, shipping labels, address validation and parcel tracking",
        publishedOn: "2026-10-06",
        reason: "The Shippo adapter (`libs/plugins/shipping/src/lib/providers/shippo.ts`), Platform Accounts: one managed account per workspace, every call the platform's token with the managed account's id. Reached from the shipping plugin's checkout quoter and its console label, address and carrier-account routes, only while `SHIPPO_API_TOKEN` and `SHIPPING_TOKEN_KEY` are set.",
        dataReceived: "For each workspace that uses carrier rates or labels: the workspace’s name and the email of the member who first used them, to open the workspace’s account at the provider; the site’s ship-from address; for a rate at checkout, the shopper’s delivery address and the parcel’s weight, size and value; for a label, the customer’s name, delivery address, phone number and email from the order, the parcel’s weight and size, and, for a parcel crossing a border, each item’s description, quantity, value, weight, tariff code and country of origin; tracking numbers to follow; and, for a carrier account the merchant connects, its account number and the account holder’s name, email, phone and billing address. No card or bank details, and no password.",
      },
      {
        host: "api.easypost.com",
        entity: "Simpler Postage, Inc. (EasyPost)",
        region: "United States",
        purpose: "Shipping for merchants who sell physical goods: live carrier rates at checkout, shipping labels, address validation and parcel tracking",
        publishedOn: "2026-10-06",
        reason: "The EasyPost adapter (`libs/plugins/shipping/src/lib/providers/easypost.ts`), Child Users: one child user per workspace, acting with its own key. The alternative to Shippo, reached only while `EASYPOST_API_KEY` and `SHIPPING_TOKEN_KEY` are set and Shippo's token is not (or `SHIPPING_PROVIDER` names EasyPost).",
        dataReceived: "For each workspace that uses carrier rates or labels: the workspace’s name and the email of the member who first used them, to open the workspace’s account at the provider; the site’s ship-from address; for a rate at checkout, the shopper’s delivery address and the parcel’s weight, size and value; for a label, the customer’s name, delivery address, phone number and email from the order, the parcel’s weight and size, and, for a parcel crossing a border, each item’s description, quantity, value, weight, tariff code and country of origin; tracking numbers to follow; and, for a carrier account the merchant connects, its account number and the account holder’s name, email, phone and billing address. No card or bank details, and no password.",
      },
    ],
  },
  {
    pluginId: 'tax-engines',
    subprocessors: [
      {
        host: "rest.avatax.com",
        entity: "Avalara, Inc.",
        region: "United States",
        purpose: "Sales tax calculation and transaction recording in a merchant’s own Avalara AvaTax account, when the merchant connects one",
        publishedOn: "2026-10-07",
        reason: "AvaTax REST v2, reached only from the tax-engines plugin’s adapter (`libs/plugins/tax-engines/src/lib/providers/avalara.ts`) with the merchant’s own credentials: a quote at checkout and the POS, a committed sale when an order is paid, a refund or void when it is refunded or canceled, and address checks.",
        dataReceived: "For each quote and each recorded sale: the store’s ship-from address, the buyer’s shipping address (or the store’s own for an in-person sale), the buyer’s email address as the customer code, the order id, each line’s product id or SKU, name, quantity, amount and tax code, the shipping amount, the tax charged, and an exemption type and certificate number where the merchant recorded one for the buyer. Refunds send the amount refunded. The merchant’s AvaTax account id and license key authenticate each call. No payment details are sent.",
      },
      {
        host: "sandbox-rest.avatax.com",
        entity: "Avalara, Inc.",
        region: "United States",
        purpose: "The same, for a merchant who connects an AvaTax sandbox account to test",
        publishedOn: "2026-10-07",
        reason: "AvaTax’s sandbox environment, reached by the same adapter when the connection names it.",
        dataReceived: "For each quote and each recorded sale: the store’s ship-from address, the buyer’s shipping address (or the store’s own for an in-person sale), the buyer’s email address as the customer code, the order id, each line’s product id or SKU, name, quantity, amount and tax code, the shipping amount, the tax charged, and an exemption type and certificate number where the merchant recorded one for the buyer. Refunds send the amount refunded. The merchant’s AvaTax account id and license key authenticate each call. No payment details are sent.",
      },
      {
        host: "api.taxjar.com",
        entity: "TaxJar (a Stripe company)",
        region: "United States",
        purpose: "Sales tax calculation and transaction recording in a merchant’s own TaxJar account, when the merchant connects one",
        publishedOn: "2026-10-07",
        reason: "TaxJar API v2, reached only from the tax-engines plugin’s adapter (`libs/plugins/tax-engines/src/lib/providers/taxjar.ts`) with the merchant’s own API token: a quote at checkout and the POS, an order transaction when an order is paid, a refund transaction or deletion when it is refunded or canceled, and address checks.",
        dataReceived: "For each quote and each recorded sale: the store’s ship-from address, the buyer’s shipping address (or the store’s own for an in-person sale), the order id, each line’s product id or SKU, name, quantity, unit price, discount and tax code, the shipping amount, the tax charged, and an exemption type where the merchant recorded one for the buyer. Refunds send the amounts refunded. The merchant’s TaxJar API token authenticates each call. No email address or payment details are sent.",
      },
      {
        host: "api.sandbox.taxjar.com",
        entity: "TaxJar (a Stripe company)",
        region: "United States",
        purpose: "The same, for a merchant who connects a TaxJar sandbox token to test",
        publishedOn: "2026-10-07",
        reason: "TaxJar’s sandbox environment, reached by the same adapter when the connection names it.",
        dataReceived: "For each quote and each recorded sale: the store’s ship-from address, the buyer’s shipping address (or the store’s own for an in-person sale), the order id, each line’s product id or SKU, name, quantity, unit price, discount and tax code, the shipping amount, the tax charged, and an exemption type where the merchant recorded one for the buyer. Refunds send the amounts refunded. The merchant’s TaxJar API token authenticates each call. No email address or payment details are sent.",
      },
    ],
  },
]
