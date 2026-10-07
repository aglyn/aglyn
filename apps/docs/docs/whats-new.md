---
sidebar_position: 12
slug: /whats-new
title: What's New
description: The features Aglyn shipped most recently, grouped by area with links into the docs.
---

# What's New

The features Aglyn shipped most recently, grouped by area. Each links into its section
for the how-to.

## October 2026 — faster fonts on every site (newest)

- **[Fonts load the way your text uses them](building-sites/theme-builder/edit-your-theme.md#set-colors-and-fonts)** —
  your published site now loads each font at the weights its headings and body text
  use, from your own address, as the smallest set of files. Text that shows before a
  font arrives is sized to match it, so the page no longer shifts when the font swaps
  in.

## October 2026 — sell on Google, Meta, TikTok, Pinterest, Snapchat and Microsoft

- **[Sales channels](commerce-and-bookings/commerce/sales-channels.md)** — a product
  feed for each of Google (Shopping, free listings and YouTube), Meta (Facebook and
  Instagram), TikTok, Pinterest, Snapchat and Microsoft Shopping, in the format each
  channel asks for, under **Products → Settings → Sales channels**. Every variant is
  listed with its own photo, price in your store's currency, sale price, stock,
  brand, barcode, part number, condition, Google category and shipping, with no limit
  on catalog size. Each card has its channel's setup steps and a private address you
  can replace, and **Check products** lists what each feed leaves out and why.
- **[Brand, barcode and category](commerce-and-bookings/commerce/sales-channels.md#brand-barcode-and-category)** —
  a new **Shopping channels** section in the product editor, with store-wide defaults
  for what a product leaves blank.

## October 2026 — wallets and pay later on your own domain

- **[Payment methods](commerce-and-bookings/commerce/overview.md#payment-methods)** —
  Apple Pay, Google Pay and Link now show on your own domain, because Aglyn registers
  it with Stripe when you connect it. A new **Payment methods** card in commerce
  settings turns Klarna, Afterpay, Affirm, Cash App Pay, Amazon Pay and the wallets
  on or off, shows what each needs and its limits, and asks Stripe to enable them on
  your payout account. Stablecoin payments can be turned on when the platform offers
  them.

<!--
  AGL-3614 — Accounting is built and release-flagged OFF (`release_accounting`) until a
  deployment has its Intuit or Xero app credentials. This entry is held unpublished, like
  the two guides it links (`unlisted: true`): when the flag is switched on, remove this
  comment's markers, move "(newest)" here from the heading below, and delete
  `unlisted: true` from commerce-and-bookings/commerce/connect-quickbooks-online.md and
  connect-xero.md.

## October 2026 — accounting sync

- **Accounting** — connect [QuickBooks Online](commerce-and-bookings/commerce/connect-quickbooks-online.md)
  or [Xero](commerce-and-bookings/commerce/connect-xero.md) and every paid order, refund,
  Aglyn fee and Stripe payout is posted to your books as it happens, to the accounts you
  choose: a sales receipt (or invoice and payment) per order, or one summary journal a
  day. Set a start date to bring in earlier sales; anything the ledger refuses waits
  under **Needs attention** with its reason and a Retry button. Included with every plan
  that sells online.
-->

<!--
  AGL-3631 — Tax services are built and hidden until a deployment sets
  TAX_ENGINES_TOKEN_KEY (the key merchants' credentials are sealed under; no
  vendor account of Aglyn's is needed). This entry is held unpublished, like the
  guide it links (`unlisted: true`): once the key is set on aglyn.com, remove this
  comment's markers, move "(newest)" here from the top heading, and delete
  `unlisted: true` and the "Rolling out" note from
  commerce-and-bookings/commerce/tax-services.md.

## October 2026 — your own tax service

- **[Avalara AvaTax and TaxJar](commerce-and-bookings/commerce/tax-services.md)** —
  connect your own AvaTax or TaxJar account and checkout and the register charge the
  sales tax it calculates, with product tax codes and exempt customers. Paid orders,
  refunds and register returns are recorded in your account. If the service does not
  answer in time, the sale is taxed at your own rates and the order says so. You remain
  responsible for registering, filing and paying your sales tax.
-->

<!--
  AGL-3639 — Email platform connections are built and hidden until a deployment
  sets MARKETING_PLATFORMS_TOKEN_KEY on the console (the key merchants' API keys
  are sealed under; no vendor account of Aglyn's is needed). This entry is held
  unpublished, like the guide it links (`unlisted: true`): once the key is set on
  aglyn.com, remove this comment's markers, move "(newest)" here from the top
  heading, and delete `unlisted: true` and the "Rolling out" note from
  marketing-and-automation/email-campaigns/email-platforms.md.

## October 2026 — your own email platform, kept in step

- **[Mailchimp, Klaviyo and Omnisend](marketing-and-automation/email-campaigns/email-platforms.md)** —
  connect your own account to a site with its API key and your contacts stay in
  step both ways: everyone the site may market to is added with their name, tags and
  order history, an unsubscribe on either side reaches the other, and Klaviyo and
  Omnisend receive your started checkouts and orders for their abandoned-cart and
  post-purchase flows. A sync log under each connection shows what ran and anything
  that needs you.
-->

## October 2026 — the register takes every payment

- **[Split payments](commerce-and-bookings/commerce/pos-and-reservations.md#taking-payment)** —
  **Charge** opens the sale and the register takes as many payments as it needs: type
  less than the balance to split it across cash, cards, gift cards and room charges.
  The sale is paid, and its stock taken, when the balance reaches zero. **Void sale**
  hands back everything taken on it.
- **[Card readers](commerce-and-bookings/commerce/pos-and-reservations.md#card-readers)** —
  where card readers are available for your store, register a Stripe Reader S700 or
  BBPOS WisePOS E under **Commerce → Settings → POS devices** with the code it shows,
  and the customer taps, inserts or swipes there. A declined card can be retried on
  the same charge.
- **[Tips](commerce-and-bookings/commerce/pos-and-reservations.md#tips)** — turn on
  **Ask for tips at the register** and set your percentages; the customer picks a tip
  on the card reader or the customer display, or the cashier picks one. Tips are not
  counted as sales and carry no platform fee.
- **[Typed cards](commerce-and-bookings/commerce/pos-and-reservations.md#taking-payment)** —
  **Type card** takes a card that is not present, such as a phone order, in Stripe's
  own card form with its normal checks, 3-D Secure included.
- **[Gift cards at the register](commerce-and-bookings/commerce/pos-and-reservations.md#taking-payment)** —
  check a card's balance and apply it; it pays what it can and leaves the rest open.
- **[A register made for tablets](commerce-and-bookings/commerce/pos-and-reservations.md#the-register)** —
  photo tiles with stock and basket counts, **★ Quick keys** for your best sellers, a
  sheet for sizes and modifiers with the price on its **Add** button, and basket lines
  you tap to change. The products and the register sit side by side on a wide screen,
  and on a smaller one the register slides up from a bar that always shows the total.
- **[Modifiers](commerce-and-bookings/commerce/pos-and-reservations.md#modifiers)** —
  add choices such as a milk or an extra shot to a product, free or priced, required or
  optional, picked as the item is rung up.
- **[Customer display](commerce-and-bookings/commerce/pos-and-reservations.md#customer-display)** —
  pair a tablet facing the customer with a one-time code from the register. It shows
  your logo and the basket as you ring it up, and lets the customer choose their tip and
  their receipt. The [hardware guide](commerce-and-bookings/commerce/pos-hardware.md)
  covers readers, scanners, printers and the tablet.

## October 2026 — POS hardware

- **[Cloud receipt printers](commerce-and-bookings/commerce/pos-hardware.md#receipt-printers)** —
  a Star CloudPRNT or Epson Server Direct Print printer prints the register's
  receipts from any device, with no driver: pair it on the register's **Hardware**
  card, paste its URL into the printer, and every sale prints. Reprint any register
  order, and see each printer's status and recent jobs.
- **[Kitchen tickets](commerce-and-bookings/commerce/pos-hardware.md#what-prints)** — a
  printer in the kitchen, at the bar or on the packing bench prints each sale's items
  and quantities, with no prices.
- **[Cash drawer](commerce-and-bookings/commerce/pos-hardware.md#cash-drawer)** — a
  drawer plugged into the printer opens on every cash sale, including the cash part of
  a split payment, and when the shift records cash paid in, paid out or dropped.
- **[Barcode scanning](commerce-and-bookings/commerce/pos-hardware.md#barcode-scanning)** —
  scan with a tablet's or phone's camera at the register and in the product editor,
  and a USB or Bluetooth scanner works even when the search box does not have focus.
- **[Product labels](commerce-and-bookings/commerce/pos-hardware.md#product-labels)** —
  print price and barcode labels on a label printer, or download ZPL for a Zebra.

## October 2026 — running the register

- **[Running the register](commerce-and-bookings/commerce/pos-operations.md)** — the
  point of sale now runs a whole trading day. Open a **shift** with a starting float,
  record cash paid in, paid out and dropped to the safe, and close with a count: the
  **X and Z reports** show sales by tender, tips, refunds, discounts and tax, and the
  drawer's expected cash against what you counted. Staff switch in with their own
  **PIN** on a shared tablet, and every sale records who rang it. Look **customers** up
  by name, email or phone and attach them to the sale. Take **returns and exchanges** at
  the register by scanning the receipt's barcode: the money goes back the way it was
  paid, and the items go back in stock. Receipts print on an **80 mm** roll, with a
  gift receipt option.

## October 2026 — ShipStation, Pirate Ship and shipping spreadsheets

- **[Use ShipStation with Aglyn](commerce-and-bookings/commerce/use-shipstation.md)** —
  connect your store to ShipStation as a Custom Store from the new **ShipStation** card
  under your store's **Settings**. ShipStation imports the orders you still have to ship,
  with weights, SKUs and options, and each label you buy there marks the order shipped
  in Aglyn and emails your customer the tracking link, once. Canceled and refunded
  orders follow to ShipStation on its next import.
- **[Use Pirate Ship with Aglyn](commerce-and-bookings/commerce/use-pirate-ship.md)** —
  **Export for shipping** on the Orders card writes the orders still to ship as a
  spreadsheet Pirate Ship, Shippo or EasyPost reads, and **Import tracking** takes the
  tool's shipment report back: each order is marked shipped and your customer gets the
  tracking link. A tracking number already on an order is never recorded twice.

## October 2026 — order emails and a status page

- **[Order emails](commerce-and-bookings/commerce/order-notifications.md)** — customers
  now hear about every step of their order: a receipt for register sales and paid payment
  links too, an email for each package you ship with its tracking link, and emails when
  you mark an order delivered, refund it or cancel it. Each is sent once, can be designed
  under Emails, and can be switched off under Customer notifications.
- **[Order status page](commerce-and-bookings/commerce/order-notifications.md#order-status-page)**
  — every order email links to a private page on your site with the order's status,
  packages and tracking. No account needed.
- **[Resend receipt](commerce-and-bookings/commerce/order-notifications.md#resend-receipt)**
  — from any order, to the customer or to another address.

## October 2026 — shipping from a postal address

- **[Shipping](commerce-and-bookings/commerce/shipping.md)** — zones, rates and local
  pickup on a page of their own, and each inventory location now carries the postal
  address it ships from.

## October 2026 — checkout on your own site

- **[Returns](commerce-and-bookings/commerce/orders-and-returns.md#returns)** — buyers ask
  for a return from their account or the order's status page, item by item with a reason, within the window you set.
  Approve or decline it, mark it received with what goes back in stock and where, and
  refund the original payment, once. Each step emails the buyer.
- **[Ship in parts](commerce-and-bookings/commerce/orders-and-returns.md#fulfillment)** —
  fulfill some units of an order now and the rest later, each shipment with its own
  carrier tracking link, editable or cancelable.
- **[Invoices](commerce-and-bookings/commerce/orders-and-returns.md#invoices)** — print an
  order as an invoice, or save it as a PDF, beside the packing slip.
- **[Order webhooks](commerce-and-bookings/commerce/orders-and-returns.md#order-webhooks)** —
  send order and return events to your own systems, signed, retried for about a day, with
  a delivery log you can resend from.

- **[In-page checkout](guides/commerce-end-to-end.md#paying-without-leaving-your-site)** —
  shoppers pay on your store instead of being sent to Stripe's page. The Buy and
  Checkout buttons open the form in place with everything the order needs: email,
  shipping address and method when the order ships, the payment method, and a live
  total with shipping and tax. It wears your site's theme, and an order is still created
  by Stripe's confirmation, never by the browser.

## September 2026 — screens are now pages

- **[Screens are now called pages](building-sites/screens-and-layouts/screens.md)** —
  everywhere Aglyn names them: the **Pages** tab in the console, the Besigner, emails and
  notifications, Aglyn AI and these docs. Only the name changed. Nothing about your site
  does: its addresses, its content, how it publishes and your plan's limits stay exactly
  as they were, and the console's own links and the `screens` data a plugin reads keep
  their names, so nothing you built needs changing.

## September 2026 — Aglyn AI

- **[Aglyn AI](ai/overview.md)** — the assistant builds as well as answers. Describe what
  you want and it plans the work, builds it from what your site already has, and hands
  you a draft: a [page](building-sites/screens-and-layouts/generate-a-page.md), a
  [whole small site](ai/generate-a-site.md), a
  [layout](building-sites/screens-and-layouts/layouts.md#generate-a-layout-with-aglyn-ai),
  a [page template](building-sites/site-templates/templates-library.md#generate-a-page-template-with-aglyn-ai),
  a [reusable component](building-sites/components/generate-a-component-with-aglyn-ai.md),
  a [form](ai/generate-a-form.md), a
  [section on the canvas](ai/generate-section.md),
  [rewritten copy](ai/copy-assist.md), a [theme change](ai/theme-assist.md),
  [search titles and descriptions](building-sites/seo/seo-by-ai.md),
  [product copy and catalog ideas](ai/products-with-ai.md),
  [help working the CRM](ai/crm-by-ai.md), a
  [designed email or campaign](marketing-and-automation/email-campaigns/generate-with-ai.md),
  and [what your analytics mean](marketing-and-automation/analytics/insights.md).
- **[Nothing is published](ai/overview.md#drafts-only)** — every generation writes a
  draft or an unpublished version. It never flips a live page, never registers an
  address, never touches your navigation and never sends anything. You publish what you
  want, through the buttons you already use.
- **[The building rules](ai/how-aglyn-ai-builds.md)** — reuse before creating, site-wide
  regions in the layout, forms built on the Forms page and placed by reference, your
  theme's colors and spacing rather than fixed values, images from your media library
  with alt text, one main landmark and headings in order, responsive at your theme's
  breakpoints, and a measured size for every output. Every plan and every generated
  document is checked against them before you see it, and an answer that breaks one is
  re-asked rather than handed over.
- **[The plan comes first](ai/how-aglyn-ai-builds.md#the-plan-comes-first)** — a build job
  proposes what it will reuse, what it will create and why, and the screens it will
  build, with an estimate in credits. Nothing is generated until you confirm it.
- **[The Aglyn AI add-on](workspace-and-billing/billing-and-plans/add-ons.md#aglyn-ai)** —
  bought once for the workspace on any paid plan, it widens your monthly band of
  [AI credits](ai/overview.md#credits-and-caps) rather than adding a second meter.
  Starter gains a band it did not have; Free workspaces generate against their monthly
  allowance and are never billed; Enterprise carries it by agreement.
- **[Allotments, usage and model choice](ai/ai-allotments.md)** — give one member, one
  site collaborator or one whole site its own monthly share of the pool, hard or soft,
  so one client site cannot spend what everyone else was counting on. Everyone sees their
  own usage while they work and can pick which model answers, or leave it on **Auto**.
- **[AI off for one site](ai/overview.md#switch-ai-off-for-one-site)** — a site admin can
  switch AI off for one site without touching the workspace's add-on, credits or other
  sites.

Drafting an automation from a description is **not** part of this release — see
[Explain automations with AI](ai/automations-with-ai.md#draft).

## September 2026 — the CRM

- **[The CRM is included from Starter](content-and-data/crm/overview.md#what-each-plan-includes)** —
  every part of it, from leads and contacts to companies, deals, tasks, reports, fields
  and settings, comes with a paid plan, and Free includes none of it. On Free the
  **CRM** tab stays in the navigation, with every section shown locked beside the
  upgrade notice. Capture does not depend on the plan: forms, sign-ups, orders and
  bookings still update the people your workspace holds, and exporting them or erasing
  a person on request is under
  [Settings → Privacy](workspace-and-billing/signing-in-and-sessions.md#privacy-requests)
  on every plan. On a paid plan, records past your band now bill as
  [overage](workspace-and-billing/billing-and-plans/overview.md#crm-records) on the
  monthly invoice.
- **[AI assist past the included band](workspace-and-billing/billing-and-plans/overview.md#assist-overage)** —
  on a paid plan the assistant now keeps answering once your included credits are used,
  and the extra credits are billed at your plan's per-1,000 rate on the monthly invoice.
  A switch under **Billing → Usage → AI assist overage**, **Stop AI assist at the
  included band**, stops it there instead; it is off unless you choose it.
- **[The CRM hub](content-and-data/crm/overview.md)** — what was
  the **Contacts** tab is now **CRM**: one tab, seven sections at `…/crm/<section>`.
  [Contacts](content-and-data/crm/contact-record.md) get their own record pages and
  can be added by hand; [leads](content-and-data/crm/leads.md) are worked and
  converted into a contact, a [company](content-and-data/crm/companies.md) and a
  deal; the [deals pipeline](content-and-data/crm/deals.md) is a board with a
  weighted forecast; [tasks](content-and-data/crm/tasks.md),
  [reports](content-and-data/crm/reports.md) and
  [custom fields](content-and-data/crm/custom-fields.md) each have a section. The
  list gains [CSV import](content-and-data/crm/import.md),
  [bulk actions](content-and-data/crm/bulk-actions.md) and a
  [timeline](content-and-data/crm/activities.md) of logged calls and meetings;
  every section's table selects, acts and exports as a CSV that re-imports, and
  [companies import](content-and-data/crm/companies.md#import) too; and
  automations gain [CRM events and steps](content-and-data/crm/automations.md).
  Links to the older `/contacts` address still open the hub.
- **[Email templates and snippets](content-and-data/crm/email-templates.md)** — the
  one-to-one email from a record picks a **Template** that fills the subject and body,
  inserts a **Snippet** at the caret, and saves the letter you just wrote as either.
  Both take [merge fields](content-and-data/crm/email-templates.md#merge-fields) —
  `{{contact.firstName}}`, `{{deal.name}}`, `{{sender.name}}` — filled at send time
  and previewed as you type, with the fields that have no value counted under the
  message. Shared templates are every editor's; personal ones are yours. Managed
  under [CRM → Settings](content-and-data/crm/settings.md#email-templates) and over
  the [REST API](/api/resources/email-templates).
- **[Saved views in the CRM](content-and-data/crm/views.md)** — every CRM list keeps
  its filters, columns and sort under a name: open a view from the views menu or from
  its link, share it with the team, make it your default for the section. The Contacts
  list gains a filter bar with owner, stage, source, company, tags, dates, purchases and
  one filter per custom field; a saved contacts view can be an
  [email audience](content-and-data/crm/views.md#segments-and-views) beside a
  segment.
- **[Companies, pipelines, deals, tasks and activities over the REST API](/api/resources/companies)** —
  the CRM's records join contacts on `/v1`, under one pair of scopes, `crm:read` and
  `crm:write`. Create a [company](/api/resources/companies) keyed by its domain, open a
  [deal](/api/resources/deals) and move it through its [pipeline](/api/resources/pipelines)
  by stage or by status, assign a [task](/api/resources/tasks) with a due date, and
  [log a call](/api/resources/activities) as it ends. Every list takes `?updatedAfter=`
  for a sync that walks only what changed. A [contact](/api/resources/contacts#crm-profile)
  gains its CRM profile — phone, job title, company, owner, lifecycle stage — written per
  site and readable as one, and `/v1/usage` reports the size of each collection.
- **[Functions that can carry a calculator](building-sites/bindings/overview.md#no-code-functions)** —
  an expression can call `min`, `max`, `round`, `floor`, `ceil`, `abs` and `format`, and
  can read any site variable by its name, so a price lives in one variable and every
  page and calculator follows it. A parameter takes a **label**, a starting value and a
  list of **choices**, and the
  [Function Widget](building-sites/besigner/element-catalog.md) asks each one as what it
  is — a number box, a switch, a list — shows several named results instead of one, and
  can update as the visitor types. For a design of your own, the
  [Calculator elements](building-sites/bindings/overview.md#a-calculator-you-lay-out) bind
  inputs, results and conditional rows to one function anywhere on the canvas.

## August 2026 — the canvas, up close

- **[Style hover, focus and the other states](building-sites/besigner/responsive-styling.md#interaction-states)** —
  a row of chips under the breakpoint chip: **Default**, **Hover**, **Active**,
  **Focus** and **Disabled**. Pick one and the whole styles panel switches to that
  state, with the element **held in it on the canvas** so you can see what you are
  doing. Fields you don't touch keep inheriting, states combine with breakpoints, and
  Focus is `:focus-visible` — [keyboard focus](building-sites/besigner/responsive-styling.md#focus-state),
  so styling it can essentially only add an indicator, never remove one.
- **[Text is edited on the element itself](building-sites/besigner/text-editing.md#edit-inline)** —
  double-click and you are typing into the real heading, at its real size and weight,
  with the page reflowing around you. The selection chrome stands aside while you
  type. **Escape** cancels, **Enter** commits a plain element, and a wrapped line of
  inline text is now outlined
  [line box by line box](building-sites/besigner/text-editing.md#wrapped-outlines)
  instead of by one rectangle covering its neighbors.
- **[Formatted text belongs to the canvas](building-sites/besigner/text-editing.md#the-text-attribute)** —
  once an element carries bold, links or lists, the panel's **Text** field shows it
  read-only and says why, rather than letting a plain edit silently throw the markup
  away. **[Remove formatting](building-sites/besigner/text-editing.md#remove-formatting)**
  keeps every word and line break, drops the formatting, and is one undo step.
- **[One box styler, on your theme's spacing ladder](building-sites/besigner/responsive-styling.md#box-stylers)** —
  margin, border, padding and contents in a single diagram, with the sides named in
  words rather than as `mt` / `ml`, and a value shown on each side once it is set.
  Space is set from [nine named steps](building-sites/besigner/responsive-styling.md#spacing-steps)
  that follow your theme, or an exact amount whose
  [unit is explained where you pick it](building-sites/besigner/responsive-styling.md#spacing-units).
- **[Rooms are per version](building-sites/besigner/live-co-editing.md#per-version-rooms)** —
  co-editing pairs you with the people on **the same version** of a document, matching
  where the live edits actually flow. Two people on different versions no longer see
  an avatar promising a connection that isn't there.
- **[See who's in a document before you open it](building-sites/besigner/live-co-editing.md#presence-in-lists)** —
  avatars on the row in the Screens and Layouts lists and the Components, Templates
  and Site emails cards.
- **[User accounts are a switch per site](guides/member-accounts.md)** — visitor
  sign-in is **off until you turn it on**, so a brochure site does not quietly serve
  `/signin`, `/signup` and `/recover`. Turning it on serves them and puts the Members
  elements in the editor; turning it back off hides the pages and
  [deletes nothing](guides/member-accounts.md).
- **[Report an issue asks the right questions](workspace-and-billing/report-an-issue.md#what-to-write)** —
  the dialog says plainly [what it is and is not for](workspace-and-billing/report-an-issue.md#is-it-us-or-your-site),
  then asks per-kind: what you were doing and whether it happens every time for a bug,
  what you are trying to do that you can't for an idea. A question is checked against
  the documentation first, and often answered without filing anything.
- **[Assist shows its sources](getting-started/aglyn-assist.md#answers-straight-from-the-documentation)** —
  every written answer now lists the documentation sections it drew on, as links you
  can follow.

## August 2026 — knowing what happened

- **[Bandwidth, and what happens past it](workspace-and-billing/billing-and-plans/bandwidth.md)** —
  every plan's monthly traffic allowance is now enforceable. On a paid plan the extra is
  metered and billed and your sites keep serving; on Free the site is **paused until the
  start of next month**, clears itself when the month turns, and comes straight back if
  you upgrade. Nothing is ever deleted.
- **[Run history that says what happened](marketing-and-automation/workflows-and-actions/actions-builder.md#run-history)** —
  the **Runs** dialog is a real log: when it ran, what triggered it, whether it
  succeeded, and what each step did. A run stopped by an unmet condition is recorded as
  **Skipped**, naming the field — the answer to "why didn't my automation fire?".
- **[An Inbox of people, not forms](content-and-data/forms/overview.md#the-inbox)** — a
  submission shows who sent it, how long ago, and **where it went**: chips under the
  fields say whether it also became a dataset record.
- **[Count your recipients before you send](marketing-and-automation/email-campaigns/overview.md#recipient-count)** —
  the campaign composer counts the audience while you are still writing, with
  duplicates, unsubscribes and your monthly cap already taken off.
- **[Popups that cap once per session](marketing-and-automation/marketing-overlays/overview.md#frequency)** —
  show a popup at most once per visit, or hide it for a number of days after it is
  dismissed. Scheduled campaigns now actually send, every fifteen minutes.
- **[Average time on a screen](marketing-and-automation/analytics/overview.md#dwell-time)** —
  beside a screen's views, how long visitors stayed. The **Traffic** card was rebuilt too,
  and its growth figure now follows the range you picked.
- **[Download any asset](content-and-data/media/overview.md#download-file)** — from the
  detail drawer or the card menu, for public and private files alike, and the drawer
  says which CDN variants that file actually has.
- **[The Orders screen you were promised](commerce-and-bookings/commerce/overview.md#orders-screen)** —
  a real table with a Channel column, colored status pills, and revenue, order-count and
  average-order-value tiles against the previous 30 days.
- **[Free listings say Free](developers/plugins/overview.md#whats-included)** — the
  marketplace shows a price on every card, stars where a listing has been rated, and a
  **What's included** box on the listing page.
- **[Make the platform yours](workspace-and-billing/white-label.md)** — white-label now
  reaches transactional email: your logo in the header, your product name and support
  URL in the copy. Self-hosters can rename the product itself and serve every site from
  their own apex.
- **[Report an issue](workspace-and-billing/report-an-issue.md)** — a bug report from any
  console page, on every plan, with the page, workspace and version attached for you.

## August 2026 — editing together

- **[A visual editor for long documents](building-sites/besigner/long-form-markdown.md#the-markdown-element)** —
  the Markdown element's **Content** attribute is a WYSIWYG editor, not a text box:
  headings, bold, links, lists, quotes, images, code and tables from a toolbar, pasting
  from a Google Doc keeps its formatting, and a **Markdown** switch shows the raw source
  when you want it. Editing a whole policy page no longer means preparing one long paste.
- **[Live co-editing](building-sites/besigner/live-co-editing.md)** — open the same
  screen, layout, component, template, or designed email as a teammate and edit it
  **together**: presence avatars in the toolbar, each collaborator's cursor and
  selection on the canvas in their own color, and element-level live changes that
  never disturb your undo history.
- **[Concurrent-save protection](building-sites/besigner/live-co-editing.md#when-a-save-is-refused)** —
  if someone else saves the document you're editing, the besigner pauses saving and
  tells you **the moment it happens**, keeping everything on your canvas until you
  reload. No silent overwrites, in either direction.
- **[Local draft recovery](building-sites/besigner/live-co-editing.md#local-draft-recovery)** —
  the besigner keeps a local draft of unsaved work in your browser; after a crash or an
  accidental close, it offers the work back with **Restore** / **Discard**.
- **[Apex custom domains](building-sites/custom-domains/connect-a-domain.md)** — connect
  the bare `example.com`, not just `www`: an ALIAS/ANAME to `sites.aglyn.app` (or an A
  record, where your registrar has no ALIAS) verifies in the same **Verify & connect**
  click as a CNAME.
- **[Edit from the live site](building-sites/besigner/edit-from-the-live-site.md)** —
  an admin bar on your published site that jumps from any live page straight into the
  besigner for the screen serving it.

## Besigner copy & paste

- **[Copy and paste elements](building-sites/besigner/copy-paste.md)** — copy any element with
  its children and paste it somewhere else, **including into a different screen, layout,
  component or template**. Available from the **⋮** menu on the canvas and in the hierarchy,
  or with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>C</kbd> / <kbd>V</kbd>. Multi-selections copy
  in document order, and a paste that would bring in an element the target document doesn't
  have is refused with a message instead of landing half-finished.
- <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>A</kbd> now selects every element at the same depth as
  the current selection.

## Scalable audience pricing

- **[Unlimited member accounts on every plan](workspace-and-billing/teams-and-roles/overview.md#site-membership)** —
  visitors who sign up to your published site are never metered, capped, or charged per
  account, on any tier including Free.
- **[Contact audience bands](workspace-and-billing/billing-and-plans/overview.md#crm-records)** —
  your contacts CRM is priced as an included band per tier. On paid plans, growing past
  the band **never drops a record**: extra contacts will bill as small metered overage
  ($0.25–$1.00 per 1,000/month, cheaper on higher tiers). The billing page has a new
  Contacts meter with a live estimate. Overage billing began when the
  [CRM](content-and-data/crm/overview.md) opened to every workspace.
- **Clearer seat language** — what plan cards used to call "members per host" is now
  **site collaborators**: per-site teammate seats. Member accounts were never seats.
- **[Platform fees on the plan cards](workspace-and-billing/billing-and-plans/overview.md#platform-fees)** —
  each tier now shows its declining transaction-fee ladder, including the digital rate
  that applies to paid memberships and gated content.

## Marketplace at the organization level

- **[One Marketplace for the whole organization](developers/plugins/overview.md)** — browse,
  install, manage and publish marketplace items from a single **Marketplace** destination in
  the organization navigation (**Browse**, **Installed**, and **Publish** tabs), instead of a
  per-site Marketplace tab. Old per-site links redirect here.
- **Marketplace is the market; Plugins is the switchboard** — the two live side by side in
  the organization navigation and do different jobs. **Marketplace** is where you browse,
  install and publish. **Plugins** is where you turn things on and off: an **Installed from
  the marketplace** card and a **Built in** card, each row with a switch and its per-plugin
  settings. Look for a plugin's on/off switch under **Plugins**, not under Marketplace.
  The seller area is its own set of marketplace sections — **Publish**, **Publisher
  Profile**, **Listings**, **Payouts** and **Sales**. Old per-site links redirect into the
  matching organization section.
- **Install targeting** — when you install, choose **All sites** (organization-wide, and any
  sites you add later) or **Selected sites**. Site-scoped artifacts (components, templates,
  layouts) install onto every current site and note that new sites aren't added automatically.
- **[Publish from any site](developers/plugins/publishing/publisher-handbook.md#where-to-publish-from)** —
  the **Publish** tab picks a source site, then a component, a layout, or the whole site as a
  template. The per-site Publish shortcuts still work.
- **[Dataset schemas and email templates are publishable](developers/plugins/publishing/publisher-handbook.md#where-to-publish-from)** —
  share the field model of a dataset (structure only — **records never travel**) or a
  transactional email you've designed. A schema installs as a new empty dataset with its
  reference fields relinked by name; an email installs as a **draft version**, so it never
  replaces an email a site is already sending.

## REST API & API keys

- **[The Aglyn REST API](https://docs.aglyn.com/api)** — programmatic access to
  your organization's datasets and records (full CRUD), contacts, sites, and
  form submissions, authenticated with **API keys** you create under
  **Organization → Settings → API keys**. Keys are scoped, shown once, and
  Business-tier; the API supports cursor pagination, per-key rate limits,
  idempotent writes, and a consistent error envelope. See the new
  [API reference](https://docs.aglyn.com/api).
- **[Record a shipment over the API](https://docs.aglyn.com/api/resources/orders#record-a-shipment)** —
  the new **Orders — record shipments** key permission lets a 3PL, a warehouse
  system or a label printer mark an order **fulfilled** or **delivered** and attach
  the carrier and tracking number, so a store can be both sold from and shipped from
  outside the console. It obeys the same order-status rules the console does, and
  sending the same request twice records the parcel once.

## In-console help

- **[Documentation from the console](getting-started/console-tour.md#the-app-bar)** —
  the account menu now has a **Documentation** entry that opens this site in a
  new tab, and feature pages grew a small **?** icon next to their titles: hover
  for a one-line summary, click through for the full docs page.
- **[Help everywhere](getting-started/console-tour.md#in-context-help)** — the
  same **?** affordance now covers cards, form fields, table headers, the
  staff console, and the Besigner's style and attribute panels, each
  deep-linking to the exact docs section it explains.

## Nav menu system

- **[Dropdown Panel preset](building-sites/menus-and-navigation/overview.md#the-dropdown-panel-preset)** —
  a primitive-built hover panel (Stack + Button + hidden panel) that inserts
  with its hover choreography **pre-wired as editable interactions**: show on
  hover with Esc/outside-click dismissal, hide on leave with a 250ms grace
  delay. Show/hide steps themselves gained **Delay** and **Close on
  Esc / outside click** options in the interaction builder.
- **[Menus & navigation](building-sites/menus-and-navigation/overview.md)** — a
  **Dropdown Menu**, a **Mega Menu** with a free-form wide panel, a slide-in
  **Drawer** with a **Menu Button**, and a one-insert **Mobile Nav** preset.
  Every menu click-toggles out of the box; hover opening (and anything
  fancier) is authored as an interaction. Interactions gained hover
  enter/leave triggers, a repeatable *every time* frequency, element
  **show/hide** actions with a canvas element picker, and **menu** and
  **drawer open/close** actions; the styles panel gained a per-device-band
  **Visibility** control.

## Designed content collections

- **[First-class blog pages](building-sites/site-templates/build-a-blog.md)** — collection
  list and entry routes render through your site theme and shared layout. Pick a
  **List template screen** and an **Entry template screen** per collection in
  **Content**, drop the new **Collection Entries** block (repeats title, date,
  excerpt, Read more per published entry — works on any screen via its
  collection-slug attribute), and render markdown with the themed **Entry
  Body** block. With no template set, the built-in pages still compose inside
  your theme and default layout.

## Self-serve add-ons

- **[Add-ons](workspace-and-billing/billing-and-plans/add-ons.md)** — buy manager and
  member seats, extra datasets, extra sites, POS registers, and the Event Calendar
  straight from **Billing → Add-ons**: prorated previews before every change, hard caps
  where your plan tops out, and quantities that re-price automatically on plan switches.
  No more asking support to enable an add-on.

## Designer & email wave

- **[Responsive styling](building-sites/besigner/responsive-styling.md)** — the artboard
  preview mode now scopes style edits per breakpoint (XS–XL), the box
  stylers are fully interactive with side/axis/all fan-out and units, and
  every element takes custom classes plus a CSS builder (builder / raw
  CSS / raw JSS) on its `sx`.
- **[Designed emails](marketing-and-automation/email-campaigns/designed-emails.md)** — build
  campaign emails in the besigner with email-safe blocks and merge
  tokens; campaigns pick templates by id and support test sends.
- **Rename-safe references everywhere** — products, collections,
  categories, datasets, and screens are picked from lists and stored by
  id; the reference-health audit flags anything dangling.
- **Console reorganization** — site users and analytics get their own
  sections, the dashboard gains commerce and campaign glance widgets, and
  the Products/Marketing/Workflows hubs are tabbed with `?tab=` deep
  links. Notifications + [Manage Account](workspace-and-billing/manage-account.md)
  live under a personal Manage area.
- **[Redirects v2](building-sites/redirects/overview.md)** — prefix and regex match
  modes with capture substitution (`$1`), priority ordering, and an
  inline tester.
- **Org & team v2** — organization logo + contact details, a team member
  detail page with role/title editing and per-member activity, personal
  marketplace profiles, and profile images for every user.
- **Staff console v3** — impersonate a user or an org's owner (audited,
  bannered), edit orgs and user identities directly, and paginated,
  card-styled admin lists.

## Ecommerce platform

The biggest wave yet turns every Aglyn site into a full store, competitive
with Shopify and Squarespace:

- **[Product catalog](commerce-and-bookings/commerce/catalog.md)** — variants and options,
  categories, tags, smart collections, Shopify-compatible CSV import.
- **Storefront blocks** — product grids with facets, product pages with
  variant pickers, cart drawer + checkout with wallets, customer accounts,
  wishlists, newsletter capture. All designable in the besigner.
- **Digital goods** — secure downloads with automatic update re-delivery,
  license keys, subscription products, members-only content and video.
- **[POS & reservations](commerce-and-bookings/commerce/pos-and-reservations.md)** — a console
  register (cash, QR card, room folios) and date-range stays with deposits.
- **Growth tools** — discounts engine, gift cards, abandoned-cart recovery,
  verified reviews, related products, back-in-stock alerts, and a commerce
  analytics dashboard.
- **[New pricing](workspace-and-billing/billing-and-plans/overview.md)** — Starter $16, Pro $39,
  Business $99, and the new Advanced $299 (annual), with platform fees that
  drop to 0% as you upgrade. Pricing and the features included in each tier
  are provisional during pre-release and may change at any time.

## Latest polish wave

The newest round tightened every marketing, billing, and operations loop:

- **[Overlays](marketing-and-automation/marketing-overlays/overview.md)** now track per-overlay views, clicks,
  and dismissals — mirrored into your GA property as `aglyn_overlay` events.
- **[Campaigns](marketing-and-automation/email-campaigns/overview.md)** gained `{{firstName|there}}`-style merge
  tags and **scheduled sends** with cancelation.
- **[Experiments](marketing-and-automation/email-campaigns/overview.md#experiments)** can end on a date or
  **auto-declare a winner** at your chosen confidence level, and exposures/conversions
  mirror into GA as `aglyn_experiment` events.
- **[Automations](marketing-and-automation/workflows-and-actions/actions-builder.md)** picked up frequency
  controls: once per session, once per visitor, or a cooldown window.
- **[Workflows](marketing-and-automation/workflows-and-actions/build-a-workflow.md)** log every run with outcome
  and duration; the Logic page's **Reference health** card flags automations pointing at
  deleted workflows, datasets, or functions.
- **[Dataset imports](content-and-data/datasets/import-export.md)** can **upsert on a key field** instead
  of appending duplicates.
- **[Billing](workspace-and-billing/billing-and-plans/overview.md)** added the Stripe **Billing Portal** for
  payment methods, a past-due banner during retry windows, and usage-threshold
  notifications to org admins.
- The **Marketing hub** opens with an at-a-glance rollup of live overlays, email
  engagement, and experiment states; commerce orders now notify site managers in-app.

## Build & design

- **[The Besigner](building-sites/besigner/overview.md)** — multi-select across hierarchy and canvas,
  whole-selection multi-drag, reliable reparenting with placement markers, inline and basic
  rich-text editing, and clearer "why this drop was rejected" messaging.
- **[Screens & layouts](building-sites/screens-and-layouts/overview.md)** — hierarchical routing with
  cascading slug rewrites, shared **layouts** with slots, reusable components, and **named
  versions with scheduled publishing**.
- **[Theme builder](building-sites/theme-builder/overview.md)** — site theme editor with live preview and
  light/dark schemes, supplied to the canvas so previews match the live site.
- **[Templates, blocks & content](building-sites/site-templates/overview.md)** — starter template gallery,
  save-site-as-template, a section & block library, and a blog with collections and RSS.

## Data

- **[Datasets & dynamic content](content-and-data/datasets/overview.md)** — typed model builder, typed
  document editor, **relations** (including many-to-many), a query layer, repeatable
  components, and CSV/JSON round-tripping.
- **[Bindings, variables & functions](building-sites/bindings/overview.md)** — **rename-safe id tokens**,
  a picker-first insert experience, a no-code function builder, and a where-used safety scan.
- **[Site search](building-sites/site-search/overview.md)** — search across pages and dataset records.

## Media

- **[Media library & CDN](content-and-data/media/overview.md)** — folders as grid cards with
  drag-and-drop organizing, one shared picker everywhere, metadata (including your own
  custom key/value pairs) and bulk edit, image transforms, replace-in-place, an on-demand
  **Used on** audit, large video uploads, and **CDN delivery** with WebP variants (paid).
  Media URLs are **stable**: replacing a file or moving it between folders never breaks an
  existing embed or a link you already copied.

## Grow

- **[Forms & lead capture](content-and-data/forms/overview.md)** — form components, an inbox reader, and
  dataset-backed submissions.
- **[CRM](content-and-data/crm/overview.md)** — unified ingestion from forms,
  members, orders, and bookings, with tags, notes, CSV export, **segments** and a
  [REST API](/api/resources/contacts).
- **[Email campaigns](marketing-and-automation/email-campaigns/overview.md)** — audiences, tiered send caps, and
  unsubscribe handling.
- **[Marketing overlays](marketing-and-automation/marketing-overlays/overview.md)** — a site-wide announcement bar and
  **promotional popups v2** with triggers, capping, scheduling, email capture, and metrics.

## Sell

- **[Commerce](commerce-and-bookings/commerce/overview.md)** — starter selling plus commerce v2 (receipts,
  inventory, coupon codes) and an orders page with filters and CSV export.
- **[Bookings & scheduling](commerce-and-bookings/bookings/overview.md)** — services, availability, a booking
  widget, Stripe payments with slot holds, and reminder emails.

## Reach & measure

- **[SEO toolkit](building-sites/seo/overview.md)** — per-screen SEO, sitemap/robots, JSON-LD, and Open
  Graph/Twitter cards.
- **[Analytics](marketing-and-automation/analytics/overview.md)** — pageview beacon, insights (referrers, devices,
  ranges), and **per-screen traffic** (Pro+).
- **[Multilingual](building-sites/multilingual/overview.md)** — locale variants, hreflang, and a language
  switcher (v1).

## Extend & automate

- **[Plugins & marketplace](developers/plugins/overview.md)** — a plugin registry with install/upgrade,
  a sandboxed runtime, per-plugin config, a network bridge, and marketplace monetization.
- **[Workflows, actions & webhooks](marketing-and-automation/workflows-and-actions/overview.md)** — event-to-action
  automation, workflows on site events, and outbound/inbound webhooks.
- **[AI assist](ai/overview.md)** — copy assist for any text prop and AI Generate
  Section.

## Operate

- **[Teams, roles & membership](workspace-and-billing/teams-and-roles/overview.md)** — custom roles with per-member
  overrides, and members-only site areas.
- **[Billing & plans](workspace-and-billing/billing-and-plans/overview.md)** — aligned tiers, entitlement gates,
  usage meters for every quota, and seat add-ons.
- **[Custom domains](building-sites/custom-domains/overview.md)** and **[redirects](building-sites/redirects/overview.md)** —
  self-service domain setup with DNS verification, and a redirect manager with loop checks
  and hit metrics.
- **[Site protection & error pages](building-sites/site-protection/overview.md)** — per-screen passwords,
  custom 404/401/403/503 screens, and maintenance mode.
- **[Staff console](staff-console/overview.md)** *(Aglyn staff only)* — tenant management,
  entitlement editor, users admin, suspension, and an audit viewer.
- **[Feature flags](staff-console/feature-flags.md)** *(Aglyn staff only)* — Remote
  Config–backed release gating with percentage rollout; staff preview unreleased
  features with warnings.
- **[Organization workspaces](workspace-and-billing/teams-and-roles/overview.md#organizations)** — orgs own
  multiple sites with shared billing, role-based membership with per-site access, and
  Slack-style workspace subdomains
  ([architecture](staff-console/architecture-multi-tenancy.md)).
