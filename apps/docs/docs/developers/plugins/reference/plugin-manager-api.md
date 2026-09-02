---
sidebar_position: 1
title: Plugin-manager API reference
description: Every public registration and loading API a plugin can use, from `@aglyn/aglyn` and `@aglyn/aglyn/server`.
---

# Plugin-manager API reference

Everything a plugin registers goes through `libs/aglyn/src/lib/plugin-manager`,
re-exported from **`@aglyn/aglyn`** (client + isomorphic) and
**`@aglyn/aglyn/server`** (adds the server-only loaders). Hand-written by
design: the surface is small and curated, and each entry needs semantics
(ordering, caching, failure behavior) that generated signatures can't carry.

## Console extensions — `feature-plugins`

| API | What it does |
| --- | --- |
| `registerConsoleExtension(extension)` | Declares everything a plugin adds to the console shell. Idempotent by `pluginId` (re-registration replaces). |
| `listConsoleNavItems()` / `resolveConsolePluginPage(href)` | How the shell renders nav + serves plugin pages under `/[orgSlug]/hosts/[host]/[...pluginSlug]`. The resolver matches an exact `href`, or a declared section beneath one — longest href wins, prefixes match on a segment boundary, and a tie between two enabled plugins refuses. It answers `{ extension, navItem, section?, segments }`. |
| `listConsoleWidgets(slot)` | Widgets registered for a named zone — see [Injection zones](injection-zones.md). |
| `listConsoleProviders()` | App-level providers mounted around every console page. |
| `defineUiFeatureBundle(options, components)` | Site/canvas component bundle; auto-depends on the base `mui` bundle. Component and bundle ids are **persisted in screen docs — never rename**. |
| `CONSOLE_WIDGET_SLOTS` | The typed injection-zone catalog. |

`ConsoleExtension` fields: `pluginId`, `displayName`, `featureFlag?`
(plan-entitlement gate the shell applies — extensions cannot bypass plans),
`permission?` (authorization gate the shell applies — see below), `navItems?`
(a nav item with a `Component` becomes a full page and receives
`ConsolePluginPageProps { hostId, entitled, org?, permissions?, releaseFlag?,
basePath?, sections?, section?, segments? }`), `dashboardCards?`,
`settingsSections?`, `widgets?`, `providers?`.

`ConsoleExtension.permission?` (and `ConsoleNavItem.permission?`, which
narrows one surface) name a permission the reader must hold. `featureFlag`
answers what the **organization** bought; `permission` answers what the
**person** may open, and both are resolved by the shell before the surface is
constructed — an extension declares a requirement and cannot supply an answer
to one. Requirements compose by AND, so a nav item's key is applied on top of
its extension's rather than instead of it.

The key belongs to one of two vocabularies and they are **not**
interchangeable: a dotted `OrgPermission` from the built-in catalog
(`'data.manage'`), answered from the member's granular map; or a key some
plugin declared through `registerPluginPermissions` (`'managePos'`), answered
from the resolved permission map that carries those keys. A key in neither is
**refused**, so a typo takes the surface offline rather than opening it.
Declare a key that is already enforced somewhere real — a permission a
customer can untick that changes nothing is worse than its absence. A surface
that omits both fields is open to every member of the workspace.

Reference adopter: `libs/plugins/contacts` gates the CRM on `data.manage`.

`ConsoleNavItem.sections?` turns one surface into a hub of routes — each
`{ id, label, navTabId? }` becomes a URL at `${href}/${id}`, and the shell
hands the page `section`, `sections` (hrefs + release verdict), `basePath` and
`segments`. An id nobody declared is a 404, never a fallback to the first
section; a section's own `navTabId` ANDs with its nav item's, so a section is
never reachable when its surface is not. Omitting `sections` keeps the nav
item matched exactly as before — a path beneath it does not resolve. See
[Building feature plugins → Routed sections](../building-feature-plugins.md).

## Loading — `plugin-loader`

| API | Semantics |
| --- | --- |
| `createPluginLoader(manifest)` | One loader per generated manifest; loads are cached per plugin, registrations once per plugin+surface. |
| `loader.ensure(ids, surfaces)` | Loads + registers the given plugins' surfaces. Returns a **stable promise per (ids, surfaces)** so React `use()` can suspend on it during SSR — the canvas never renders against an empty registry. Unknown ids are ignored (marketplace realm plugins load separately); `alwaysOn` entries activate regardless. |
| `loader.ensureAll(surfaces)` | Every manifest plugin — the API dispatchers' lazy-load-all. |
| `loader.pluginIdForApiPath(path)` | Prefix-map fallback for the per-request org gate. |

**Lifecycle**: all `register` fns in an ensure batch run first, then each
module's optional **`bootstrap<Surface>()`** export runs (manifest order,
once per plugin+surface, failures logged not fatal) — the sanctioned place
for cross-plugin wiring. Plugins loaded by a later ensure bootstrap in that
batch, so read registries lazily rather than snapshotting.

## Server APIs — `api-plugins` (`/server` only)

| API | Semantics |
| --- | --- |
| `registerPluginApiRoute(path, handler)` | Registers an exact path under the `[...pluginApi]` dispatchers. Ownership is recorded at registration time for the per-request org gate — a disabled plugin's paths 404 for that workspace. |
| `PluginApiRequest` | `{ method, query, body, headers, rawBody? }` — `rawBody` carries the unparsed payload for Stripe/Svix signature verification. |

## Site pipeline — `site-runtime`, `site-page-hooks` (`/server` for hooks)

| API | Semantics |
| --- | --- |
| `registerSiteRuntime({runtimeId, Component})` | Components rendered on every published page (overlay engines, experiment runners); they read back the props their server enricher wrote. |
| `registerSiteRedirectResolver(fn)` | Runs before route resolution; first non-null redirect wins. |
| `registerSitePageResolver(fn)` | Composes plugin-owned pages (commerce PDP/PLP). |
| `registerSitePageEnricher(fn)` | Contributes page-prop slices to every page that renders nodes — published screens, collection routes, designed auth screens and a resolver's own page alike; a resolver's keys win, and `pageData` merges per plugin. Gated screens (password-protected, members-only) enrich behind the gate and deliver the slice with their nodes. The designed 404 body sets `pathUnknown` — it is cached per host, so contribute only what does not depend on a path and never substitute one. Maintenance, lockdown and bandwidth-containment notices are not enriched. **Enricher errors are isolated** — a broken plugin drops its slice, never the page. |

## Stylesheets — `plugin-styles`

Raw CSS your plugin ships, routed so the besigner canvas resolves it exactly
as a published page does.

| API | Semantics |
| --- | --- |
| `registerPluginStyles({pluginId, styleId?, css})` | Registers (or replaces) one stylesheet. Rendered as a plain `<style>` at the site-content root of **every** surface — published tenant, editor Preview, and inside the besigner canvas's shadow root. |
| `unregisterPluginStyles(pluginId, styleId?)` | Drops one sheet, or all of a plugin's. |
| `listPluginStyles()` / `subscribeToPluginStyles(fn)` | The registry, and a change subscription. |
| `capturePluginStyles(pluginId, load)` | Used by the realm loader; see below. |

**Why you cannot just write to `document.head`.** You can, and on a published
page it works — but the besigner canvas renders site content inside a
**closed shadow root**, which a document-level rule never reaches. Measured:
the same rule that beats every MUI declaration on the published page has *no
effect at all* on the canvas. So a plugin that styles itself that way looks
one way in the editor and another way live.

`loadRealmPlugins` therefore wraps each bundle's module evaluation and
`register()` in `capturePluginStyles`, which picks up any `<style>` the bundle
appends to `document.head` — the shape `import './styles.css'` compiles to in
every bundler — and mirrors it into the canvas. The original element is left
where the bundle put it, so CSS you ship for a **console** surface keeps
working. Anything injected outside that window (lazily, or from a `<link>`)
is not mirrored: call `registerPluginStyles` for those.

**Cascade position.** Plugin CSS is deliberately **unlayered**, while all MUI
and author `sx` output sits in `@layer mui`. An unlayered normal declaration
beats every layered one regardless of specificity, so a one-tag selector of
yours outranks a MUI component default — by design, and identically on both
surfaces. Do not wrap your rules in `@layer mui`; that puts them *inside* the
layer, where they start losing.

**Sanitising.** Every registered and captured sheet goes through the same
`sanitizeAuthorCss` the Custom HTML element uses: `url()` targets with a
refused scheme (`http:` and anything unrecognised) are rewritten to
`about:invalid`. `https:`, `data:`, `blob:` and relative forms pass through,
and hosts are not restricted.

## Billing — `billing-webhook-hooks` (`/server`)

`registerBillingWebhookHandler(eventTypePrefix, handler)` — receives the
platform Stripe events. **Handler errors propagate to a 500**; make handlers
idempotent. Handlers run sequentially with no error isolation, deliberately:
isolating them would trade a duplicated side effect for a dropped one, which
is the worse trade on a money path.

A handler may return `{ claimed: true }` to tell the platform it **recognized**
the event as its own — it found the order, the purchase, the booking. Returning
nothing keeps the previous meaning ("not mine"), so existing handlers need no
change. Every registered handler still runs after one has claimed; the claim is
a report, never a dispatch rule.

:::tip Claim your chargebacks
The one event where this matters today is `charge.dispute.*`. A dispute carries
no metadata, so plugins self-select by joining on the payment intent — and a
plugin that finds nothing looks identical to a plugin that failed. The console
route raises a staff alert for any dispute **nothing** claimed, because that is
money moving with no record of it anywhere. If your plugin owns disputes, claim
the ones it handles, or every one of them will be reported as a platform fault.
:::

:::caution A 500 does not always mean a redelivery
A throw that reaches the route **after any dispatch has begun** makes the
platform **hold** its Stripe-event idempotency claim instead of releasing it,
so the redelivery short-circuits as a duplicate and your handler is not run
again — the failure is recorded on the claim and escalated to staff to
reconcile by hand. Releasing the claim would let a redelivery re-apply
whatever the failed dispatch had already committed (an inventory decrement, a
gift-card balance, a coupon redemption), and those cannot be un-applied.

A throw raised **before** any dispatch began still releases the claim and is
redelivered normally.

So "make handlers idempotent" is not advice — it is the condition under which
a failed event can be retried at all. A handler whose effects are idempotent
**per effect** (guarded by a stamp on the row it mutates, not by the event
claim) is one this route can safely re-run.
:::

## Enablement, flags, config, fields, permissions, jobs

| API | Semantics |
| --- | --- |
| `resolveEnabledPlugins(org)` | The org switchboard: absent field → all first-party; always-on unioned in; unknown (marketplace) ids kept. |
| `filterPluginsByReleaseFlags(ids, isFlagOn, {staffBypass})` | Subtracts release-flagged-off first-party plugins (AGL-422). |
| `registerPluginConfigSchema(schema)` / `mergePluginConfig` / `resolvePluginConfig` / `pluginConfigOverrides` / `validatePluginConfigValues` | Per-plugin settings: declared once, generic form + typed reads everywhere, resolved across schema defaults → workspace → per-site override (AGL-428). Full contract: [Plugin configuration](./plugin-config.md). |
| `registerCustomFieldType(fieldType)` / `validateCustomFieldValue` | Dataset field types riding existing storage types (AGL-434). |
| `registerPluginPermissions(list)` | Role-resolved permission keys with per-tier defaults (AGL-435). |
| `registerPluginJob(job)` / `runPluginJobs(due?)` | Scheduled jobs run by the guarded `/api/plugins/run-jobs` route (AGL-435). `job.lockdown` is required; the runner injects a `PluginJobHostGate` into every handler (AGL-2495). |
| `registerPluginJobHostLockdown(fn)` / `pluginJobHostGate()` | How the HOST APP supplies the per-host lockdown verdict the job beat asks, and how a manual cron door mints the same gate (AGL-2495). |
| `registerPluginInstallPresetMapper(fn)` | Maps marketplace install docs to besigner drawer presets. |

## Remote bundles — `realm-plugins` (isomorphic), `realm-server` (`/server`)

| API | Semantics |
| --- | --- |
| `PLUGIN_HOST_ABI_VERSION` / `setRealmPluginHost(host)` | The `__AGLYN_PLUGIN_HOST__` ABI slot; **the app composes it** from its own React/jsxRuntime/registry singletons. |
| `verifyRealmBundle(bytes, install, publicKey?)` | sha256 pin always; Ed25519 signature mandatory when a key is configured (fails closed). |
| `loadRealmPlugins(installs, {artifactsBase, publicKeyBase64})` | Fetch → verify → blob-URL import → `register(host)`. Cached per listing@version; ABI mismatches refused; per-bundle failures logged and skipped. |
| `loadRemoteServerBundles(source)` | Env-gated server tier (default OFF); returns what loaded so callers can audit. |
| `isCompatibleHostAbi(hostAbi?)` | The ABI gate: undeclared = legacy (allowed with a warning). |

## Sandbox — `plugin-bridge`

The versioned postMessage protocol between the host `PluginFrame` and a
sandboxed bundle: `parseGuestMessage` (origin/source/schema-validated),
`filterPluginProps` (manifest allowlist), message types `ready`/`init`/
`props`/`resize`/`event`/`fetch-request`/`fetch-response`/`error`. The
bridge never evals or grafts anything from the frame — sized output and
named events only; network goes through the host-mediated fetch
(server-side allowlist re-check).
