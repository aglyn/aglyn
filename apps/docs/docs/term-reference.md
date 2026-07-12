---
sidebar_position: 4
title: Term reference
description: Every term Aglyn uses, in one place — brief definitions with links to the full documentation for each.
---

# Term reference

Every term you'll meet in Aglyn, defined in a sentence or three, with links
to the page that covers it in depth. For the *rules* about which word to use
where (org vs. workspace vs. tenant vs. host), see the
[Glossary & naming conventions](glossary.md) — this page is the vocabulary,
that page is the ruling.

**Jump to a group:**
[Platform & accounts](#platform--accounts) ·
[Sites & content](#sites--content) ·
[The node tree](#the-node-tree) ·
[Besigner (the editor)](#besigner-the-editor) ·
[Plugins & marketplace](#plugins--marketplace) ·
[Data & logic](#data--logic) ·
[Automation & marketing](#automation--marketing) ·
[Commerce](#commerce) ·
[Billing & plans](#billing--plans)

Every term below is a heading, so the table of contents on the right lists
them all alphabetically within each group.

---

## Platform & accounts

### Organization (org)

The account entity: one subscription, one team roster, one plugin
switchboard, one data-isolation boundary. Everything you own in Aglyn —
sites, datasets, media, installs — belongs to an organization. In code and
APIs this is always `org`. → [Glossary](glossary.md),
[Teams & roles](teams-and-roles/overview.md)

### Workspace

The same entity as an organization, in the product's user-facing language —
"your workspace", including the `{slug}.aglyn.io` workspace URL. Workspace
never names anything in code; it's the word the UI uses for your org.
→ [Glossary](glossary.md)

### Tenant

The published-site **runtime**: the single deployment that takes any
incoming domain, resolves it to one of your sites, and renders its published
screens. "Tenant" always means this serving side of the platform — it is not
another word for organization. → [Glossary](glossary.md),
[Architecture & multi-tenancy](staff-console/architecture-multi-tenancy.md)

### Host

One site, as the data model sees it: its subdomain or custom domain, its
screens and layouts, its media, its member-role projection. An organization
owns many hosts. In UI copy a host is called a **site**. → [Glossary](glossary.md)

### Site

The user-facing word for a host — what you create, design, and publish.
"3 of 15 sites" on your dashboard is counting hosts.
→ [Create a site](getting-started/create-a-site.md)

### Console

The builder application where you sign in and do everything: manage your
workspace, design screens in the Besigner, configure plugins, view billing.
→ [Console tour](getting-started/console-tour.md)

### Staff console

The internal, staff-only area of the console (organizations directory,
release flags, plugin review queue, audit log). Invisible without the staff
claim. → [Staff console](staff-console/overview.md)

### Member

A person on an organization's roster, holding one of the built-in role
tiers — **admin**, **editor**, or **viewer** — org-wide or scoped to
specific sites. → [Teams & roles](teams-and-roles/overview.md)

### Custom role

An owner-defined named permission set that can be assigned in place of the
built-in tiers, toggling individual permission keys like `createHosts` or
`editBilling`. → [Custom roles](teams-and-roles/custom-roles.md)

### Publisher

An account that has published to the community marketplace. Each publisher
has one public profile (handle, display name, listings).
→ [Publisher handbook](plugins/publishing/publisher-handbook.md)

---

## Sites & content

### Screen

One page of a site: a slug, publish state, and a designed node tree.
Screens can nest (parent/child slugs) and can bind to a shared layout.
→ [Screens & layouts](screens-and-layouts/overview.md)

### Layout

Shared site chrome — app bar, footer, navigation — designed once and
rendered around every screen bound to it. → [Screens & layouts](screens-and-layouts/overview.md)

### Slug

A screen's URL segment. Nested screens compose their ancestors' slugs into
the full path. → [Screens & layouts](screens-and-layouts/overview.md)

### Version

An immutable snapshot of a screen's (or layout's) node tree. You edit a
draft version; publishing points the live site at a version. Scheduled
publishing flips the pointer at a set time.
→ [Publish your first screen](getting-started/publish-your-first-screen.md)

### Redirect

A rule that forwards one path to another on your published site — for
migrations, renamed pages, or vanity URLs. → [Redirects](redirects/overview.md)

### Error screens

Designable screens served for 404/401/403/503 instead of a generic error
page. → [Error screens](site-protection/error-screens.md)

### Maintenance mode

A host-level switch that serves the designed 503 screen on every path while
you work. → [Maintenance mode](site-protection/maintenance-mode.md)

### Locale

A language your site serves (e.g. `en`, `es`). Multilingual sites pick a
default locale and can render a language switcher.
→ [Multilingual](multilingual/overview.md)

### Site template

A snapshot of screens, layouts, and content that can be applied to a new
site — yours to save and reuse, or installed from the marketplace.
→ [Site templates](site-templates/overview.md)

### Theme

The site-wide design system — palette, typography, spacing, component
styling — edited in the theme builder and applied to every screen.
→ [Theme builder](theme-builder/overview.md)

### Custom domain

Your own domain attached to a site in place of the default subdomain, with
guided DNS verification. → [Custom domains](custom-domains/overview.md)

### Subdomain

The default address every site gets on the platform's serving domain, before
(or alongside) a custom domain. → [Custom domains](custom-domains/overview.md)

---

## The node tree

The rendering model shared by the editor and the published site. Every
designed screen is a **tree** of **nodes**; the renderer walks it with a
family of components named like the parts of a tree.

### Node

The atom of a design: `{ $id, componentId, props, sx, nodes }`. Each node
names the registered component that renders it, carries its props and
styling, and lists its child node ids. A screen version stores its whole
design as a map of nodes. → [Besigner overview](besigner/overview.md)

### Tree

The node hierarchy of one screen or layout — what you see in the Besigner's
hierarchy panel and what the renderer walks to produce the page.
→ [Drag-and-drop hierarchy](besigner/drag-drop-hierarchy.md)

### Tree root

The renderer's entry point: takes the root node and mounts the walk,
letting hosts (the editor, the published site) swap in their own trunk,
stem, branch, or leaf implementations.

### Trunk

The first hop of the walk — renders the root node through the current stem.
The editor substitutes its own trunk to add design-time behavior without
touching the production renderer.

### Stem

The per-node resolver: looks up a node's `componentId` in the component
registry and renders it, recursing into the node's children.

### Branch

Renders a node's children in order — the fan-out step between a parent node
and its child stems.

### Leaf

The terminal wrapper that actually mounts a node's registered component with
its resolved props. Each leaf tags its DOM with the node id, which is what
the editor's selection and drag-and-drop hang on to.

### Component

A registered, renderable building block (button, section, product card…) a
node can reference by `componentId`. Component ids are persisted in screen
documents, so they are never renamed. → [Besigner overview](besigner/overview.md)

### Component bundle

A named set of components a plugin registers together for the canvas — the
base MUI bundle plus whatever feature plugins add.
→ [Building feature plugins](plugins/building-feature-plugins.md)

### Preset

A ready-made node subtree (a component with curated props and children) you
insert from the Besigner drawer instead of assembling from scratch.
→ [Besigner overview](besigner/overview.md)

### Reusable component

A node subtree promoted to a host-level definition, inserted anywhere as an
instance and updated in one place.
→ [Reusable components](besigner/reusable-components.md)

### Lineal (placement) rules

The nesting rules that decide which components may be placed inside which.
When a drag is rejected, the Besigner names the lineal rule that blocked it.
→ [Drag-and-drop hierarchy](besigner/drag-drop-hierarchy.md)

---

## Besigner (the editor)

### Besigner

Aglyn's visual designer — the editor where you build screens, layouts, and
designed emails by composing the node tree on a live canvas.
→ [Besigner overview](besigner/overview.md)

### Canvas

The live design surface inside the Besigner: your screen rendering for real,
with selection, drag-and-drop, and inline text editing layered on top.
→ [Besigner overview](besigner/overview.md)

### Hierarchy panel

The tree view of the current screen's nodes — select, reorder, and reparent
from the structure instead of the canvas.
→ [Drag-and-drop hierarchy](besigner/drag-drop-hierarchy.md)

### Drawer

The Besigner's component palette: registered components, presets, and
installed marketplace components, ready to drag onto the canvas.
→ [Besigner overview](besigner/overview.md)

### Binding

A token in designed content that resolves to live data at render time —
dataset fields, variables, page context. → [Bindings](bindings/overview.md)

---

## Plugins & marketplace

### Plugin

A self-contained feature package that extends the console, the Besigner
canvas, the published site, or the server APIs — without touching core code.
First-party features and community submissions use the same system.
→ [Plugins overview](plugins/overview.md)

### Add-on

The user-facing word for optional capability on top of your plan — installed
plugins and purchasable extras, managed from the Plugins & add-ons hub.
→ [Plugins overview](plugins/overview.md)

### Surface

The part of the product a plugin registers into: the console client, the
site (canvas + published pages), or the server tiers. A plugin declares
which surfaces it provides. → [Plugin manifest](plugins/reference/manifest-and-envs.md)

### Console extension

Everything a plugin adds to the console shell — nav items and pages,
dashboard cards, settings sections, widgets, providers.
→ [Extension points](plugins/reference/extension-points.md)

### Widget

A plugin component rendered into a named shell zone (dashboard footer, org
settings, listing detail…). → [Injection zones](plugins/reference/injection-zones.md)

### Injection zone

A named slot in the console shell that plugin widgets can target. The
guaranteed zones are a typed catalog; custom zones are open strings.
→ [Injection zones](plugins/reference/injection-zones.md)

### Plugin manifest

The generated loader table mapping plugin ids to their import entry points
per app — the only sanctioned place plugins are referenced by the apps.
→ [Manifest & envs](plugins/reference/manifest-and-envs.md)

### Enabled plugins

The per-organization switchboard deciding which plugins load for a
workspace. Enablement, plan entitlement, and release flags gate together.
→ [Plugins overview](plugins/overview.md)

### Feature flag

A plugin's plan-entitlement gate: the extension names the flag, and the
shell only serves it when the org's plan (or overrides) grants it.
→ [Billing & plans](billing-and-plans/overview.md)

### Release flag

A staff-controlled rollout switch (off / staff / percentage / on) evaluated
per workspace — how features ship dark and roll out gradually.
→ [Feature flags & releases](staff-console/feature-flags.md)

### Plugin config

A plugin's declared settings schema, edited by workspace admins in a
generated form and read back typed with defaults merged.
→ [Plugin manager API](plugins/reference/plugin-manager-api.md)

### Plugin permission

A permission key a plugin declares with per-role-tier defaults, resolved
alongside the built-in org permissions.
→ [Plugin manager API](plugins/reference/plugin-manager-api.md)

### Plugin job

A scheduled task a plugin registers, run by the guarded platform jobs
endpoint. → [Server APIs](plugins/guides/server-apis.md)

### Listing

A marketplace entry: the published, versioned artifact of a plugin,
template, or component set, with its content, pricing, and review state.
→ [Publish a plugin](plugins/publish-a-plugin.md)

### Install

The record of a workspace adding a listing — pinned to a content-addressed
artifact version and synced with the org's enabled plugins.
→ [Plugins overview](plugins/overview.md)

### Realm bundle

A staff-reviewed, signed remote plugin bundle that loads into the host
runtime itself (sharing React and the registries) instead of a sandbox —
the trusted tier, verified by hash and signature before import.
→ [Realm bundles](plugins/guides/realm-bundles.md)

### Sandbox

The default isolation for community plugin UI: an iframe bridge with a
versioned message protocol, prop allowlists, and host-mediated network
access. → [Building feature plugins](plugins/building-feature-plugins.md)

### Host ABI

The versioned contract a realm bundle is built against — the host-provided
React, JSX runtime, and registries. Bundles declaring an incompatible ABI
are refused. → [Realm bundles](plugins/guides/realm-bundles.md)

### Review queue

The staff pipeline every marketplace submission passes through before it is
publicly listed. → [Publisher handbook](plugins/publishing/publisher-handbook.md)

---

## Data & logic

### Dataset

A structured, org-scoped data collection with a typed schema — the backing
store for dynamic content, forms, and commerce.
→ [Datasets](datasets/overview.md)

### Record

One row of a dataset. → [Datasets](datasets/overview.md)

### Field

One typed column of a dataset's schema. Plugins can register **custom field
types** that ride on the built-in storage types.
→ [Model builder](datasets/model-builder.md)

### Relation

A link between datasets (reference fields), letting records point at
records. → [Relations](datasets/relations.md)

### Contact

A person captured into your workspace's audience — from forms, commerce, or
manual entry. → [Contacts](contacts/overview.md)

### Segment

A saved filter over contacts, used to target campaigns and automations.
→ [Contacts](contacts/overview.md)

### Media library

Per-site uploaded assets with folders, tags, CDN delivery, and generated
variants. → [Media](media/overview.md)

### Variable

A named site-level value (text, number, toggle) referenced from bindings
and logic — change it once, it updates everywhere it's used.
→ [Bindings](bindings/overview.md)

### Function (fx)

A site-level computed expression — inputs, conditions, and operations that
produce a value bindings can consume. Edited from the Besigner's ƒx panel
and the Logic page. → [Bindings](bindings/overview.md)

### Form

A designed input block on a published page whose submissions flow into the
forms pipeline (and from there to contacts, workflows, and notifications).
→ [Forms](forms/overview.md)

---

## Automation & marketing

### Event

Something that happened on a site or in the workspace — a form submission,
an order, a booking — that automations and workflows can react to.
→ [Workflows & actions](workflows-and-actions/overview.md)

### Workflow

A configured sequence of actions that runs when its trigger event fires,
with run logs to audit each execution.
→ [Build a workflow](workflows-and-actions/build-a-workflow.md)

### Action

One step inside a workflow — send an email, call a webhook, update a
record. → [Actions builder](workflows-and-actions/actions-builder.md)

### Automation

Client-side reactive behavior on the published site (show, hide, trigger on
visitor activity), configured in the marketing tools and executed by the
site runtime. → [Marketing overlays](marketing-overlays/overview.md)

### Overlay

Site-wide attention elements — the **announcement bar** (persistent top
strip) and the **popup** (triggered by delay, scroll, or exit intent, with
optional email capture). → [Marketing overlays](marketing-overlays/overview.md)

### Experiment

An A/B test on a screen: visitors are assigned variants and engagement is
tracked so a winner can be promoted.
→ [Marketing overlays](marketing-overlays/overview.md)

### Email campaign

A one-off or automated email send to contacts or a segment, with delivery
and engagement tracking. → [Email campaigns](email-campaigns/overview.md)

### Designed email

An email document built in the Besigner — the same node tree, rendered to
email-safe markup. → [Designed emails](email-campaigns/designed-emails.md)

### Merge tag

A personalization token in an email or overlay ("first name", "order
total") resolved per recipient at send time.
→ [Email campaigns](email-campaigns/overview.md)

---

## Commerce

### Commerce

The commerce plugin family: catalog, storefront components, cart and
checkout, orders, discounts, and analytics. → [Commerce](commerce/overview.md)

### Product

A sellable catalog item — physical, digital, or service — with variants,
pricing, and inventory. → [Catalog](commerce/catalog.md)

### Order

A completed purchase with its line items, payment state, and fulfillment
history. → [Commerce](commerce/overview.md)

### POS

Point of sale — in-person checkout from the console against the same
catalog and inventory. → [POS & reservations](commerce/pos-and-reservations.md)

### Booking

A scheduled appointment or reservation taken through the bookings plugin's
services, availability, and slots. → [Bookings](bookings/overview.md)

---

## Billing & plans

### Plan

The subscription tier an organization is on. Entitlements resolve from the
plan at read time; workspaces without a plan run dark-launch (ungated).
→ [Billing & plans](billing-and-plans/overview.md)

### Entitlement

A capability or limit granted by the plan — feature switches and quotas —
optionally overridden per organization by staff.
→ [Billing & plans](billing-and-plans/overview.md)

### Quota

A numeric entitlement (sites, datasets, storage) checked at the point of
use, with warnings as you approach the limit.
→ [Billing & plans](billing-and-plans/overview.md)

### Seat

A team-member allowance. Plans include seats; addon seats can be purchased
up to a per-plan maximum. → [Teams & roles](teams-and-roles/overview.md)

### Metered usage

Consumption billed monthly in arrears (storage, delivery) with a live
estimate shown before it lands on an invoice.
→ [Billing & plans](billing-and-plans/overview.md)
