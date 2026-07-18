---
sidebar_position: 11
slug: /whats-new
title: What's New
description: The features Aglyn shipped most recently, grouped by area with links into the docs.
---

# What's New — July 2026

A huge wave of features shipped over the last few days. Here's the tour, grouped by area.
Each links into its section for the how-to.

## Self-serve add-ons (newest)

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
  links. Notifications + profile live under a personal Manage area.
- **[Redirects v2](building-sites/redirects/overview.md)** — prefix and regex match
  modes with capture substitution (`$1`), priority ordering, and an
  inline tester.
- **Org & team v2** — organization logo + contact details, a team member
  detail page with role/title editing and per-member activity, personal
  community profiles, and profile images for every user.
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
  drop to 0% as you upgrade. Existing subscribers keep their current price
  until they change plans.

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

- **[Media library & CDN](content-and-data/media/overview.md)** — folder organization with drag-and-drop,
  metadata and bulk edit, image transforms, large video uploads, and **CDN delivery** with
  WebP variants (paid).

## Grow

- **[Forms & lead capture](content-and-data/forms/overview.md)** — form components, an inbox reader, and
  dataset-backed submissions.
- **[Contacts CRM](content-and-data/contacts/overview.md)** — unified ingestion from forms, members, orders,
  and bookings, with tags, notes, CSV export, and **segments**.
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
- **[AI assist](marketing-and-automation/ai-assist/overview.md)** — copy assist for any text prop and AI Generate
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
