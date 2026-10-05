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
| `listConsoleOrgNavItems()` / `resolveConsoleOrgPluginPage(href)` | The same pair for **organization-level** surfaces — the extension's `orgNavItems`, listed on the organization's tab strip and served under `/[orgSlug]/[...pluginSlug]` with the same matching rules. Neither pair reads the other's list. |
| `listConsoleWidgets(slot)` | Widgets registered for a named zone — see [Injection zones](injection-zones.md). |
| `listConsoleStaffPages()` / `resolveConsoleStaffPage(id)` | How the shell draws a plugin's staff pages: a tab after the staff strip's own, and a page at `/admin/{id}` from the generic staff route. Two plugins claiming one id resolve to nothing, and say so. |
| `listConsoleProviders()` | App-level providers mounted around every console page. |
| `defineUiFeatureBundle(options, components)` | Site/canvas component bundle; auto-depends on the base `mui` bundle. Component and bundle ids are **persisted in page docs — never rename**. |
| `CONSOLE_WIDGET_SLOTS` | The typed injection-zone catalog. A widget with a `column: { header, sortKey?, align? }` is a column of a shell-owned table on the zones documented as column zones. |

`ConsoleExtension` fields: `pluginId`, `displayName`, `featureFlag?`
(plan-entitlement gate the shell applies — extensions cannot bypass plans),
`permission?` (authorization gate the shell applies — see below), `navItems?`
(a nav item with a `Component` becomes a full page and receives
`ConsolePluginPageProps { hostId, entitled, org?, permissions?, releaseFlag?,
basePath?, sections?, section?, segments? }`), `orgNavItems?` (the same
shape, mounted at the organization level rather than under a site: the page
receives `hostId: null` and an `orgMount` naming the organization and its
sites, and the shell admits only a member whose access spans the whole
organization; an `href` that names one of the console's own organization
routes, such as `/team` or `/settings`, never renders), `dashboardCards?`,
`settingsSections?`, `widgets?`, `providers?`, `staffPages?`, `themePresets?`,
`searchSources?`.

A nav item's `header?: { title, icon?, docsTopic?, docsAnchor? }` titles its
page and names the docs topic its help button opens. `docsAnchor` deep-links
one heading of that topic's page (`'#at-the-organization-level'`); an anchor
the page does not carry is dropped and the help opens the top of the page,
and so is any anchor when the topic itself is not one the console knows.

`ConsoleExtension.themePresets?` adds built-in themes to every site's theme
picker (**Setup → Theme**): each `{ id, name, description?, theme }` is a
plain-JSON `HostTheme` — both schemes, fonts, typography, shape and component
overrides (`defaultProps`, `styleOverrides`, theme-aware `sx`, `variants`).
Namespace the `id` with your plugin and never rename it: a site that picks the
theme stores it. Picking copies the theme onto the site and the site's edits
are an override on that copy, so a later version of your plugin never
repaints a site. Declare `hostThemePresets` in your `console.slots` so the
theme page loads your plugin, and nothing else does.

`ConsoleExtension.searchSources?` lets the console's search palette find
your records. Each source is one group of results:

```ts
searchSources: [
  {
    id: 'bottles', // unique across the palette; keep it stable
    group: 'Bottles', // the heading above the rows
    noun: 'bottles', // "Only the first 30 bottles were searched."
    scope: 'host', // `hosts/{hostId}/bottles`; or 'orgData': `orgs/{orgId}/…`
    collection: 'bottles',
    nameField: 'name',
    fallbackNameField: 'label', // when a row has no name
    extraFields: ['vintage'], // further fields a row is found by
    entitlementKey: 'bottlesPerHost', // a plan quota that must be non-zero
    order: 150, // where the group is listed
    href: (row, { orgSlug, host }) =>
      host ? `/${orgSlug}/hosts/${host}/cellar/${row.$id}` : null,
  },
],
```

- The palette reads a capped window of the collection, ordered by document
  id, and matches it in the browser, so a source needs no index. A `host`
  source is read only on a site. An `orgData` source is the organization's
  shared data: it is read through the viewer's `visibleTo` tokens on a site,
  and unfiltered at the organization level, where only an org-wide member is
  offered it.
- A source is offered only where your pages would open: your plugin on for
  the workspace and the site, the extension's `featureFlag` and `permission`
  held, and the source's own `featureFlag?` and `permission?` with them. A
  quota in `entitlementKey` that is zero keeps the collection from being read.
- `order` places the group among the console's own: sites 10, pages 20,
  emails 30, then components, layouts, templates, content and authors at 100
  to 140.
- `href` gets the row (`$id` and its fields) and the two route params; `host`
  is `null` at the organization level. Answer `null` for a row that has
  nowhere to open, and the palette drops it rather than drawing a dead link.
- Declare `consoleSearch` in your `console.slots` so the palette loads your
  plugin when it opens.

`ConsoleExtension.staffPages?` adds pages to the staff area: each
`{ id, label, header?: { title, icon?, docsTopic? }, Component }` becomes a
tab in the staff strip and a page at `/admin/{id}`, rendered inside the staff
chrome with `ConsoleStaffPageProps { basePath }`. Staff pages load with the
plugins that name a `staff` register surface (see
[the manifest](./manifest-and-envs.md)), and the staff claim alone admits a
reader: the extension's `featureFlag` and `permission` do not apply, so every
read the page makes must be refused server-side to a caller without the
claim. The console's own staff routes win the segments they use, and a staff
page whose id is one of them gets no tab.

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

Reference adopter: `libs/plugins/crm` gates the CRM on `data.manage`.

`ConsoleNavItem.sections?` turns one surface into a hub of routes — each
`{ id, label, navTabId? }` becomes a URL at `${href}/${id}`, and the shell
hands the page `section`, `sections` (hrefs + release verdict), `basePath` and
`segments`. An id nobody declared is a 404, never a fallback to the first
section; a section's own `navTabId` ANDs with its nav item's, so a section is
never reachable when its surface is not. Omitting `sections` keeps the nav
item matched exactly as before — a path beneath it does not resolve. See
[Building feature plugins → Routed sections](../building-feature-plugins.md).

A section or hub that is renamed keeps its old address answering. A
first-party plugin declares the rule in `plugins.config.json`, in Next's own
redirect shape, and the console's build config compiles every plugin's rules
into its redirects:

```json
"consoleRedirects": [
  {
    "source": "/:orgSlug/hosts/:host/cellar/bottles/:path*",
    "destination": "/:orgSlug/hosts/:host/cellar/wines/:path*",
    "permanent": true
  }
]
```

Both paths are console paths, `permanent` is stated outright (a browser keeps
a permanent redirect for good), one address has one rule, and the destination
lies under one of the plugin's own `contributes.console` routes: a plugin
moves only its own pages.

## Loading — `plugin-loader`

| API | Semantics |
| --- | --- |
| `createPluginLoader(manifest)` | One loader per generated manifest; loads are cached per plugin, registrations per plugin+surface+use. |
| `loader.ensure(ids, surfaces, use?)` | Loads + registers the given plugins' surfaces. Returns a **stable promise per (ids, surfaces, use)** so React `use()` can suspend on it during SSR — the canvas never renders against an empty registry. Unknown ids are ignored (marketplace realm plugins load separately); `alwaysOn` entries activate regardless. |
| `loader.ensureAll(surfaces)` | Every manifest plugin — the API dispatchers' lazy-load-all. |
| `loader.pluginIdForApiPath(path)` | Prefix-map fallback for the per-request org gate. |

**Lifecycle**: every module in an ensure batch is fetched at once, then the
`register` fns run one at a time in manifest order and each is **awaited**,
then each module's optional **`bootstrap<Surface>()`** export runs (manifest
order, once per plugin+surface, failures logged not fatal) — the sanctioned
place for cross-plugin wiring. Plugins loaded by a later ensure bootstrap in
that batch, so read registries lazily rather than snapshotting.

**`use` — what the surface actually uses** (AGL-3141). `{ componentIds }` as
the page computed it, handed to every register fn unchanged. A plugin that
can register a part of itself reads it and imports only those modules; one
that cannot ignores it. Omit it and every plugin registers all of itself,
which is what the console and the besigner want — their palette shows every
element — and what any surface that cannot say what it places MUST do: an
element whose component never registered renders nothing, silently.
Registration is bookkept per plugin+surface+use, so a second page that places
a component the first did not still reaches the plugin.

## Server APIs — `api-plugins` (`/server` only)

| API | Semantics |
| --- | --- |
| `registerPluginApiRoute(path, handler, options?)` | Registers a path under the `[...pluginApi]` dispatchers. Ownership is recorded at registration time for the per-request org gate — a disabled plugin's paths 404 for that workspace. `path` may carry `:name` segments (`ai/jobs/:jobId/cancel`); an exact registration wins over a pattern. `options.subject` names the organization (and, for a signed tokenless redirect, the account) a request is for when it names no site — see [Naming the subject](../guides/server-apis.md#route-subject). |
| `resolvePluginApiRequestSubject(path, request)` | What a dispatcher asks before its release gate when no `hostId` was named: the declared resolver's answer, read from a clone, or `null` for an undeclared route, a resolver that threw, or ids that are not plain path segments. |
| `options.recipientLink` / `isPluginRecipientLinkRoute(path)` | A route that answers a link the platform mailed to somebody — an unsubscribe in a `List-Unsubscribe` header. Both dispatchers skip their per-site enablement and release gates for it and nothing else: lockdown and the rate limit still apply. An opt-out has to keep working after its plugin is paused for the workspace (CAN-SPAM holds it open for thirty days after the send), so the route authenticates the link itself, by a signature it verifies. |
| `options.machine` / `isPluginMachineRoute(path)` | A route a machine calls — a scheduler's sweep on the cron secret, a provider's signed webhook — that names no site and no member. Both dispatchers skip their per-site enablement and release gates for it, and exempt it from their write limit and cross-origin check (`isMachinePluginApiPath` answers `true` for it); lockdown still applies. The flag grants nothing by itself: the route authenticates its caller, and judges the plugin's release and plan for each organization it resolves. |
| `options.portability` / `isPluginPortabilityRoute(path)` | A route that hands a workspace the records the plugin keeps for it — a data-portability export — which the workspace is owed whether or not the plugin is switched on or released for it now. Both dispatchers skip their per-site enablement and release gates for it and nothing else: lockdown, the email-verification gate and the write limit still apply. The flag grants nothing by itself: the route authenticates the member, and asks the plugin's release and plan itself of anything it serves beyond what the workspace is owed. |
| `options.ownVisitorGates` / `isPluginOwnVisitorGatesRoute(path)` | A public visitor door that runs EVERY visitor gate itself, because its answers to them are a published contract — the forms plugin's `forms/submit`, whose "not accepting" notice, per-(site, address) limit, monthly ceiling and lockdown placement are its own, and which is judged by the switch of the plugin whose door a submission came through. The tenant dispatcher hands such a route the request untouched: no cross-origin check, no site read from the body, no enablement or release gate, no lockdown, no write limit, no card velocity. Declaring it takes all of those on, so it is honored only for a first-party plugin's registration under the loader's marker; anyone else's keeps the dispatcher's gates and the drop is logged. The console's dispatcher does not read it. |
| `handler` as `(req, res)` or `{ web }` | The node shape takes `PluginApiRequest` / `PluginApiResponse`. The Web shape, `{ web: (request, { params }) => Response }`, takes the dispatcher's own `Request` and answers a `Response` — the form for a door that streams (server-sent events, a chat answer) or reads the raw body itself; `params` carries the path segments and every `:name` filled. |
| `PluginApiRequest` | `{ method, query, body, headers, rawBody? }` — `rawBody` carries the unparsed payload for Stripe/Svix signature verification. |
| `resolvePluginApiMatch(path)` / `runPluginApiMatch(match, request, params, runLegacy)` | What a dispatcher does: the route and its filled `:name` params for a path, then either shape run — the host app supplies `runLegacy` for the node shape. `resolvePluginApiRoute(path)` answers the node handler alone, for the specs that drive one directly. |

## Customer REST API resources — `api-v1-resources` (data layer, console server)

A plugin that models records an integration reads and writes serves them on
the customer REST API, `/v1/<resource>/…`, from its
`consoleServerDeclarations`, with the handler loaded on the first request:

```ts
registerApiV1Resource(
  'bookings',
  {
    handle: async (request, ctx, segments, url) =>
      (await import('./server/api-v1/bookings')).handleBookings(request, ctx, segments, url),
    entitlement: { feature: 'bookings', message: 'Bookings are not included in this organization’s plan' },
  },
  { pluginId: 'acme-bookings' },
)
```

| API | Semantics |
| --- | --- |
| `registerApiV1Resource(resource, { handle, entitlement? }, { pluginId? })` | Serves every request under `/v1/<resource>`. The name is one lowercase path segment; the platform's own resources (`sites`, `media`, `usage`, `me`) and a resource another plugin already serves are refused, naming both, and the incumbent keeps serving. The same plugin registering again replaces its own. |
| `apiV1Resource(resource)` | What the router asks after the platform's own resources: the serving plugin and its registration, or `null`. A name nobody registered is asked once more after the app's declarations step runs, so a process whose boot failed repairs itself rather than answering `404`. |
| `handle(request, ctx, segments, url)` | Runs after the pipeline admitted the request — the API key, the plan's API access, the request quota, the rate limit. `ctx` is the `ApiV1Context`; the handler asks for its own scopes with `requireScope` and answers in the published envelope (`apiJson`, `ApiErrors`). |
| `entitlement` | The plan feature the resource needs. The router refuses an organization without it — `402 plan_required`, the feature as the `code`, the registration's sentence as the message — before the handler runs and before any scope is asked, so a key minted while the plan carried the feature cannot outlive it. |
| `describe` | Loads the resource's description — tag, record schema, writable members, operations — in the terms of `@aglyn/tenant-data-admin/server/api-v1-description`. The OpenAPI document at `/api/v1/openapi.json`, and the MCP tools derived from it, list every resource the build serves and nothing it does not; a description that fails to load is left out and logged. `apiV1Resources()` lists the registrations, and the API root's `resources` names them. |
| `registerApiV1SiteResource(resource, { handle, entitlement?, describe? }, { pluginId? })` | Serves every request under `/v1/sites/{siteId}/<resource>` — a site's own records, as the forms plugin serves `form-submissions` and commerce `orders` and `products`. The router answers the site itself and refuses a site the key's organization does not own (`404 No such site`) before it asks any registration, so the handler is handed only a site its caller may reach, with the whole path in `segments`. Refused, as at the top level: a name that is not one lowercase path segment, the platform's own (`media`, `publish`) and a resource another plugin serves. `apiV1SiteResources()` lists them; they are not listed at the API root, which names top-level resources only. |
| `registerApiV1UsageFigures(read, { pluginId? })` | Adds the plugin's members to `GET /v1/usage` — a band its records are metered on, the sizes an integration plans a sync by — read with the platform's on every call (`usageBand` gives one its published shape). A member the platform or another plugin already names is dropped and logged. |

The helpers every handler shares — `claimWrite` (the idempotency claim),
`paginate`, `serialize`, `readJsonBody`, `orgOwnsHost`, `requireScope` and
`usageBand` —
are `@aglyn/tenant-data-admin/server/api-v1-kit`'s, so a cursor or an
idempotency key means the same thing on every resource whoever serves it.

## Site pipeline — `site-runtime`, `site-page-hooks` (`/server` for hooks)

| API | Semantics |
| --- | --- |
| `registerSiteRuntime({runtimeId, Component})` | Components rendered on every published page (overlay engines, experiment runners); they read back the props their server enricher wrote. |
| `registerSiteRedirectResolver(fn)` | Runs before route resolution; first non-null redirect wins. |
| `registerSitePageResolver(fn)` | Composes plugin-owned pages (commerce PDP/PLP). |
| `registerSitePageEnricher(fn)` | Contributes page-prop slices to every page that renders nodes — published pages, collection routes, designed auth pages and a resolver's own page alike; a resolver's keys win, and `pageData` merges per plugin. Gated screens (password-protected, members-only) enrich behind the gate and deliver the slice with their nodes. The designed 404 body sets `pathUnknown` — it is cached per host, so contribute only what does not depend on a path and never substitute one. Maintenance, lockdown and bandwidth-containment notices are not enriched. **Enricher errors are isolated** — a broken plugin drops its slice, never the page. |
| `registerRepeatRowReader(sourceId, reader, { pluginId })` (`plugin-manager/repeat-rows`) | Answers the rows a published page repeats an element over: the composition calls `readRepeatRows({ hostId, keys })` with the keys its tree repeats over and renders what comes back, naming no collection itself. Register from your `serverDeclarations` entry, loading the reader with `import()` inside the function, and declare the same source in `plugins.config.json` (`"repeatSource": { "id": … }`, one plugin at most). A declared source with no registered reader is **refused, not emptied**: the app's declarations step runs once more and the render then throws, so a broken boot keeps the last good page instead of emptying every list. A key your reader cannot answer is left out, and that element renders no copies — never its raw `{{item.*}}` template. Each answer is `{ records, model? }`: the rows' value maps in display order, each with its `$id`, and `model.references`, which maps a reference field's id to the key its target rows are answered under — the one thing a `{{item.ref.field}}` hop reads, so answer the target's rows under that key too. The editor's canvas preview is the separate `registerRepeatSource` (`app-utils/repeat-sources`); give that source an `entityKind` naming the entity picker kind its keys are, and the insert-token menu inside a repeat offers `{{item.<field>}}` for each field the picker reports for that entity (`entityFields`). |
| `registerFormRecordTarget({ stamp, write }, { pluginId })` (`plugin-manager/submission-record-target`) | Makes your plugin the place a form's submissions are also filed as records. `stamp(nodes, hostId)` runs on the tree a page ships and marks each form you write for with whatever you will trust when it comes back — the submit route is public, so never trust the body alone; `write({ hostId, orgId, orgBilling, body, fields })` runs after the submission is stored and answers the `routing` note the Inbox shows (where it went, or why not). Register from `serverDeclarations` with the work behind `import()`, and declare `"formRecordTarget": { "id": … }` in `plugins.config.json` (one plugin at most). A declared target that is not registered fails loud: a page with a form throws at render, and a submission is kept with `routing.recordTargetUnavailable`. |

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

A claiming handler may also return the site the record belongs to,
`{ claimed: true, hostId }`. The platform reads it on a card's fraud signals
(`radar.early_fraud_warning.created`, `review.opened`, `charge.dispute.created`):
the seller's fraud-pattern row names the sites the charges were for, whatever
plugin sold them. To show a fraud signal on your own record, use
`paymentRiskEventFrom` from `@aglyn/aglyn/app-utils/payment-risk` to read the
event and `recordPaymentRiskOnRecord` from
`@aglyn/tenant-data-admin/server/payment-risk-record` to stamp the shared
`paymentRisk` field and notify the site's managers once. Render it with
`describePaymentRisk`. Never refund or cancel on a signal; the merchant decides.

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

## Service contracts — `plugin-services`

The typed registry one plugin opens for others to fill. `registerBillingWebhookHandler`
and `registerSiteRuntime` are the precedent — one registry per seam, filled at
registration, read lazily — and this is that shape with the implementation
TYPE carried on a token, so a seam a plugin invents needs no core module.

| API | Semantics |
| --- | --- |
| `definePluginServiceContract<T>(id, { multiple })` | Declares a contract token. `multiple: true` is a set every implementation joins; `false` is a slot one plugin holds. Idempotent by id; redefining with a different `multiple` throws. |
| `registerPluginService(contract, impl, { pluginId?, priority? })` | Registers an implementation. Owner = the loader's marker inside a register fn, else `pluginId` (module scope runs before the marker is set); no owner throws. An unknown contract throws. The same plugin re-registering replaces its entry; on a single contract a **different** plugin throws naming both, and the incumbent keeps serving. |
| `resolvePluginServices(contract)` / `resolvePluginService(contract)` | Every implementation, highest `priority` first and registration order within a priority — or the first one. |
| `hasPluginService(contract)` / `unregisterPluginServices(pluginId)` / `resetPluginServicesForTests()` | Presence, a plugin unloading, and the spec reset. |

Worked example — the AI plugin declares its provider contract and a
marketplace plugin adds a provider:

```ts
// libs/plugins/ai — the seam's owner
export const AI_PROVIDERS = definePluginServiceContract<AiProvider>('ai.provider', {
  multiple: true,
})
registerPluginService(AI_PROVIDERS, anthropicProvider, { pluginId: 'ai' })

// a marketplace plugin — an adopter; it imports the token, never the plugin's internals
registerPluginService(AI_PROVIDERS, ollamaProvider, { pluginId: 'acme-llm', priority: 5 })

// back in the AI plugin, at call time
const providers = resolvePluginServices(AI_PROVIDERS) // acme-llm first, then ai
```

## Zones a plugin hosts — `plugin-zones`

`CONSOLE_WIDGET_SLOTS` is the catalog of zones the console SHELL draws, and a
slot id has always been an open string — so a plugin could already host a zone
of its own on a page it owns. What it could not do is say what that zone HANDS
a widget. A zone token carries the props type, so the plugin declares both.

```ts
// the plugin that HOSTS the zone — it draws `useConsoleWidgetSlot()` itself
interface BottleDetailZoneProps {
  hostId: string
  bottle: { id: string; name: string; vintage: number }
  /** Stages a tasting note as an unsaved edit; the page's Save is the write. */
  proposeNote: (note: string, key: string) => void
}
export const BOTTLE_DETAIL = definePluginZone<BottleDetailZoneProps>('bottleDetail')

// from its register fn, where the loader's owner marker is set
registerPluginZone({
  zone: BOTTLE_DETAIL,
  label: 'Bottle detail',
  surface: 'console',
  description: 'A widget here proposes a tasting note; the page saves it.',
})

// ANOTHER plugin's widget — it imports the token, never the owner's model
function Suggestion(props: PluginZoneProps<typeof BOTTLE_DETAIL>) { … }
registerConsoleExtension({ widgets: [{ slot: 'bottleDetail', Component: Suggestion }] })
```

| API | Semantics |
| --- | --- |
| `definePluginZone<Props>(id)` | The token. Pure — it registers nothing and reads nothing — so a plugin may define it at module scope and register it from its register fn. |
| `registerPluginZone({ zone, label, surface, description?, layout? }, { pluginId? })` | Publishes it. Owner = the loader's marker inside a register fn, else `pluginId`; no owner throws, and a zone id another plugin declared throws naming both while the incumbent keeps its zone. The same plugin re-declaring replaces its own. |
| `layout` | `stack` (the default): the zone is one block of the page, its widgets are cards, and it takes no room when nothing drew. `bare`: the zone adds no element, because each widget is one item of a layout the HOST draws — a button in a row of actions, a control beside a form's fields, a dialog that portals out. The shell reads it for a plugin-hosted zone; the core catalog's zones keep the layouts the console gives them. |
| `listPluginZones()` / `pluginZone(id)` / `pluginIdForZone(id)` | Every declared zone with its owner, one by id, and the owner alone. |
| `PluginZoneProps<typeof ZONE>` | The props type, off the token. |

**A token ships nothing.** It is `{ id }`, and `__props` never holds a value —
the props are carried at the type level and erased. That is load-bearing, not
tidy: the zone catalog is on the published page's static graph, so a
declaration that put prop SHAPES there would make every published page carry
the console's vocabulary. Import this module by its own subpath
(`@aglyn/aglyn/plugin-manager/plugin-zones`); it is not in the barrel.

## Host subcollections — `plugin-host-collections`

A plugin writes ordinary documents under `hosts/{hostId}`, and three core
surfaces have to know which plugin owns which: the media-usage scan, a
reference row's deep link, and the site's artifact counters.

```ts
registerPluginHostCollections([
  { name: 'bottles', routeSlug: 'cellar', artifact: true },
  { name: 'tastings', label: 'Tasting note', routeSlug: 'cellar' },
  {
    name: 'cellarTemperatures',
    mediaScan: 'none',
    mediaScanReason:
      'One reading per sensor per minute, none of which can hold an asset ' +
      'reference: scanning it would cost the whole sweep and find nothing.',
  },
])
```

| API | Semantics |
| --- | --- |
| `registerPluginHostCollections(collections, { pluginId? })` | One collection has one owner: a name another plugin declared throws naming both, and refuses the WHOLE call — half a plugin's storage map landing is worse than none. Re-registering replaces that plugin's own. |
| `mediaScan` | `generic` (the default) flattens each document and searches it; `own` means a pass that knows its shape already reads it; `none` needs `mediaScanReason`, and a declaration without one is refused. |
| `pluginHostCollectionsScannedGenerically()` / `pluginHostCollectionsExcludedFromMediaScan()` | What the scan reads, and what it skips with the reason given. |
| `pluginHostCollectionRouteSlug(name)` / `pluginHostCollectionLabel(name)` | A reference row's deep link and its wording. The label is derived from the name when the owner declares none (`productCategories` → "Product category"), so a new collection reads correctly with no second list. |
| `pluginHostArtifactCollections()` | The collections whose documents a site counts beside its pages, layouts and components. |
| `listPluginHostCollections()` / `pluginHostCollection(name)` / `pluginIdForHostCollection(name)` | Everything declared, one by name, and its owner. |
| `listPluginOrgCollections()` / `pluginOrgCollection(name)` / `pluginOrgCollectionsScannedGenerically()` | Storage that lives on the ORGANIZATION (`orgs/{orgId}/…`) rather than on a site, declared by a first-party plugin in the `orgCollections` block of `plugins.config.json` and compiled, with no runtime door. Scanned by default like a host collection (`mediaScan` is `generic` or `none`); `siteField` names the document field that says which site a row belongs to, so a reference row can name the site and link into its hub. Marketing's email sends are the first: `orgs/{orgId}/campaigns`, each carrying `hostId`. Deleting a site deletes the documents that name it. `holdsTransferWhile: { field, values }` (needs `siteField`) names the states in which such a document is work still in flight — Marketing's is `status` in `scheduled` or `sending` — and staff cannot move the site to another organization while any matches. |

**The default is to scan**, and a declaration says only why it should not be.
That is inverted on purpose: "does this carry media?" needs a judgment about a
schema nobody wrote down, and a collection nobody has thought about is READ, so
a plugin shipping a media-bearing collection is covered the day it lands. A
declaration names no FIELDS — the scan flattens generically, and a field list
would be the same staleness trap one level down.

### Creating a document — `resource`, and `plugin-host-resources`

Clients create quota-governed site documents through one platform route,
`POST /api/hosts/resources`: the security rules refuse a client `create` on
those collections, and the route holds the field allow-list, meets the plan
count inside the write's transaction, and stamps who made the document. A
first-party plugin whose collection is created that way declares the KIND
beside the collection, in the `hostCollections` block of `plugins.config.json`:

```json
{
  "name": "bottles",
  "routeSlug": "cellar",
  "resource": {
    "kind": "bottle",
    "label": "bottles",
    "activityNoun": "bottle",
    "quotaKey": "bottlesPerHost",
    "entitlement": "cellar",
    "fields": ["name", "vintage", "notes"],
    "duplicate": { "nameField": "name", "fields": ["vintage", "notes"] }
  }
}
```

| Field | Semantics |
| --- | --- |
| `kind` | What a caller names as `resource`. One owner per kind, and none of the platform's own (`screen`, `template`, `layout`, `reusableComponent`, `form`, `entry`, `author`). |
| `fields` | The keys a client may send; anything else is dropped. `createdAt`, `updatedAt`, `createdBy` and `deletedAt` are never on it — the server stamps them. |
| `quotaKey` / `entitlement` | The plan counter and feature, as KEYS the platform's plan table resolves. A declaration carries no number. |
| `platformCap` | A flat cap no plan varies, named by the platform constant that holds it (`ACTIONS_MAX_PER_HOST`). A kind needs this or a `quotaKey`: a create nothing counts is unbounded documents from a browser. |
| `softDeletes` | Deleting stamps `deletedAt`, so the cap counts live documents. |
| `requiresPublishRole` | Creating needs the publishing role rather than the write role — for a kind that changes the live site the moment it exists. |
| `stamps` | Constant values every create writes, never from the client (`"deletedAt": null` for a kind born live). |
| `externalDestination: { field, approvedByField }` | A destination that may leave the site: when it is not a site path, the creator's verified uid is stamped into `approvedByField`. Only with `requiresPublishRole`. |
| `livePathField` | The site path the document answers at; a create drops it from the site cache. |
| `duplicate: { nameField, fields, stamps? }` | How a whole copy is made: a subset of `fields`, a unique name, and what the copy is born with (a cleared trigger). |

The declarations are COMPILED, not registered: the route and the duplicator
read them with no plugin loaded, and a kind nobody declared is refused as an
unknown resource — never written with an open field list. The generator checks
every rule above; `registerPluginHostCollections` refuses a declaration that
carries a `resource`. `listPluginHostResources()` / `pluginHostResource(kind)`
(`@aglyn/aglyn/plugin-manager/plugin-host-resources`) read them.

### In the site backup — `siteExport`, and `plugin-site-export`

A site admin on a plan with site export downloads one JSON bundle of the
site and restores it later, into the same site or another. The platform's own
documents are always in it. A plugin collection is in it only when the
collection says so, beside its `resource`:

```json
{
  "name": "bottles",
  "resource": { "kind": "bottle", "quotaKey": "bottlesPerHost", "…": "…" },
  "siteExport": {
    "limit": 100,
    "fields": ["name", "vintage", "notes", "cellarId"]
  }
}
```

| Field | Semantics |
| --- | --- |
| `limit` | The most live documents one bundle carries (1–1000). The export reads no more, and a restore writes no more. |
| `fields` | The keys a restore writes back, with `merge: false` — so it is every key a LIVE document carries, not what a create sends, and a key left off is erased from every restored document. `createdAt`, `updatedAt`, `createdBy`, `deletedAt`, `visibleTo` and an external destination's approver field are refused: a restore stamps or scopes them itself. |

The export writes the collection's live documents under the collection's name,
and a restore writes them back by id and counts the result against the
`resource` — its `quotaKey`, or its `platformCap` — before the first write,
so a `siteExport` on a collection with no `resource` is refused. A collection
may not take a key the platform's bundle already uses (`screens`, `media`,
…) or another plugin's. Compiled like `resource`, and refused at runtime:
`listPluginSiteExportCollections()`
(`@aglyn/aglyn/plugin-manager/plugin-site-export`) reads them.

## Site backup sections — `plugin-site-bundle` (`/server`)

Some plugin data a backup must carry is not a plain host collection: it lives
under the organization and is narrowed to the site, it has documents beneath
it, a restore checks it against its own model, or its count is sold as an
add-on. The plugin declares a SECTION of the bundle in `plugins.config.json`
and answers for it from its `serverDeclarations` entry:

```json
"siteBundleSections": [{ "key": "cellarLogs", "limit": 50 }]
```

```ts
registerPluginSiteBundleSection(
  'cellarLogs',
  {
    export: async (request) => (await import('./server/backup')).exportLogs(request),
    refusal: async (request) => (await import('./server/backup')).logsRefusal(request),
    import: async (request) => (await import('./server/backup')).importLogs(request),
  },
  { pluginId: 'acme-cellar' },
)
```

| API | Semantics |
| --- | --- |
| `export({ hostId, orgId, limit })` | The site's share, at most `limit` items, each a document with its `$id` and whatever it carries beneath it. Read whole or throw: a short list is a backup that lies. `orgId` is `null` for a site with no organization. |
| `refusal({ …, org, items })` | Optional. Asked before the restore writes anything, with the bundle's items already capped at `limit`; answers the sentence the restore refuses with (403), or `null`. Sections are asked before the platform's own caps. |
| `import({ …, write, stamps, loadPluginSurfaces })` | Writes the items back through `write(documentPath, data)` — whole documents, on the restore's batches and in its count, and only under the site's or its organization's tree — dated with `stamps()`. `loadPluginSurfaces()` loads every plugin's console server surface, for a check against something other plugins register there (a custom field type). Answers the rows the restore reports without refusing. |
| `listDeclaredSiteBundleSections()` / `resolveSiteBundleSections()` | The declarations, and the declarations joined to their registered answers. A section declared and not registered runs the app's declarations step once; still missing, `resolveSiteBundleSections` throws, and the export or restore fails rather than leaving the section out. |

One owner per key, never one the platform's bundle or a host collection's
`siteExport` already uses, a `limit` from 1 to 1000, and a plugin with a
`serverDeclarations` entry — the generator refuses anything else. The data
plugin's `datasets` is the first.

## Import and export — `plugin-transfer-resources`

Everything a person imports or exports is a transfer RESOURCE: rows in a file
(`records`) or a set of items carried as a package (`package`). The matching,
cell reading, conflict policy and dry run are the core's
(`@aglyn/aglyn/data-transfer`, see `docs/DATA_TRANSFER.md`); the plugin that
owns the records declares the resource and answers for it. Declare it in
`plugins.config.json`, in the core's `TransferResourceDescriptor` shape:

```json
"transferResources": [
  {
    "key": "bottles",
    "label": "Bottles",
    "singularLabel": "Bottle",
    "scope": "org",
    "kinds": ["records"],
    "formats": ["csv", "json", "ndjson"],
    "limits": { "maxRows": 5000 }
  }
]
```

| Field | Semantics |
| --- | --- |
| `key` | Lowercase words joined by `-` or `.`, at most 64 characters; one owner per key. The URL and storage name. |
| `label` / `singularLabel` / `description` | What the hub and the wizard call it. |
| `scope` | `org` (the workspace's records) or `host` (one site's). |
| `kinds` | `records`, `package`, or both. |
| `formats` | `csv`, `json`, `ndjson`. |
| `limits` | `maxRows` (and optional `maxBytes`) one file may carry. |

The plugin also lists `transferResources` among its `contributes.console.slots`
(`TRANSFER_RESOURCES_LOAD_POINT`), so the wizard loads its console registrar,
and names a `serverDeclarations` or `consoleServerDeclarations` entry — the
generator refuses the declaration otherwise. It registers two halves.

**The server half**, from its declarations entry:

```ts
registerPluginTransferResource(
  'bottles',
  {
    fields: async (ctx) => (await import('./transfer/bottles')).bottleFields(ctx),
    matchKeys: [{ fieldId: 'id', normalizer: 'aglynId' }, { fieldId: 'sku', normalizer: 'caseless' }],
    readPage: async (ctx, cursor, fieldIds, options) =>
      (await import('./transfer/bottles')).readBottles(ctx, cursor, fieldIds, options),
    lookup: async (ctx, requests) => (await import('./transfer/bottles')).lookupBottles(ctx, requests),
    apply: async (ctx, chunk, writer) => (await import('./transfer/bottles')).applyBottles(ctx, chunk, writer),
    revert: async (ctx, snapshot, decisions) =>
      (await import('./transfer/bottles')).revertBottles(ctx, snapshot, decisions),
  },
  { pluginId: 'acme-cellar' },
)
```

| Hook | Semantics |
| --- | --- |
| `fields(ctx)` | The field catalog as `TransferCatalogInput` — standard, the organization's custom fields, derived and system fields, and groups. `transferResourceCatalog` builds it with the core and refuses one `transferFieldProblems` rejects. |
| `matchKeys` | `MatchKeySpec[]`, in priority order — the keys a row finds its record by. At least one. |
| `aliases` | Optional `TransferAliasDictionary[]`: other products' header spellings for these fields. |
| `readPage(ctx, cursor, fieldIds, { pageSize, ids, filter })` | One export page, `{ rows, next }`, each row keyed by field id and holding only `fieldIds`. `cursor` is `null` for the first page and `next` `null` after the last. |
| `lookup(ctx, requests)` | The records holding each requested key value: `{ lookup: MatchLookup, records }`, with each found record's current values for the plan's before → after. |
| `plan(ctx, input)` | Optional; the core's `buildTransferPlan` otherwise (`planTransferResourceRows`). |
| `lockedRules(ctx)` | Optional `TransferLockedRule[]`, shown locked in the wizard with their reasons. |
| `invariants` | Optional rules a planned row must keep, each `{ id, label, check(row, before) }` answering why the row breaks it or `null`; `transferInvariantFailures` checks every writing row. |
| `apply(ctx, chunk, writer)` | Writes one chunk of planned rows through the plugin's OWN write paths, so plan bands, consent rules and activity entries hold. Skips a row `writer.alreadyApplied(row)` answers for, calls `writer.markApplied(result, undo)` the moment each write lands, and stops at a row boundary when `writer.timeLeftMs()` runs short. Answers `{ results, undo }`. |
| `revert(ctx, snapshot, decisions)` | Reverses a chunk's writes, deciding each entry with the core's `planTransferUndo`; a conflict is carried out only when `decisions[recordId]` is `revert`. Answers `{ done, conflicts }`. |
| `items(ctx)`, `dependencies(item)`, `remapIds(item, idMap)`, `readItems(ctx, ids)`, `writeItems(ctx, items, writer)` | A `package` kind's hooks: what is held now, an item's references, the item with references rewritten (`idMap` keyed `<kind>/<id>`), the content to export, and the decided items written through the plugin's paths. |

Registration is refused with no owner, for a key nobody declared or another
plugin declared, for a declaration the core's `transferResourceProblems`
rejects, and naming every hook a declared kind lacks.

**The client half**, from its console registrar:

```ts
registerPluginTransferResourceUi('bottles', {
  label: 'Bottles',
  icon: { path: mdiBottleWine },
  extraSteps: [{ id: 'vintages', label: 'Vintages', after: 'values', component: VintagesStep }],
})
```

An extra step follows one of the core's steps (`upload`, `mapping`, `values`,
`matching`, `conflicts`, `dryRun`, `apply`) and is handed
`{ resource, orgId, hostId, jobId, setComplete }`; `transferWizardSteps(key)`
answers the full order.

| Reader | Semantics |
| --- | --- |
| `listDeclaredTransferResources()` / `declaredTransferResource(key)` | The compiled declarations. |
| `listTransferResourcesFor({ scope, org, host?, isFlagOn?, staffBypass? })` | The resources of one scope whose plugin runs for the workspace (`org`) or the site (`host`), and whose release flag is on when a verdict is passed. |
| `resolveTransferResource(key)` / `resolveTransferResources()` | A declaration joined to its server half. A resource declared and not registered runs the app's declarations step once; still missing, it throws `TransferResourceUnavailableError` (`reason: 'unregistered'`), and a key nobody declares throws it with `reason: 'undeclared'`. |
| `transferRecordsHooks(resource)` / `transferPackageHooks(resource)` | The hooks of a declared kind, typed; throws for a kind the resource does not declare. |
| `pluginTransferResourceUi(key)` / `listPluginTransferResourceUis()` | The client halves. |

`apps/console/specs/plugin-contributions-declared.spec.ts` holds both halves
to the declaration: every console registrar runs and the client halves must
be exactly the declared resources, and the server declarations run and every
declared resource must resolve.

## Sitemap sections — `plugin-sitemap-sections`

A site's `/sitemap.xml` is an index over one child per section. The pages,
content collections and authors are the platform's; a plugin whose documents
are pages of their own declares the section they fill, in a
`sitemapSections` block of `plugins.config.json`:

```json
"sitemapSections": [
  {
    "section": "bottles",
    "collection": "bottles",
    "where": { "field": "status", "equals": "listed" },
    "enabledBy": { "doc": "settings/cellar", "field": "bottleScreenId" },
    "path": "/cellar/{slug}",
    "skipWhen": "deletedAt",
    "lastmod": ["updatedAtMs", "createdAtMs"]
  }
]
```

| Field | Semantics |
| --- | --- |
| `section` | The child's path segment, `/sitemaps/{section}/{page}.xml`. One owner per section, and never `pages`, `authors` or a `content-` collection's. |
| `collection` / `where` | The host subcollection whose documents are the pages, and the one equality they must meet. |
| `enabledBy` | A `collection/doc` under the site and a field that must be set — the template the pages render through. Unset, the section is left out rather than listing addresses that 404. |
| `path` / `slugField` | The page's address with one `{slug}`, and the field holding it (`slug` by default). A row with no slug addresses nothing and is left out. |
| `skipWhen` | A field whose truthy value leaves the row out — a soft delete the filter cannot see. |
| `lastmod` | The fields a row's date is read from, first present wins. |

The sections are COMPILED, not registered: the sitemap is what a search engine
is told the site holds, and a section missing from a process that had not
loaded the plugin would read to a crawler as pages that no longer exist.
`listPluginSitemapSections()` / `pluginSitemapSection(section)` read them.

## Sitemap readers — `plugin-sitemap-readers`

A section above is the documents of one site collection at one fixed path. Some
pages are neither: a dataset's record pages live in the ORGANIZATION's data, at
a base each site picks, and a site may have several record templates, each its
own set of pages. A plugin like that answers in code. It declares a section
FAMILY in a `sitemapReaders` block of `plugins.config.json`:

```json
"sitemapReaders": [{ "section": "records" }]
```

and registers the family's reader from its `serverDeclarations` entry, with the
reads behind `import()`:

```ts
registerPluginSitemapReader(
  'records',
  {
    children: async ({ hostId }) => [{ key: 'services', urls: 42 }],
    urls: async ({ hostId, key, page, perPage }) => [
      { path: '/services/roofing', lastmod: updatedAtMs },
    ],
    listings: async ({ hostId }) => [{ name: 'Services', base: 'services', count: 42 }],
  },
  { pluginId: 'data' },
)
```

| API | Semantics |
| --- | --- |
| `children({ hostId })` | The family's children on this site, in the order the index lists them. Each `{ key, urls }` is one child sitemap, `/sitemaps/{section}-{key}/{page}.xml`, sized by `urls` (at most that many). A key is lowercase letters and digits joined by hyphens, at most 120 characters; a run of two hyphens spells a path separator (`services--residential`). A key that breaks the rule is skipped. |
| `urls({ hostId, key, page, perPage })` | One page of one child: `{ path, lastmod? }` rows, `path` site-absolute (`/services/roofing`), `lastmod` anything the sitemap's date reader takes. The route makes each path absolute, drops one that does not start with `/`, and keeps at most `perPage`. |
| `listings({ hostId })` | Optional. The page groups `/llms.txt` names: `{ name, base, count }`. A group links to the page published at its base when there is one, and to the sitemap otherwise; a group with no pages is left out. |
| `registerPluginSitemapReader(section, reader, { pluginId? })` | The owner is the plugin whose register fn is running, or `pluginId`; with neither, or with a plugin other than the one that declared the family, it throws. Re-registering replaces the owner's reader. Returns the unregister. |
| `listPluginSitemapReaders()` | The compiled declarations, `{ section, pluginId }`, in config order. |
| `pluginSitemapReader(declaration)` | The registered reader. A declared family with no reader runs the app's declarations step once, then throws `PluginSitemapReaderUnavailableError`. |
| `pluginSitemapChildSection(section, key)` / `parsePluginSitemapChildSection(name)` / `isPluginSitemapChildKey(key)` | Build a child's section name, read one back (the longest declared family wins), and check a key. |

**An absent reader is not "no pages".** A crawler reads a section missing from
the index as pages that no longer exist, so the sitemap route treats a throw —
from the lookup or from the reader — as a degraded answer and keeps its cached
copy rather than shipping a smaller index. `/llms.txt` drops a failing family's
groups and keeps the rest of the file. The generator holds a declaration to one
owner per family, a lowercase word with no hyphens that is none of the
platform's sections, no `content`, no prefix of a collection section, and a
plugin with a `serverDeclarations` entry. Reach it by its own subpath,
`@aglyn/aglyn/plugin-manager/plugin-sitemap-readers`, never the barrel. The data
plugin's `records` family is the first: one child per record template,
`records-{base}`.

## Pages a publish refreshes — `plugin-live-paths` (`/server`)

A publish drops the cached pages it changed, and finds them through the site's
routing map: screen id to address. A page a plugin serves through a site page
resolver is not in that map — a record template draws every record page, yet its
own entry is an address that serves nothing. So the plugin says which addresses
it serves from a site's screens:

```ts
registerPluginLivePaths(
  async (request) =>
    (await import('./server/live-paths')).livePaths(request),
  { pluginId: 'data' },
)
```

| API | Semantics |
| --- | --- |
| `registerPluginLivePaths(reader, { pluginId? })` | One reader per plugin, registered from `serverDeclarations`. The owner is the running register fn's plugin, or `pluginId`; with neither it throws. Re-registering replaces the owner's reader. Returns the unregister. |
| `PluginLivePathsReader` | `({ hostId, screenIds? }) => Promise<string[]>`. With `screenIds`, the addresses the plugin serves FROM those screens; without, every address it serves on the site. Answer site-absolute paths (`/services/roofing`). |
| `pluginLivePaths(request)` | Every registered reader's answer, deduplicated, a path that does not start with `/` dropped, at most `PLUGIN_LIVE_PATHS_MAX` (200) from each plugin. An empty `screenIds` asks nothing. Never throws: a failing reader is logged and skipped. |

The console asks on a page, layout or component publish (with the screens it
affected), on a whole-site publish through the REST API, and when a site is
locked down (without screens, so a locked site stops serving those pages too).
Best effort by design: the publish has already succeeded, the tenant caps the
paths it accepts, and the site's data tag, which every publish busts, still
refreshes anything missed on its next visit. Reach it by its own subpath,
`@aglyn/aglyn/plugin-manager/plugin-live-paths`. The data plugin's reader answers
a record template's pages.

## The record a page is drawn for — `page-record-sources` (console)

A record template renders once per record on the published site, with its
`{{item.*}}` tokens filled from the routed record. The Besigner's canvas has no
routed record, so a plugin that serves pages per record tells the editor which
record to draw the page in the editor for:

```ts
registerPageRecordSource({
  id: 'datasetRecordPages',
  usePageRecord: ({ hostId, screenId }) => {
    // a React hook, called every render for the page in the editor
    return { status: 'none' }
  },
})
```

| API | Semantics |
| --- | --- |
| `registerPageRecordSource(source)` | `{ id, usePageRecord }`, replacing any source under the same id. Call it from a register fn the loader calls, never a module's top level. Returns the unregister, which removes the source only while it is still the one registered. |
| `usePageRecord({ hostId, screenId })` | A hook, called once per source for the page in the editor. Answers `{ status: 'none' }` for a page it does not serve, `{ status: 'loading' }`, or `status: 'ready'` with the page's record scope (`record`, the record's values; `model?` and `datasetsByKey?`, what a reference hop reads), a `label` ("Services"), the drawn record's `selectedId`, the `choices` a picker offers (`{ id, label }`, the drawn one included) and `select(id)` to draw another. |
| `listPageRecordSources()` / `subscribePageRecordSources(listener)` | The registered sources — the same array until the set changes — and a change listener, for the console's provider. |

The canvas lays the ready record over every element's render copy the way a
repeat lays its first record over its template; the nodes keep their tokens and
a save writes the template, and a repeat inside the page still draws its own
rows. It is the editor's side only, the counterpart of `registerRepeatSource`
for a repeat's rows. Import from `@aglyn/aglyn/app-utils/page-record-sources`.
The data plugin's source draws a record template, and its **Preview with**
picker in Page Properties calls `select`.

## Documents authored in the besigner — `besigner-documents`

Pages, layouts and components are the platform's own Besigner documents. A
plugin can keep one too — a node tree under `hosts/{hostId}/{collection}/{docId}`,
its working copies under `versions/{versionId}` and the published copy on the
document itself — and the console serves its editor and its preview without
naming it, at `/{orgSlug}/hosts/{host}/{segment}/{docId}/versions/{versionId}/besigner`
and `…/preview`. The plugin declares the kind in a `besignerDocuments` block of
`plugins.config.json`:

```json
"besignerDocuments": [
  {
    "kind": "bottle-label",
    "segment": "labels",
    "collection": "labels",
    "noun": "label",
    "publish": { "path": "/api/hosts/labels/promote", "idField": "labelId" }
  }
]
```

| Field | Semantics |
| --- | --- |
| `kind` | What presence rooms, saved drafts and previews key on — a stored value, never renamed. One owner per kind. |
| `segment` | The URL segment under a site. The document's own page is the plugin's hub at `<segment>/<docId>` (declare `ownsSubtree` on the nav item), where the editor's Back and Close land. Never one the console routes itself (`screens`, `layouts`, `components`, `templates`, `emails`, `theme`). |
| `collection` | The host subcollection the documents live in; it must also be in the same plugin's `hostCollections`. |
| `noun` | What one is called in the editor's sentences, lower case. |
| `publish` | The console route that makes a version the one the site serves, and the body field that carries the document id. |

The editor saves the working version itself; publishing is the plugin's. It
POSTs `{ hostId, [idField]: docId, versionId }` to `publish.path`, a server
route that reads the stored version itself (nothing about the design crosses
the wire), refuses a design that breaks what the document promises, writes the
published copy and drops the live pages that place it. A refusal answers
`{ error, violations?: [{ message }] }`; the editor shows the first violation
in full with a count of the rest (`besignerPublishRefusal`). A version the site
already serves is published again when an author asks to publish with nothing
new saved, which is how the live pages are refreshed.

The kinds are COMPILED, not registered: the route resolves its segment in a
server layout that loads no plugin code, and a segment nobody declared is a
404. `besignerDocuments()` / `besignerDocumentForSegment(segment)`
(`@aglyn/aglyn/plugin-manager/besigner-documents`) read them, and
`useHostDocumentVersion` (`@aglyn/tenant-feature-instance`) reads a version.

## Entity pickers — `plugin-entity-pickers`

An element's attribute can name another record by id — the product a product
grid shows, the form a Form element files into, the dataset a repeat walks —
and the Besigner offers it as a picker of the site's records of that kind,
listed by current name and stored by id. A plugin that keeps records an
element can name declares each kind in an `entityPickers` block of
`plugins.config.json`:

```json
"entityPickers": [
  {
    "kind": "bottles",
    "attribute": "bottle-select",
    "scope": "host",
    "collection": "bottles",
    "nameField": "label",
    "where": [{ "field": "status", "equals": "listed" }],
    "singular": "bottle",
    "plural": "bottles",
    "page": "the Cellar page"
  }
]
```

| Field | Semantics |
| --- | --- |
| `kind` | The key the picker context holds the kind under (`options[kind]`, `status[kind]`, `resolved[kind]`) and a repeat source names as its `entityKind`. One owner per kind. |
| `attribute` | The attribute type (`FieldComponentType`) whose picker lists the kind. One kind per attribute type. |
| `scope` | `host` — the site's own `hosts/{hostId}/{collection}`; `orgData` — the organization's data, read where the site's data scope resolves and narrowed to what the site may use (`visibleTo` against the site's scope tokens), with anything else resolved as unavailable. |
| `collection`, `nameField` | Where the documents are and the field a document is named by; `name`, then the id, when it is empty. |
| `where` | Equality clauses applied on the server to the browse and the search alike. |
| `searchable` | The documents carry `nameTokens`/`nameLower`, so a typed query reaches past the browse window. |
| `fieldsAttribute`, `fieldsFrom` | Together: an attribute type whose options are the FIELDS of an entity of this kind an ancestor chose, and the record kind whose console list source ([Record lists](#record-lists--plugin-record-lists-console)) shares each entity's `fields` as `{ id, name }`. The plugin declares the `entityPickers` load point among its `console.slots`, so the picker provider loads its source. |
| `singular`, `plural`, `page` | The words a picker says: "No bottles yet — add one on the Cellar page". |

Core keeps the machinery every kind shares: the browse window and its probe,
the search past it, the keyed read that names a stored value outside the
window, and the demand gate that reads nothing until a picker asks. The kinds
are COMPILED, not registered: the Besigner decides whether an attribute IS a
picker from them on the panel's first render. `pluginEntityPickers()`,
`entityPickerForAttribute(type)` and `entityFieldsPickerForAttribute(type)`
(`@aglyn/aglyn/plugin-manager/plugin-entity-pickers`) read them. Commerce
declares `products`, `collections` (catalog collections only) and
`categories`, Forms declares `forms`, and Data declares `datasets` with
their fields.

## Container kinds — `plugin-containers`

A container is a document other records are FILED UNDER: a form, a screen, a
lead or a contact filed under a campaign. The member holds the edge, as an
array of container ids on its own document, so reading "what is this filed
under" costs nothing on a page that already read the record, and deleting a
member leaves nothing behind. The plugin that keeps a kind declares it in the
`containers` block of `plugins.config.json`, compiled like the collections
above:

```json
"containers": [
  {
    "kind": "tasting",
    "label": "Tasting",
    "pluralLabel": "Tastings",
    "orgCollection": "tastings",
    "nameField": "title"
  }
]
```

| API | Semantics |
| --- | --- |
| `pluginContainerKind(kind)` / `listPluginContainerKinds()` | One declared kind with its owner and its owner's catalog label, or `null` when no plugin keeps it; and every declared kind. |
| `containerMembershipField(kind)` (`app-utils/container-membership`) | The field a member holds its containers in: `<kind>Ids`. Derived, not declared, so a record page in one plugin files itself under a kind another plugin keeps by the kind's name alone. |
| `readContainerIds(record, kind)` / `readContactContainerIds(contact, groupId, kind)` / `contactContainerFieldPath(groupId, kind)` | Read a host record's membership, read one holder's filing of a contact, and the facet path to write it — a contact is shared by every site, so what one merchant filed a person under lives in that merchant's facet. |
| `normalizeContainerIds(raw)` / `containerMembershipValue(selected)` / `containerMembershipUnchanged(stored, selected)` | The cleaning every reader applies (deduped, trimmed, capped at `CONTAINER_MEMBERSHIP_CAP`), the value a save stores (an empty selection is stored as `[]`, never removed), and an order-insensitive "nothing to save". |
| `useSiteContainerOptions(kind, hostId, { enabled })` / `useOrgContainerOptions(kind, orgId, { enabled })` (`@aglyn/tenant-feature-instance`) | The containers a picker offers: the org collection the kind declares, narrowed on a site to the ones placed on it (`visibleTo`), retired ones (`deletedAt`) left out, named by `nameField`, ceilinged at fifty. Off until `enabled`; a kind no plugin keeps settles with nothing. |
| `ContainerPicker` (`@aglyn/tenant-feature-instance/components/container-picker`) | The one control that files a record: `kind`, `options`, `value`, `onChange`. Its words are the kind's labels, and an empty site is told where one is created. |
| `readOrgContainers(firestore, kind, orgId, ids)` / `listOrgContainers(firestore, kind, orgId, ceiling)` / `findOrgContainersByName(firestore, kind, orgId, name, limit)` (`@aglyn/tenant-data-admin/server/org-containers`) | The server's read of an org's containers, for a plugin that files under a kind it does not keep: one `{ id, exists, live, name, visibleTo }` per id asked, in order; a window of the kind's containers; or the ones carrying a name. Read where the declaration says, as a projection of those fields, retired ones marked rather than dropped. A kind no plugin keeps reads nothing. |

The owner removes a container by clearing its id from every member it can
name; a plugin whose members it cannot name registers a detacher
(`plugin-membership-detach`), which is handed the kind's field. The CRM
clears its leads and each site's contact facet that way, and Outreach its
sequences and enrollments.

## Record addresses — `plugin-record-routes`

Where a plugin's records are read, published by the plugin that owns them, so
no other surface spells its URLs. Keyed by RECORD KIND, like
`plugin-record-facts` and `plugin-record-timeline`: one word answers what a
record is, what happened on it, and where a person reads it.

```ts
// the owner
registerPluginRecordRoute('bottle', {
  list: ({ orgSlug, host }) =>
    host ? `/${orgSlug}/hosts/${host}/cellar/bottles` : `/${orgSlug}/cellar/bottles`,
  record(context, id) {
    const list = this.list(context)
    return list ? `${list}/${encodeURIComponent(id)}` : null
  },
  byEmail(context, email) { … },
})

// any other surface, including the console app, which may not import a plugin
const href = pluginRecordHref('bottle', { orgSlug, host }, bottleId)
return href ? <Link href={href}>{name}</Link> : <span>{name}</span>
```

| API | Semantics |
| --- | --- |
| `registerPluginRecordRoute(kind, route, { pluginId? })` | A kind another plugin publishes throws naming both; the incumbent keeps serving, and the owner re-registering replaces its own. |
| `pluginRecordHref(kind, context, id)` / `pluginRecordListHref(kind, context)` | One record's page, and the list it lives on. |
| `pluginRecordByEmailHref(kind, context, email)` / `pluginRecordFilteredHref(kind, context, filter, value)` | The optional halves: a list opened on one person's address, and a list narrowed by one of the OWNER's filters. A filter the owner does not know answers `null` rather than a list that ignores the narrowing. |
| `pluginRecordRoute(kind)` / `listPluginRecordRouteKinds()` | The route with its owner, and every published kind. |

`context` is `{ orgSlug, host }` — the two route params, both already in the URL
the calling surface renders on, so a link costs no document read. `host: null`
asks for the organization-level address. **Every answer can be `null`**: no
plugin publishes the kind, or the owner has no address at that scope. Render
text, which is what these surfaces already do while their route params settle.
A link is not access: the page at the far end applies its own gates.

The first-party kinds: `contact`, `lead`, `company`, `deal` and `task` (CRM),
`product` and `order` (Commerce), `booking` (Bookings), `formSubmission`
(Inbox), `campaign` (Marketing), `emailMessage`, `emailTemplate` and
`sendingIdentity` (Email), `form` (Forms), and `workflow`, `action` and
`webhook` (Workflows). The console's activity feeds link any of them the same
way: an entry whose target type is a published kind opens at its owner's
address. A plugin that links to another plugin's page asks for
one of these; `check:plugin-domain-in-core` refuses one that spells the other
plugin's slug or core route itself.

### Record pages, for a server — `plugin-record-pages`

A server has no console registrar, so it cannot ask the routes above. The
forms plugin's door tells a site's managers about a new submission, and the
notification's link is where they read submissions — a page another plugin
draws. The plugin whose console page shows a kind declares it in
`plugins.config.json`, and the manifest generator compiles it:

```json
"recordPages": [{ "kind": "formSubmission", "path": "/inbox" }]
```

| Field / API | Semantics |
| --- | --- |
| `kind` | The record kind, as the routes and indexes key it. One page per kind. |
| `path` | The site console path the kind is read on, under one of the declaring plugin's own console routes, or the generator refuses it. |
| `pluginRecordPage(kind)` | The declaration, or `null` when no plugin in the build shows the kind. |
| `pluginRecordPageLink(kind, hostId)` | `/{hostId}{path}`, the shape a notification's `link` takes, or `null`, in which case the notification goes without a link. |

The Inbox declares `formSubmission`.

## Record cards — `plugin-record-cards` (`/server`)

What a plugin's record looks like in one line and one image, published by the
plugin that owns it, for a surface that has to DRAW the record rather than link
to it — a designed email that features a product, a picker over what another
plugin keeps. Keyed by record kind, like the facts reader, the timeline and the
route.

```ts
// the owner, from each of its server registrars
registerPluginRecordCardReader('bottle', {
  async read({ hostId, id }) {
    const bottle = await readBottle(hostId, id)
    return bottle
      ? {
          title: bottle.name,
          caption: fromPrice(bottle), // the owner's rule, already worded
          imageUrl: bottle.labelUrl,
          path: `/cellar/${bottle.slug}`,
        }
      : null
  },
})

// any other plugin's server code
const card = await readPluginRecordCard('bottle', { hostId, id })
if (card) draw(card)
```

| API | Semantics |
| --- | --- |
| `registerPluginRecordCardReader(kind, reader, { pluginId? })` | A kind another plugin publishes throws naming both; the incumbent keeps serving, and the owner re-registering replaces its own. |
| `readPluginRecordCard(kind, { hostId, id })` | `{ title, caption?, imageUrl?, path? }`, or **`null` when no plugin publishes the kind or the record is gone**. A caller treats both alike: there is nothing to draw. |
| `pluginRecordCardReader(kind)` / `listPluginRecordCardKinds()` | The reader with its owner, and every published kind. |

**A card carries nothing a caller could compute on.** The caption is a string
the owner has already worded — a price, a date, a status — so the rule behind
it lives in one place. A caller that read the owner's document and imported its
model to agree is the coupling this replaces.

**Server-side and unauthenticated, on purpose.** A reader runs with the Admin
SDK for a caller that has already decided the read is the workspace's to make.
`plugin-record-facts` answers one MEMBER and applies their permissions; the two
are separate contracts so neither borrows the other's trust. Both apps load
every plugin's server entry before a plugin handler runs, so a reader
registered from a server registrar is there wherever a handler asks. Import it
by its own subpath (`@aglyn/aglyn/plugin-manager/plugin-record-cards`).

## Record indexes — `plugin-record-index` (`/server`)

The records a plugin keeps, LISTED and READ for another plugin that works over
them — an AI job enriching a catalog, a composer binding the products an email
names — without that plugin reaching for the owner's collection. Keyed by
record kind, like the card, the facts reader and the route; a card says how a
record LOOKS, an index finds records and reads what the owner shares about
them.

```ts
// the owner, from its serverDeclarations (so every server process has it)
registerPluginRecordIndex('bottle', {
  async list({ hostId, limit }) {
    const rows = await readBottles(hostId, limit + 1)
    return {
      records: rows.slice(0, limit).map((b) => ({ id: b.id, name: b.name, facts: { vintage: b.vintage } })),
      truncated: rows.length > limit,
    }
  },
  async get({ hostId, id }) {
    const b = await readBottle(hostId, id)
    return b ? { id: b.id, name: b.name, facts: { vintage: b.vintage } } : null
  },
})

// any other plugin's server code
const bottles = pluginRecordIndex('bottle')?.index
const { records } = bottles ? await bottles.list({ hostId, limit: 20 }) : { records: [] }
```

| API | Semantics |
| --- | --- |
| `registerPluginRecordIndex(kind, index, { pluginId? })` | A kind another plugin keeps throws naming both; the incumbent keeps serving, and the owner re-registering replaces its own. |
| `pluginRecordIndex(kind)` | `{ pluginId, index }`, or **`null` when no plugin keeps the kind here** — a reader treats that as "none here", never as a reason to read the collection itself. The `pluginId` is also how a reader asks whether the keeper is switched on for a site. |
| `index.list({ orgId?, hostId?, limit })` / `index.get({ orgId?, hostId?, id })` | Live, named records only — the owner decides what "deleted" is — each `{ id, name, facts }`, with `facts` in the shape the owner documents. `truncated` says the scope holds more. |
| `index.ref?({ orgId?, hostId?, id })` | Optional: one record's document, a Firestore Admin `DocumentReference`, for a reader that changes what the owner documents a reader may change, or keeps records of its own under it. Whether the record exists is the reader's read. The reader proves who is asking first — the index authenticates nobody. |

Import it by its own subpath (`@aglyn/aglyn/plugin-manager/plugin-record-index`).
Commerce publishes `product` and `productCategory`; Workflows publishes a site's
`workflow`, `webhook` and `action` records (a webhook's facts never carry its URL
or secret); Data publishes the workspace's `dataset` records, narrowed to a site
to the ones shared with it, with their fields, their scope tokens and the
listing an installed one came from (never a record of one), from its
console-only server declarations. The CRM publishes its `pipeline` records
with their stages, the `company` a person works for (facts: the company as
stored — name, domain, address and the rest), and its `messageTemplate`
records (facts: `{ kind, subject, body }`, the body in the CRM's merge-field
grammar). Forms publishes a site's `formSubmission`
records — the door's rows — and their documents (`ref`), which the Inbox marks
answered and keeps its replies and list assignments under. Marketing publishes
the organization's `emailSend` records (a campaign's sends, named, with the site
each is sent as and its subject), which a person's timeline names its campaign
mail by.

## Visitor doors — `plugin-visitor-doors`

A plugin that keeps a public door a visitor writes through — the forms
plugin's `/api/forms/submit` — caps a flood with a monthly ceiling and drops
what its honeypot catches, counting both per site in
`hosts/{hostId}/counters/{counter}`, keyed by `utcMonthKey()`. The site's
owner reads those counts on the Inbox, and staff on the organization's Sites
card; neither surface names the plugin or loads it. The plugin declares the
door in `plugins.config.json`, and the manifest generator compiles it:

```json
"visitorDoors": [
  {
    "door": "form",
    "refusedCounter": "formSubmissionsRefused",
    "caughtCounter": "formSubmissionsSpam",
    "words": {
      "pausedTitle": "Form submissions are paused",
      "noun": { "one": "submission", "other": "submissions" },
      "staffNoun": { "one": "form submission", "other": "form submissions" },
      "cause": "This usually means a bot is filling in one of your forms — …",
      "pausedChip": "forms paused",
      "caught": { "one": "bot submission", "other": "bot submissions" },
      "caughtBy": "the honeypot",
      "caughtChip": { "one": "bot hit", "other": "bot hits" }
    }
  }
]
```

| API | Semantics |
| --- | --- |
| `pluginVisitorDoors()` | Every declared door, with the plugin that keeps it. |
| `visitorDoorPausedNotice(door, { refused, ceiling?, now? })` | The owner's `{ title, message, until }`, or `null` below one refusal. The date the ceiling lifts is rendered in UTC, the zone the month key rolls over in. |
| `visitorDoorCaughtNotice(door, { caught })` | The month's catches as one sentence that reports protection working, or `null` below one. |
| `visitorDoorStaffFlags(door, counts, now?)` | The staff Sites card's `{ refused, caught }` flags, each a terse label and the sentence behind it, or `null`. |

The sentences are built by core from the declared nouns, because their rules
are the platform's: nothing below one, a refusal is never billed and says so,
and no date but the one the key rolls over on. The visitor's own sentence for
a refused submission stays the door's (the forms plugin's
`model/form-unavailable.ts`): it is shown to a stranger and must not say why.
The generator refuses a door or a counter declared twice, a missing word and
a noun without both its counts.

## Intake gates — `plugin-intake-gates` (`/server`)

Whether a visitor's next write through a plugin's public door would be
accepted, asked by a monitor that must not write to find out — the funnel
probe on `/api/health/funnel`, which would otherwise file fake leads, bill the
customer and notify the site's managers. The plugin that keeps the door
registers a gate under the door's name, from its server declarations:

```ts
registerPluginIntakeGate('form', async ({ hostId, host, org }) => {
  if (!isHostPluginEnabled(org, host, 'forms')) return 'switched-off'
  // …the plan's allowance and the flood ceiling, over the door's own reads
  return 'open'
})
```

| API | Semantics |
| --- | --- |
| `registerPluginIntakeGate(door, gate, { pluginId? })` | One gate per door; a door another plugin answers throws naming both. |
| `gate({ hostId, host, org })` | The door's own gates, evaluated the way the door evaluates them before its first write, writing nothing: `open`, `switched-off`, `plan-exhausted` or `flood-ceiling`. The caller hands over the site and organization documents it has read; the gate reads only what is its own. The platform's own gates — lockdown, who would be told — are the caller's to ask. |
| `pluginIntakeGate(door)` | `{ pluginId, gate }`, or `null` when no plugin keeps the door here; a caller runs the app's declarations step once before it concludes the door is shut. |

Forms gates the `form` door.

## What depends on a thing — `plugin-dependents` (`/server`)

The console's "Used by" scan (`/api/hosts/where-used`, asked through
`@aglyn/aglyn/app-utils/where-used`) tells a person what they would break by
renaming or deleting a site's variable, function or workflow. It reads the
published pages itself. What refers to the thing from inside a plugin's own
records is answered by that plugin: register a dependents source for the kinds
of thing your records point at, and the scan lists what it finds beside its
own.

```ts
// your plugin's serverDeclarations entry
registerPluginDependentsSource(
  {
    kinds: ['function'],
    find: async (request) => (await import('./server/recipe-dependents')).find(request),
  },
  { pluginId: 'cellar' },
)

// find({ hostId, kind, id, name? }) answers
// { dependents: [{ type: 'recipe', id, name, via: ['id'] }], truncated: false }
```

| API | Semantics |
| --- | --- |
| `registerPluginDependentsSource(source, { pluginId?, key? })` | `source.kinds` names the kinds it answers for; `find` answers one site's referring records. Owner = the loader's marker, else `pluginId`; no owner or no kind throws. The same plugin re-registering the same `key` replaces its own. |
| `findPluginDependents({ hostId, kind, id, name? })` | What the scan calls: every source for the kind, in registration order. `{ dependents, complete }`, and `complete` is **false** when a source was truncated or threw — the scan then never says "nothing uses this". No source for the kind is a complete, empty answer. |

A dependent's `type` is the word the scan lists it under (`variable`,
`workflow`), and `via` says how it refers: `id` survives a rename, `name` does
not. Workflows answers for a `function` (the workflows whose steps call it);
Logic answers for a `workflow` (the variables it computes), which is how the
Automation page learns what a workflow's deletion would leave on its fallback
value without either plugin importing the other.

## Record lists — `plugin-record-lists` (console)

The browser's half of the record index: the records of a kind, LISTED in the
console for another plugin's picker or check — an automation step choosing a
dataset, a reference check confirming a workflow still exists, a deal
searching the catalog — without that plugin querying the owner's collection
from the browser itself.

```ts
// the owner, from its console registrar
registerPluginRecordListSource('bottle', {
  query: (firestore, { hostId, search, limit: max }) =>
    hostId
      ? query(collection(firestore, 'hosts', hostId, 'bottles'), orderBy(documentId()), limit(max))
      : null,
  record: (id, data) => (data.deletedAt ? null : { id, name: String(data.name ?? id), facts: {} }),
})

// any other plugin's console code, with its own listener
const { data } = useFirestoreCollection(
  () => (open ? pluginRecordListQuery('bottle', firestore, { hostId, limit: 101 }) : null),
  [firestore, hostId, open],
  { idField: '$id' },
)
const bottles = pluginRecordsFromRows('bottle', data)
```

| API | Semantics |
| --- | --- |
| `registerPluginRecordListSource(kind, source, { pluginId? })` | A kind another plugin lists throws naming both; the incumbent keeps serving, and the owner re-registering replaces its own. |
| `source.query(firestore, { orgId?, hostId?, search?, memberScope?, installedFrom?, consentGroupId?, viewerUid?, limit })` | The query the signed-in member's read of the scope is proved by — the owner applies the filter its security rules require — at most `limit` documents, or `null` for a scope the kind has none in. `search` is what a person typed, matched the owner's way. `memberScope` is the reading member's own scope tokens where they are not organization-wide, for an org-scoped kind to narrow by when no site is named. `installedFrom` keeps the records installed from that listing (their install stamp's `listingId`); a kind that is never installed answers none. `consentGroupId` is the group the named site presents as, for a kind whose records say different things to different groups. `viewerUid` is the signed-in member, for a kind some of whose records are one member's own. |
| `source.record(id, data, request?)` | One stored document as the owner shares it, in the same shape its server index answers, or `null` to leave it out (deleted, unnamed, not this reader's). `request` is the one the query was built from, when the reader hands it back: a rule the query cannot state — a site's view of an org-wide row, a member's private record — is applied here. |
| `source.byIds?(firestore, { orgId?, hostId?, memberScope?, ids })` | Optional: the query for NAMED records of the scope, for a reader that already holds ids — an attribution naming the submission it credits. At most `PLUGIN_RECORD_LIST_IDS_MAX` (30, Firestore's `in` bound). A source without it reads none by name. |
| `pluginRecordListQuery(kind, firestore, request)` / `pluginRecordListByIdsQuery(kind, firestore, request)` / `pluginRecordsFromRows(kind, rows, idField?, request?)` | The reader's half: the query to listen to (or read once by name), and the rows read back through the owner — hand the request back so the owner applies what the query could not state. Each answers nothing where no plugin keeps the kind here. |
| `source.walk?(firestore, { orgId?, hostId? })` / `pluginRecordListWalk(kind, firestore, scope)` | Optional: the base a reader WALKS the kind from with the console's paged list query, which adds its own filters, order and pages over the stored fields the owner documents — for a reader that pages a whole list rather than picking from a window. Where the rules admit a read only narrowed by a field, the owner says which and the reader adds it. |
| `source.doc?(firestore, { orgId?, hostId?, id })` / `pluginRecordListDoc(kind, firestore, request)` | Optional: one record's document, for a reader that opens it whole or changes what the owner documents a reader may change; the security rules hold the rest. |

The reader runs the query with the console's own collection listener, so the
read is bounded, retried and reported like every other list. Import it by its
own subpath (`@aglyn/aglyn/plugin-manager/plugin-record-lists`). Data lists the
workspace's `dataset` records (a site's narrowed by its scope tokens, a scoped
member's by theirs), each with the listing an installed one came from, which
is how the marketplace knows what a workspace has installed; Workflows lists a
site's `workflow`, `webhook` and `action` records, Marketing lists a site's
`overlay` records (its announcement bars and popups), Commerce FINDS a
site's active `product` records by the first word typed, each with its price
and priced variants. The CRM lists the saved views of its Contacts and Leads
lists a member may list (`savedView`, with whether each can be taken whole as
an audience), its email templates (`messageTemplate`), a search of a site's
`contact` records named as the site's group knows them, and a site's `lead`
records with whether each is still open. Forms lists a site's `formSubmission` records — the
newest for a glance, a site's or every site's for the Inbox to walk, and one
submission's document for it to open, mark and delete, and by name
(`byIds`) for a campaign's conversion report grouping the ones it was credited
with by the page each was sent from.

## Record counts — `plugin-record-counts` (console)

How many of a plugin's records one site produced, counted in the console for
another plugin's figure — a campaign's conversions out of every submission,
booking, lead or contact the site holds — without that plugin counting the
owner's collection itself.

```ts
// the owner, from its console registrar
registerPluginRecordCountSource('bottle', {
  query: (firestore, { hostId }) => (hostId ? collection(firestore, 'hosts', hostId, 'bottles') : null),
})

// any other plugin: its own aggregation over the owner's query
const source = pluginRecordCountSource('bottle')
const total = source?.query(firestore, { hostId, orgId })
if (total) setCount((await getCountFromServer(total)).data().count)
```

| API | Semantics |
| --- | --- |
| `registerPluginRecordCountSource(kind, source, { pluginId? })` | One source per kind; another plugin claiming it throws naming both. |
| `source.query(firestore, { hostId, orgId? })` | The query whose count is how many records of the kind the site PRODUCED, provable by the signed-in member's read — the owner decides what that means (a site's own submissions, the leads it captured) — or `null`. |
| `source.crossesSites` | The count is the organization's, shared by every site in it (contacts), and the reader must say its total crosses sites. |
| `pluginRecordCountSource(kind)` | The source, or `null` where no plugin counts the kind here — a reader withholds its figure rather than counting the collection itself. |

Forms counts a site's `formSubmission` records, Bookings its `booking`
records, and the CRM the `lead` records a site captured and the
organization's `contact` records.

## The tenant's tax rule — `plugin-tax-profile` (`/server`)

More than one plugin takes money, and a merchant has one tax profile. The
plugin that keeps it answers the merchant's rate for a kind of charge, what a
flat rate adds to a charge and which regime a settled payment was taxed under;
any other plugin that charges asks here instead of importing the owner's model
or reading the owner's settings.

```ts
// the owner, from each of its server registrars
registerPluginTaxProfile({
  flatRate: (hostId, charge) => readStoredRate(hostId, charge),
  flatTax: (rate, chargeCents, fallbackLabel) => resolveFlatTax(rate, chargeCents, fallbackLabel),
  taxModeOf: (settledPayment, manualTaxCents) => modeOf(settledPayment, manualTaxCents),
})

// a plugin that charges
const profile = pluginTaxProfile()
const rate = await profile.flatRate(hostId, 'service')
const tax = profile.flatTax(rate, chargeCents, 'Service tax')
const total = chargeCents + tax.taxCents
```

| API | Semantics |
| --- | --- |
| `registerPluginTaxProfile(profile, { pluginId? })` | A slot: a workspace has one tax profile, so a second plugin's is refused and the incumbent keeps serving. |
| `pluginTaxProfile()` | The rule — and it **throws** when no plugin registered one. |
| `flatRate(hostId, charge)` | The merchant's flat rate for one kind of charge on a site (`service` for an appointment), read where the owner keeps it, to be handed to `flatTax`. `undefined` for a rate nobody set or a kind the owner keeps none for. The contract's one read; a caller never reads the owner's settings itself. |
| `flatTax(rate, chargeCents, fallbackLabel)` | `{ taxCents, label, pct }`, exclusive and rounded to the cent. `rate` is the merchant's stored setting passed as read; an absent, zero, negative or out-of-range one answers all-zero and never throws. |
| `taxModeOf(settledPayment, manualTaxCents?)` | The regime as the owner records it. `manualTaxCents` is tax the caller added as a line of its own, which the processor reports as none. |
| `pluginTaxProfileOwner()` | The owner's plugin id, or `null` — for a caller that only wants to know who it is. |

**No profile is a refusal, never a zero.** Every other seam here answers `null`
for "nobody home", and this one must not: a caller that read `null` as "no tax"
would charge an untaxed total and record it as untaxed, and the merchant would
owe the difference. A refused sale is seen the same day. It cannot happen in a
working build — both apps load every plugin's server entry before a plugin
handler, a cron or the billing webhook runs — and
`tax-profile-is-registered.spec.ts` in each app runs the real registrars and
holds the real rule, because a plugin's own spec may not import the owner.

## Sales on the operator's tax return — `plugin-tax-return-sources`

The operator of a deployment files a sales tax return for the sales it
FACILITATED, not only its own. If your plugin sells through the platform's own
account — tax Stripe computes against the operator's registrations lands in the
operator's balance — your sales belong on that return. The return is the
platform's: the period, the jurisdiction and registration, the verdict and the
export. What you sold, how each row classifies and who is liable for it, and
the words a preparer reads about it, are yours.

```ts
import { registerTaxReturnSource } from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'

// from your consoleApi registrar
registerTaxReturnSource({
  // One period, worded for request.filing (the jurisdiction being filed),
  // read under request.rowCap.
  read: async (request) => ({
    id: 'tickets', name: 'Ticket', title: 'Ticket sales tax', help: '…', intro: '…',
    truncated: false,      // true when you stopped at request.rowCap
    undatedRows: 0,        // rows no date range can reach
    findings: [{ id: 'ticketTaxHeld', severity: 'blocking', count: 825, label: '…', detail: '…' }],
    filingLines: [],       // lines beneath the filing figures, for request.filing.form
    tables: [], figures: [],
    exports: [{ placement: 'sections', rows: [['Ticket tax'], ['Held', '8.25']] }],
    summary, rows,         // your own figures and rows, carried whole for the audit
  }),
}, { pluginId: 'tickets' })
```

And declare it, in `plugins.config.json`:

```json
{ "id": "tickets", "taxReturnSource": true }
```

| API | Semantics |
| --- | --- |
| `registerTaxReturnSource(source, { pluginId? })` | One source per plugin; registering again replaces it. |
| `readTaxReturnSources(request)` | Every source's answer, declared sources first. **Never throws, never drops a declared source.** |
| `PLUGIN_TAX_RETURN_SOURCES` | The plugins that declared `taxReturnSource`, compiled from the config. |

**An unread source refuses the return.** A declared plugin that registered no
source, a source that threw, and an answer with a malformed finding each come
back `outcome: 'refused'`, and the return raises a blocking "do not file"
finding. So do a read that stopped at the cap and rows no period can reach,
whatever the source's own findings say. The declaration is what makes a
missing registration a refusal: a registry alone cannot tell "nothing
registered" from "nothing sold". `sales-sources-are-registered.spec.ts`
runs the real registrars through the console's manifest.

## Earnings on the operator's revenue report — `plugin-revenue-sources`

The staff revenue report states what the deployment actually kept. If your
plugin earns the operator a take — a commission, an application fee — on
sales through the platform's account, it answers for that take here: what it
earned net of everything that is not the operator's, the gross-to-net lines
that show why, and who produced it.

```ts
import {
  groupRevenueAttribution,
  registerRevenueSource,
} from '@aglyn/aglyn/plugin-manager/plugin-revenue-sources'

registerRevenueSource({
  read: async (request) => {
    // Page your own period query under the report's ceiling…
    const { docs, truncated } = await request.sweep(query, 'createdAt')
    // …group by who earned it, capped at the report's own limit…
    const byTicket = groupRevenueAttribution(entries, request.attributionLimit, 'Ticket not recorded')
    // …and name only the rows that will be shown.
    await request.nameRows(byTicket.rows, { collection: 'tickets', nameField: 'title', detailField: 'venue' })
    return {
      id: 'tickets', name: 'ticket sales',
      earned: { label: 'Ticket commission', cents, note: '…' },
      grossToNet: [/* { label, cents, deduction, note } */],
      notes: [], attribution: [{ id: 'byTicket', heading: '…', unit: 'Ticket', countLabel: 'Sales', empty: '…', ...byTicket }],
      truncated, failure: null, summary,
    }
  },
}, { pluginId: 'tickets' })
```

Declare it with `"revenueSource": true` in `plugins.config.json`. A declared
source that registered nothing, threw or answered a malformed report comes back
`outcome: 'refused'`; the report counts none of its earnings and says whose
are missing. A read that could not run at all answers `failure` rather than a
cap — "we read none of it" and "we read part of it" have different remedies.

## Installed templates — `plugin-template-sources`

If your plugin installs templates into a site's library, the template document
carries a server-managed `source.type` that says where it came from. `authored`
(saved on the site) and `starter` are the platform's own values; every other
value is the stamp of the plugin that installed the template, and that plugin
declares it in `plugins.config.json`:

```json
{
  "id": "gallery",
  "templateSource": {
    "type": "gallery",
    "label": "Gallery",
    "description": "Installed from the template gallery"
  }
}
```

Your install route stamps `source: { type: 'gallery', listingId, version }` on
every template it writes. The library's Source badge and its Source filter, the
template's own page and the "Your templates" shelf of the template gallery then
name it in your words, and the gallery's shelf asks for it by value.

| API | Semantics |
| --- | --- |
| `PLUGIN_TEMPLATE_SOURCES` | Every declared template source, compiled from the config. |
| `INSTALLED_TEMPLATE_SOURCE_TYPES` | Their `type` values. |
| `installedTemplateSource(type)` | The declaration behind a stored `source.type`, or `null` for `authored`, `starter`, a missing stamp and a type no plugin in this build declares. |
| `isInstalledTemplateSource(type)` | Whether a stamp is an installer's, declared or not. |

**A declaration, not a registration.** The gallery's shelf is a Firestore
`source.type in [...]` query, asked before any plugin code loads; a registry
the page had not filled yet would drop every installed template from it
without a word. A `type` belongs to one plugin, and `authored` and `starter`
cannot be declared. A template whose stamp no plugin in the build declares —
installed by a plugin since removed — still reads as **Installed**, never as
something the site authored.

## Installable artifact types — `plugin-artifact-types` (`/server`)

A workspace can install some content rather than author it. When the copies of
one artifact type live in your plugin's storage, your plugin keeps that type:
the installer, which owns the listing, the purchase and the provenance stamp,
asks you to read a published source, check an install and write it, and find
and update an installed copy. It never reads your collections itself. Declare
each type in `plugins.config.json` and register its owner from your
`consoleServerDeclarations` entry, with the work behind `import()`:

```json
"artifactTypes": [{ "type": "cellarList" }]
```

```ts
registerArtifactTypeOwner(
  'cellarList',
  {
    snapshot: async (request) => (await import('./server/cellar-artifact')).snapshot(request),
    admits: async (workspace) => (await import('./server/cellar-artifact')).admits(workspace),
    prepare: async (request) => (await import('./server/cellar-artifact')).prepare(request),
    locate: async (request) => (await import('./server/cellar-artifact')).locate(request),
  },
  { pluginId: 'acme-cellar' },
)
```

| API | Semantics |
| --- | --- |
| `snapshot({ orgId, sourceId })` | Publishing. Read the source the publisher named in their own workspace and answer `{ ok: true, content, facts? }`: `content` is what every install of the version receives, and `facts` are plain values the listing carries beside it. Answer `{ ok: false, status, error }` to refuse. |
| `admits({ orgId, org })` | Asked before the installer reads the listing: a refusal when this workspace's plan cannot hold one at all, else `null`. |
| `prepare({ orgId, org, listing, published })` | Installing. Validate the published content, check what the workspace may hold, make the content this workspace's, and write nothing. Answer `{ ok: true, content, commit }`: `content` is exactly what the copy will hold, which the installer records as its base snapshot. `commit({ installedFrom, source })` then writes the copy with the installer's stamp and answers `{ ok: true, report }`, the fields the install reports, or a refusal that wrote nothing. |
| `locate({ orgId, hostId, listingId, published })` | Updating. Find the copy the listing installed and answer its `current` content, the `incoming` version made this workspace's, its `installedVersion` and `baseSha`, an optional `impact` (`preview` fields shown on the update dialog, and `destructive` with the `refusal` an unconfirmed merge gets), and `apply({ content, stamp })`, the one write that takes the merged result. |
| `resolveArtifactTypeOwner(type)` | What the installer asks: `null` when no plugin declares the type, the registered owner when one does. A declared owner that is not registered runs the app's declarations step once; still missing, it throws `ArtifactTypeOwnerUnavailableError`. |
| `listDeclaredArtifactTypes()` / `declaredArtifactTypeOwner(type)` | The compiled declarations. |

Every answer comes before the installer writes anything, so an install whose
owner is missing refuses whole: no copy, no provenance, no tally. One owner
per type, a camelCase `type`, and a plugin with a declarations entry on the
console's server; the generator refuses anything else. The data plugin's
`datasetSchema` is the first: the marketplace sells a dataset's schema and
never reads the datasets collection.

## Recurring charges — `plugin-recurring-charges` (`/server`)

A security lockdown pauses the subscriptions a locked site sells to its own
customers. If your plugin sells subscriptions, declare them so a lock can
find them:

```ts
import { registerRecurringChargeSource } from '@aglyn/aglyn/plugin-manager/plugin-recurring-charges'

registerRecurringChargeSource({
  // Every subscription you sell on these sites that can still bill,
  // read from the ids YOU stored when the sale completed.
  listLiveSubscriptions: async ({ hostIds }) => [
    { subscriptionId: 'sub_…', hostId: 'host-1' },
  ],
})
```

| API | Semantics |
| --- | --- |
| `registerRecurringChargeSource(source, { pluginId? })` | Joins the `core.recurring-charge-sources` contract (multiple). Register it on the `consoleApi` surface, where the lockdown route runs. |
| `listRecurringChargeSources()` | Every declared source with its plugin id. The lockdown asks each one; a source that throws is reported as a lookup error and the others still run. |

Answer from your own records, never by searching the payment provider. The
lockdown pauses what you return with `pause_collection[behavior]=void`,
records it, and the lift resumes exactly those. You never pause, resume or
cancel anything yourself.

## Contact capture — `plugin-contact-capture` (`/server`)

A silo that meets a person — a form submission, a member sign-up, an order, a
booking — hands them to whichever plugin keeps people, instead of importing its
writer.

```ts
// the plugin that keeps people, from its server surfaces
registerPluginContactCaptureWriter(rolodexWriter)

// a silo: it declares its door once…
registerPluginContactSource({
  source: 'kiosk',
  label: 'Guest book',
  openLabel: 'Open visit',
  recordKind: 'kioskVisit',
})

// …and reports what it saw
const captured = await capturePluginContact({
  orgId, hostId,
  identity: { email: form.email, name: form.name },
  interaction: { source: 'kiosk', atMs, refId: `kioskVisits/${visitId}`, summary: 'Signed the guest book' },
  marketingConsent: form.optIn,
  surface: 'lead',
  profile: { phone: form.phone },
})
if (captured?.ok === false) log.warn(captured.reason, captured.error)
```

| API | Semantics |
| --- | --- |
| `registerPluginContactCaptureWriter(writer, { pluginId? })` | A slot: a workspace keeps one set of people, so a second plugin's writer throws naming both and the incumbent keeps serving. |
| `capturePluginContact(request)` | `{ ok: true, record: 'contact', contactId, created }` or `{ ok: true, record: 'lead', leadId, created }` — `created: false` is a returning visit — or `{ ok: false, reason, error }`, or **`null` when no plugin keeps people**. `null` and a refusal are different answers: `null` is a workspace with no record system, where nothing has gone wrong. |
| `registerPluginContactSource({ source, label, openLabel?, recordKind? }, { pluginId? })` | One source word has one owner. `openLabel` is what a link from a timeline entry says, and a door with nothing to open declares none. `recordKind` is the kind `plugin-record-routes` addresses the silo's own document by. |
| `pluginContactCaptureWriter()` / `listPluginContactSources()` / `pluginContactSource(source)` | The writer with its owner, every declared door, and one by its word. |

**A refusal is returned, never thrown.** Each of these silos has already
accepted the submission or taken the money, so a throw would cost it the thing
it was recording. `reason` is `invalid-email`, `band`, `erased` or `error`, and
`error` is customer-safe.

**`surface` says what kind of door this is, and the owner decides which record
the person lands on.** `lead` is a lead surface — a form its author routes to
leads, a booking request: the owner files a lead and no contact, unless the
workspace already holds the address as a contact. `relationship` is an act that
makes the person known — a member account, a purchase: the owner files a
contact and closes an open lead onto it. `touch`, the default, lands on the
open lead when the site holds one and on the contact otherwise. One person is
one record; the verdict's `record` says which.

**`profile` is the owner's own field names with scalar values, not a core
type.** A person's record shape belongs to the plugin that models it. So does
everything else the owner decides: normalizing and keying the address, new
person or returning visit, what a stage, an owner, a company or a tag means,
and what a new person sets off. The silo reports what it saw. Like
`plugin-record-timeline`, the registry authenticates nobody: the silo has
already decided the capture is the workspace's to record.

**`profileFill` is `profile`'s shape, written only where the record holds
nothing.** For what a door learns in passing — the phone a booking form asked
for — which must not replace a value somebody typed on the record or gave the
business before. A key `profile` also carries is `profile`'s to write. The CRM
takes `phone` from it, normalized, onto the lead or the contact the capture
lands on.

**`containers` is what the capture SURFACE is filed under, by container
kind** (`plugin-containers`, above) — `{ campaign: ids }` for a form its
merchant filed under campaigns. It is true of everybody who
uses that surface, which is what makes it a different fact from where this
visitor arrived from. The owner files the person under the kinds it keeps and
ignores the rest. Filing is not consent: `marketingConsent` is the only input
that records one.

## Conversion credit — `plugin-conversion-credit` (`/server`)

A door that produces an outcome somebody may be credited with — a form
submission, a booking, a member sign-up, an order, what a plugin's own mail
led to — asks whichever plugin credits outcomes, instead of importing its
join. One plugin registers the creditor (a slot); every door calls the
functions below, and each answers its empty value when nobody credits.

```ts
// the crediting plugin, from its server declarations
registerPluginConversionCreditor(creditor)

// a door: where the visitor arrived from, once per request…
const touch = await resolveConversionTouch({ hostId, wire: body.campaignTouch, email, atMs })
// …credited to what the door produced, and handed to the person capture
void creditConversion({ hostId, kind: 'booking', refId: bookingId, touch, convertedAtMs: atMs })
await recordCapturedContact({ …, detail: { [CONVERSION_TOUCH_DETAIL]: touch } })
```

| API | Semantics |
| --- | --- |
| `resolveConversionTouch({ hostId, wire?, email?, atMs? })` | The arrival to credit, or `null` (direct traffic, or nobody credits). Opaque: a door hands it back unread. |
| `creditConversion({ hostId, kind, refId, touch?, click?, convertedAtMs? })` | Credits one identify moment, in the door's word (`form`, `lead`, `contact`, `booking`). `click` credits a link the door's own mail carried, in place of a touch. |
| `creditOrderConversion` / `reverseOrderConversion` | An order's money, and a refund's or a lost dispute's reversal of it, keyed by the order. |
| `recordConversionClick({ email, hostId, creditTo, atMs, via? })` | A person followed a link in mail a plugin sent them; `via` is the sender's own facts (its sequence, its enrollment). |
| `creditConversionOutcome({ hostId, orgId?, containerIds, outcome, atMs? })` | What a plugin's own record produced, counted under the containers it is filed in (`plugin-containers`). |
| `eraseConversionCredits(key)` | Everything the creditor holds about a person, by `personKey`, on every site — called by the platform's address erasure beside the delivery log. |

Nothing here throws: every door has already done the thing being credited.
The first call that finds no creditor runs the app's boot step once and asks
again, as a person capture does. A door that hands its touch to the person
capture puts it under `CONVERSION_TOUCH_DETAIL` in `detail`, and the plugin
that keeps people passes it on to the contact or the lead it files.

## The kill switch — `plugin-revocations` (`/server`)

An artifact installed from a distribution channel carries the listing it came
from on its install stamp. When the platform pulls the listing or a version,
the revocation is what every reader consults; the plugin that runs the
channel keeps it, and another reader asks through this slot — the send path
before it mails a design that was installed rather than written.

| API | Semantics |
| --- | --- |
| `registerPluginRevocationReader({ revocation(listingId) })` | The plugin that keeps revocations (a slot). Answers the `PluginRevocation`, or `null` for a listing never revoked. |
| `readListingRevocation(listingId)` | The listing's revocation, or `null` — none, or nothing in this process keeps revocations (after running the app's boot step once). A reader that fails THROWS through, so the asker refuses rather than guesses. |

## Send tallies — `plugin-send-tallies` (`/server`)

A bulk send's own figures, moved by a door that is not its sender: the plugin
that serves a site's unsubscribe page learns that a recipient left from a
message a send carried, and tells the sender, which counts it.

| API | Semantics |
| --- | --- |
| `registerPluginSendTally({ unsubscribed })` | A sender's tally (a set: several plugins may send in bulk). `unsubscribed({ hostId, sendId })` answers whether the send was this plugin's and was counted. |
| `tallySendUnsubscribe({ hostId, sendId })` | Asks each tally until one counts it. Never throws; the door counts only an unsubscribe it just created. |

## People — `plugin-person-records` (`/server`)

The other half of keeping people. A plugin that holds an address, or a record
the owner handed it, asks the plugin that keeps people for the person behind
it — instead of opening that plugin's collections, address index and scope
rules itself.

```ts
// the plugin that keeps people, from its server declarations
registerPluginPersonRecords(rolodexPeople)

// a sender deciding whether it may mail somebody
const person = await findPluginPerson({ hostId, email, onlyVisibleToSite: true, anyKind: true })
const basis = readMarketingBasis(person ? { ...person.data } : null, group)

// an automation filing the person under a campaign, as its site holds them
await filePluginPersonUnder({ hostId, record: person, containerKind: 'campaign', ids: [campaignId] })

// a seller handing money back
await recordPluginPersonRefund({ hostId, email: order.email, amountCents, refId: orderId, closedTheSale })
```

| API | Semantics |
| --- | --- |
| `registerPluginPersonRecords(records, { pluginId? })` | A slot: a workspace keeps one set of people, so a second plugin's service throws naming both and the incumbent keeps serving. Register it from `serverDeclarations`, so every process has it. |
| `findPluginPerson({ orgId?, hostId?, email, onlyVisibleToSite?, anyKind? })` | The person an address belongs to — the owner's lookup, so an alternate address a merge folded in answers the person who holds it — or `null`. `onlyVisibleToSite` answers only a record `hostId` may see: one address names one person, so a record the site cannot see is `null`. `anyKind` looks past the record a known person is held as to every kind the owner keeps a person as (a lead not yet qualified). A failed read throws, and the caller decides which way it falls. |
| `readPluginPeople({ orgId, records })` | The records named by `{ kind, id }`, in the order asked, `null` for each that is gone. |
| `filePluginPersonUnder({ hostId, orgId?, record, containerKind, ids })` | Files the person under containers (`plugin-containers`, above) as `hostId` holds them; `{ filed: false }` for a record the site cannot see or that is gone. Filing is not consent. |
| `recordPluginPersonRefund({ hostId, email, amountCents, refId, closedTheSale, reason? })` | Money handed back to a person — a refund, or a dispute lost (`reason: 'chargeback'`). The owner records it beside what the person spent and never creates a person to hold it: `recorded`, `no-email`, `no-person` or `gone`. Never throws. |
| `pluginPeopleInView({ orgId, hostId, viewId, viewerUid, limit })` | The people a saved view the owner keeps selects for a site, by the id its `savedView` list source handed out: `{ ok: true, people, total, truncated }`, or `{ ok: false, reason }` — `not-found` (gone, or not this member's to list), `not-people`, or `unsupported` (the view narrows by something only the owner's own list can apply, named in `unsupported`; taking it would select more people than it shows). |
| `pluginPeopleWroteIn({ orgId, records })` | Whether each person has ever written to the workspace — an email they sent, on their record — in the order asked; `null` for one the owner could not answer, and `null` whole when it cannot say. Never throws. |
| `pluginPersonRecords()` | The service with its owner, or `null`. |

**Every reader answers `null` when no plugin keeps people.** That is a
workspace with no record system, which is not "nobody found": a send with no
record system has no basis to read, and treats it as record-less.

**A record is the owner's word for its kind, an id, the primary address and
the record as the owner stores it.** The kind is the one `plugin-record-routes`
addresses it by. The fields the platform defines on a person — the consent
basis `marketing-consent` reads, `emailState`, `visibleTo` — are read with the
platform's readers; anything else is the owner's, documented with its
registration. The CRM keeps `contact` (a known person) and `lead` (one nobody
has qualified yet).

## Record timeline — `plugin-record-timeline` (`/server`)

A plugin that sends mail or books meetings files what happened on the
person or the company it happened with — an email sent, a reply read, a
meeting booked, a task for a person — without writing the record system's
documents or importing its plugin. The record system registers one writer (a slot), and a
caller asks for it:

```ts
const records = pluginRecordTimelineWriter()
await records?.writer.logActivity({
  orgId, hostId, link: { contactId }, // or { leadId } for a lead not yet converted
  sourcePluginId: 'acme-mail',
  kind: 'email', atMs, body: excerpt, byUid: '',
  email: { direction: 'inbound', subject, from, to: null, messageId },
})
```

| API | Semantics |
| --- | --- |
| `registerPluginRecordTimelineWriter(writer, { pluginId? })` | The record system's writer. A single-implementation contract: a second plugin's writer throws naming both, and the incumbent keeps serving. The CRM registers it from its server declarations, so a door in either app reaches it. |
| `pluginRecordTimelineWriter()` | The writer with its owner, or `null` when no plugin keeps records — a caller then files nothing. |
| `writer.logActivity(request)` | An activity on a record, scoped like one a member made on `hostId`. An `email` is filed ONCE per `Message-ID`, under the id the capture address files a copy of the same message by; any other kind once per the caller's `dedupeKey`. |
| `writer.createTask(request)` | A task for `assigneeUid` (`''` for nobody, `null` for whoever holds the record it lands on), due at `dueAtMs`, filed once per `dedupeKey`. |

A caller that holds no id of the record system's names how to find the
record instead: `link: { record: { kind, id }, email }`. `record` is one the
record system handed it — the record a booking link was dropped from,
through the zone the owner drew the link in — carried back unread; `email`
is the person's address. The owner files on the record it finds, as
`hostId` sees it: the named record first, then the person at the address,
and answers `404` when neither finds one. A kind it does not keep, or a
record the site cannot see, falls through to the address.

Both answer `{ ok: true, id, created }` — `created: false` for an entry a
previous call, or a copy through another door, already filed — or a refusal
(`{ ok: false, status, error }`: no record system on the plan, a record at its
activity ceiling), and never throw for a refusal. The registry authenticates
nobody: the caller has already decided the entry is the workspace's to write.

An email a plugin is about to send can land on the timeline with its delivery
state, the way a member's own send does — but only the record system can say
whether the address is the person the sender means. So the sender offers the
message BEFORE it goes, carries the tags it is answered with (the delivery
webhook has nothing else to find the entry by), and files the entry once the
provider accepted it:

```ts
const entry = await preparePluginRecordEmail({
  orgId, hostId, to,
  link: { contactId, email }, // the person the sender means
  org,                         // the billing document, when already read
})
const result = await sendEmail({ to, subject, text, ...(entry ? { tags: [...entry.tags] } : {}) })
if (result.sent) await entry?.file({ subject, body: text, to, sourceRef: automationId })
```

| API | Semantics |
| --- | --- |
| `preparePluginRecordEmail(request)` | `{ tags, file }`, or `null` when no plugin keeps records, the one that does files no sent mail, or the message earns no entry — it is not addressed to the person `link` finds, the plan carries no record system, or the record is at its activity ceiling. Never throws; neither does `file`. |
| `writer.prepareEmail(request)` | Optional on the writer: what the record system answers. Nothing is written until `file`. |

The automation engine offers every `sendEmail` step this way; the CRM files
the entry when the message goes to the contact the event is about, with the
automation as its source.

## Text generation — `plugin-text-generation` (`/server`)

A plugin that wants a paragraph drafted — a sequence's email for one person,
a summary, a subject line — asks the workspace's generation service without
importing the plugin that sells generation, which the package map forbids.
That plugin registers one generator (a slot), and a caller asks for it by
nothing more than "the generator":

```ts
const generation = pluginTextGenerator()
const answer = await generation?.generator.generate({
  orgId, hostId, uid, staff, org,
  purpose: 'outreach-curate',            // the usage ledger's kind: plugin id, a hyphen, a word
  system: STANDING_INSTRUCTIONS,         // byte-identical across calls, so a provider can cache it
  prompt: factsAndSkeleton,              // everything about this record
  maxTokens: 2_400,
})
if (answer?.ok === true) keep(answer.text, answer.model)
```

| API | Semantics |
| --- | --- |
| `registerPluginTextGenerator(generator, { pluginId? })` | The workspace's generator. A single-implementation contract: a second plugin's generator throws naming both, and the incumbent keeps serving. The AI plugin registers it from its console API surface. |
| `pluginTextGenerator()` | The generator with its owner, or `null` when no plugin generates text — a caller then says so in its own words. |
| `generator.generate(request)` | The text, its model and its tokens, or a refusal (`{ ok: false, status, reason, error }`: `unavailable`, `permission`, `entitlement`, `off`, `quota`, `refused`, `failed`), never thrown. The generator applies every rule its own doors apply to the member named — the generation permission on `hostId`, the plan, the switches, the reservation against the org's and the member's allotments — and meters the answer under `purpose`. |

The registry authenticates nobody: the caller has already verified who is
asking and that the org is theirs. Nothing about the prompt is kept by the
generator beyond its usage ledger, which holds the purpose and the tokens
and never the words.

## Media delivery — `media-delivery-provider` (`/server`)

A slot one plugin holds (`core.media-delivery`, built on the service contracts
above): an object store with its own edge, which serves library video in place
of the platform's media route. Core keeps every access decision and the copy
rules; the provider stores copies and mints URLs. Register it from a
`serverDeclarations` entry, so both apps hold it before the first request.

| API | Semantics |
| --- | --- |
| `registerMediaDeliveryProvider(provider, { pluginId? })` | Fills the slot. The same plugin registering again replaces its provider; a second plugin throws naming both. |
| `mediaDeliveryProvider(capability)` | The provider when it is configured for `'store'` (copies) or `'deliver'` (URLs), else `null`. Synchronous and free of I/O, so a hot path asks it first. |

A provider implements `isConfigured(capability)`, `putObject({ key, body,
contentLength, contentType })`, `deleteObject(key)`,
`deleteObjectsWithPrefix(prefix)` and `deliveryUrl({ key, expiresAtMs, claims })`.
Keys come from core and carry the content hash they were copied from; claims
carry the org, site, scope and media id a URL was minted for, and grant nothing.
A video is served from the provider only when the `release_video_delivery` flag,
off by default, is on for its org and a copy of its current bytes exists;
everything else serves from the platform exactly as before.

## Site analytics tags — `analytics-provider`

A site can send its visitors' measurement to an analytics vendor it chose, by
saving an id in its analytics settings. The platform owns everything around
that tag — whether the visitor may be measured, the consent banner, the
first-party pageview beacon that meters the site — and names no vendor. A
plugin's adapter knows the vendor: what its tag looks like on the page, how a
resident tag is told the visitor's answer changed, and how an event reaches it.

The adapter is declared in `plugins.config.json`, not registered from code:

```json
"analyticsProvider": {
  "module": "analytics-provider",
  "settings": ["gaMeasurementId", "gtmContainerId"]
}
```

- `settings` are the site analytics settings the adapter mounts a tag for. They
  are compiled into core (`ANALYTICS_PROVIDERS_DECLARED`), because the consent
  gate asks "does this site run a tag?" during render, before any adapter has
  loaded. A setting no provider declares configures nothing, and a site with no
  tag asks its visitors nothing. Two providers may not declare one setting.
- `module` is the adapter's subpath. The generator writes it into each app's
  `plugins.analytics.generated.ts` as an `import()`: a published page fetches it
  only when its site configures a tag, and the console fetches it for the tag
  its own analytics SDK injects. The module exports `analyticsProvider`.

| API | Semantics |
| --- | --- |
| `provider.mounts(host, { consentRequired, advertising })` | The tags a granted pageview mounts, in order: `{ id, boot, src, library? }`. The page renders each as an inline `${id}-init` and a library `${id}-src`, under the consent gate, with the request's nonce. `boot` is inline script, built from constants and format-checked ids only. |
| `provider.applyConsent({ analytics, advertising })` | Make every resident tag of the vendor agree with the answer; returns the ids it acted on. Called when a visitor's answer changes, and on registration with the last answer given in the document. |
| `provider.resident()` / `provider.sendEvent(name, params, { measurementOnly? })` | Whether a tag is resident, and one event to it. `measurementOnly` addresses the measurement property only, not an advertising destination sharing the library. |
| `hostConfiguresAnalyticsTag(host)` (`visitor-consent`) | Whether a declared setting is present and well formed. |
| `applyAnalyticsConsent(grants)`, `sendAnalyticsProviderEvent(...)`, `analyticsTagResident()` | Core's side: what the consent writer and the Core Web Vitals reporter call. |

The pageview beacon (`/api/analytics/collect`) is not a tag and never goes
through this contract: it is the platform's metered door.

## Notification categories and digests — `notifications`

A notification's category is the prefix of its type (`marketplace.review` is
filed under `marketplace`), and a person's preferences are stored per category:
muted or not, in the console and by email, for their account, a workspace or a
site. The core owns six categories. A plugin whose notifications need their own
row on the settings page declares it in `plugins.config.json`:

```json
"notificationCategories": [
  {
    "id": "marketplace",
    "label": "Marketplace",
    "description": "Decisions on plugin listings you submitted for review.",
    "defaults": { "console": true, "email": false }
  }
]
```

- The declaration is compiled into core (`PLUGIN_NOTIFICATION_CATEGORIES_DECLARED`),
  because the fan-out resolves a recipient's channels in server processes that
  load no plugin. A type whose prefix nothing declares is filed under `system`.
- `id` keys every stored preference. It may not be a core category or another
  plugin's, and it is never renamed: a renamed id would leave everyone's
  preferences under a key nothing reads.
- `defaults` says what each channel does before anybody says. Declared rows are
  listed after the workspace's own work and before the platform's notices.

A digest the plugin sends on its own schedule is declared the same way, so the
settings page draws its switch without loading the plugin:

```json
"notificationDigests": [
  { "key": "crmDaily", "label": "Daily CRM digest", "description": "Each morning: …" }
]
```

The switch is stored under `key` in `users/{uid}.digestPrefs` and is on until
the person turns it off. The sender reads it with
`digestEnabled(prefs, key)`; the settings page writes it under the same key.

## Interaction steps — `site-interactions`

An interaction is what a published page does when a visitor does something: a
trigger (a click, a hover, an element scrolled into view, a server event) and
an ordered list of steps. The platform owns the shape and its own client steps
— showing and hiding elements, menus and drawers, classes and ARIA attributes,
scrolling, a video, an alert, a redirect, an analytics event — and treats every
step it does not know as the server's, handed to whichever host-event listener
owns it.

A plugin whose step the besigner's interaction builder should offer declares it
in `plugins.config.json`, not from code:

```json
"interactionSteps": [
  {
    "type": "runWorkflow",
    "label": "Run a workflow",
    "picks": {
      "collection": "workflows",
      "limit": 100,
      "idField": "workflowId",
      "nameField": "workflowName",
      "label": "Workflow",
      "missing": "pick a workflow"
    }
  }
]
```

- `type` is the name the step is stored under; one plugin declares each type.
- `picks`, for a step that acts on one of the plugin's records: the builder
  lists them from `collection` (one the SAME plugin declares under
  `hostCollections`), stores the pick's id in `idField` and its name, as a
  display hint, in `nameField`. `validateInteraction` refuses a step that names
  neither, with `Step N: <missing>`.
- A step only an automation holds — one that acts on the server after the
  page that started it has gone — is declared too, with `"offered": false`, so
  the builder leaves it out while an editor, a run history and a drafter still
  read its `label`:

  ```json
  {
    "type": "waitForEvent",
    "label": "Wait for something to happen",
    "offered": false,
    "holds": { "minMinutes": 1, "maxMinutes": 129600, "timeoutField": "_waitTimedOut" }
  }
  ```

- `holds` marks a step that SUSPENDS the run reaching it, to be continued later
  from a beat: the band of whole minutes it may hold and, where a hold can end
  on the clock, the scope field the continued run carries to say so. A
  visitor's page never runs a step past one (`interactionStepsForClient`).
- `typedFields` are the step's fields a person types words into, each with the
  words a sentence calls it (`{ "key": "listName", "names": "the list" }`):
  where a drafted step may leave a bracketed placeholder
  (`draft-placeholders`).
- The declarations are compiled into core (`declaredInteractionSteps()`),
  because the builder, every validator, a visitor's page and a drafter read
  them with no plugin loaded.

| API | Semantics |
| --- | --- |
| `SiteInteraction<Step>` / `InteractionTrigger` / `InteractionStepBase` | The stored shape. `Step` is the platform's client vocabulary (`ClientInteractionStep`) unless a reader names more. `recipe` is the stamp of the recipe it began as (`interaction-recipes`). |
| `validateInteraction(interaction, { validateStep? })` | The name, the recipe stamp, the trigger and its conditions, the step count, each step's guard, the client steps and every declared pick. `validateStep` is the owner's check for its own step types. |
| `siteInteractionDocument(interaction)` | The shape every writer of `hosts/{hostId}/actions` stores: each trigger cap written out, the legacy single `condition` nulled, the stamp carried only when it says something. |
| `interactionStepLabel(type)` / `interactionStepHolds(type)` / `interactionStepTypedFields(type)` | The platform's own for a client step, else the declaring plugin's; `null` (or none) for a type nobody declares. |
| `interactionStepsForClient(steps)` | The steps a visitor's page may run: the list cut at the first step that holds the run. |
| `isClientActionStep(step)` / `isClientStepEntitled(step, tiers)` | Whether the page runs a step, and whether the site's plan lets it. |
| `SiteAlert` | What a `siteAlert` step, or a listener, hands back to the visitor's page. |

## Step checks — `interaction-step-checks`

`validateInteraction` judges what is the platform's and leaves a step it does
not know to its owner. A plugin that edits interactions passes its own checks.
A plugin that only WRITES one — a recipe installed into a site, a drafted
automation graded before it is handed over — cannot import the plugin whose
steps it wrote, and asks here instead. The plugin that holds a step type's
check registers it from its `declarations` entry:

```ts
registerInteractionStepChecks(['bakeBread'], (step, label) =>
  String(step['loaves'] ?? '').trim() ? null : `${label}: say how many loaves`,
  { pluginId: 'bakery' },
)
```

| API | Semantics |
| --- | --- |
| `registerInteractionStepChecks(types, check, { pluginId? })` | Owner = the loader's marker, else `pluginId`; no owner throws. A type another plugin's check holds throws; nothing is registered unless every type is accepted. Returns the unregister. |
| `validateStoredInteraction(interaction)` | `validateInteraction` with every registered check. A step with no registered check is judged by the platform alone. |
| `registeredInteractionStepCheck(type)` | The registered check and its owner, or `null`. |

## Placeholders — `draft-placeholders`

A drafted interaction marks a value a person still has to supply with square
brackets where it belongs: `[newsletter]` where a list is named. A bracketed
record name matches no record, and a bracketed condition value matches no
event, so a placeholder can never act on the wrong record. Only the
conditions and each step's typed fields are read; a selector, HTML or a script
uses brackets as syntax.

| API | Semantics |
| --- | --- |
| `draftPlaceholder(words)` / `draftPlaceholderIn(value)` | Writes words as a placeholder; reads the words of the first placeholder in a value, or `null`. A written link is not a placeholder. |
| `interactionPlaceholders(interaction)` | Every placeholder, the trigger's conditions first, then each step's guard and typed fields: `{ step, field, names, text }`. |
| `describeInteractionPlaceholder(placeholder)` | One as a person reads it: `Step 1: the list (“newsletter”)`. |

## Server steps — `plugin-server-steps` (`/server`)

Every interaction step that is not a client step is the server's to run. The
automation engine runs its own; a step that writes ANOTHER plugin's records —
a dataset row, a contact's stage — is that plugin's, and the plugin registers
the executor that runs it from its `serverDeclarations` entry. The engine keeps
the step's guard, the run's order, the run history and the nesting cap, and
hands the executor one step at a time:

```ts
// your plugin's serverDeclarations entry
registerServerStepExecutor(
  ['stampVisitor'],
  async (request) => (await import('./server/stamp-step')).runStampStep(request),
  { pluginId: 'stamps' },
)

// runStampStep({ hostId, org, orgId, run, event, payload, step })
// answers { detail? } when it did its work, { error } when it did not,
// and { emit: { event, payload } } for an event its write earned
```

A first-party plugin also declares the steps it runs, so a boot that skipped
the registration is refused rather than read as a step that ran:

```json
"serverSteps": [{ "type": "stampVisitor" }]
```

| API | Semantics |
| --- | --- |
| `registerServerStepExecutor(types, run, { pluginId? })` | Owner = the loader's marker, else `pluginId`; no owner throws. A type another plugin declares or already holds throws, and nothing is registered unless every type is accepted. Registering again replaces the plugin's own. Returns the unregister. |
| `ServerStepRequest` | The site, the owning organization's billing document and id (already read by the run's gate), the automation (`run`: kind, id, name), the event, its payload and the step as stored. |
| `ServerStepAnswer` | `error` is the step's line in the run history when nothing was written; the run goes on to the next step, and a throw reads the same. `detail` is the fact the history carries. `emit` is an event the write earned, which the ENGINE raises one level deeper under its nesting cap. |
| `pluginServerStepExecutor(type)` | What the engine asks: the registered executor; for a declared step with none, the app's declarations step once more and then a `ServerStepUnavailableError` (the step's failure); `null` for a type nobody declares or runs. A type the engine runs itself never reaches it. |
| `declaredServerSteps()` / `declaredServerStep(type)` | The compiled `serverSteps` rows. |

## Interaction recipes — `interaction-recipes`

A recipe is a ready-to-edit interaction: a trigger, its conditions and an
ordered step list, handed to an editor as a draft that nothing writes until a
person saves. The plugin that knows what a recipe is FOR writes it, and the
plugin that edits and stores interactions offers it in its Recipes menu; neither
imports the other. A recipe builds its interaction in code, so it is registered
from the plugin's `declarations` entry, which both apps and the console's loader
run at boot:

```ts
// your plugin's declarations entry
registerInteractionRecipes(
  [
    {
      id: 'thankRegular',
      title: 'Thank a regular',
      description: 'When a returning customer orders, thank them by email.',
      build: () => ({
        recipe: 'thankRegular',
        name: 'Thank a regular',
        trigger: { event: 'order' },
        steps: [{ type: 'sendEmail', subject: 'Thank you', body: 'Good to see you again.' }],
        enabled: true,
      }),
    },
  ],
  { pluginId: 'bakery' },
)
```

A stored interaction remembers the recipe it began as by the recipe's id, its
`recipe` stamp, so an id never changes once it has shipped. A first-party plugin
also declares its ids, so a validator knows a stamp in a process where the
plugin's declarations never ran:

```json
"interactionRecipes": [{ "id": "thankRegular" }]
```

A recipe that needs a record picked first — "Tag by form" needs the form —
names it in `picks`: the record `kind`, listed through the kind's
`plugin-record-lists` source, and the words the picker asks in (`label`,
`plural`, `prompt`, `none`). It receives the pick as `build({ picked: { id, name } })`.

| API | Semantics |
| --- | --- |
| `registerInteractionRecipes(recipes, { pluginId? })` | Owner = the loader's marker, else `pluginId`; no owner throws. An id another plugin declares or registered throws, and nothing is registered unless every recipe is accepted. Registering again replaces the plugin's own. |
| `interactionRecipes()` / `interactionRecipe(id)` | Every registered recipe, each plugin's in its own order — what a Recipes menu lists — and one by id, or `null`. |
| `isKnownInteractionRecipe(id)` | Whether a stamp names a recipe a plugin declares or registered. A validator refuses any other stamp; `null` and absent pass. |
| `declaredInteractionRecipes()` | The compiled `interactionRecipes` rows. |

## Host events — `host-events`

A host event is what happened on a site that an automation can start on: a
form submitted, a booking made, a contact moved stage. A server door raises one
with `emitHostEvent(hostId, type, payload, { actor })` beside the write it
performed; nothing watches the database. The platform raises `pageView` itself.
A plugin whose doors raise others declares them in `plugins.config.json`, so
the trigger pickers, the run history and every validator know them with no
plugin loaded:

```json
"hostEvents": [
  {
    "type": "booking",
    "order": 70,
    "label": "New booking",
    "payloadKeys": ["serviceName", "email", "startsAtMs"]
  }
]
```

- `type` is what a stored trigger names: never rename it. One plugin declares
  each type, and none may take the platform's `pageView`.
- `order` places it in every picker; `pageView` is 20.
- `payloadKeys` (optional) lists what the event puts in scope for a filter or a
  condition; leave it out when the door documents none.

The declarations compile into `app-utils/plugin-host-events.generated.ts`.

| API | Semantics |
| --- | --- |
| `HOST_EVENTS` / `HOST_EVENT_TYPES` | Every event, the platform's and the plugins', in `order`. `HostEventType` is their union. |
| `hostEventLabel(type)` / `hostEventPayloadHint(type)` | The picker's words, falling back to the type itself for a custom event; the "In scope: …" line, or `null` where nothing is documented. |

## Computed variables — `computed-variables` (`/server`)

A site variable is bound into a page with `{{var:id}}` and resolved when the
page is composed. A COMPUTED variable takes its value from a record a plugin
keeps, with its stored value as the fallback. The plugin that computes it
registers a variable computer, in two halves so its reads overlap the page's
own:

```ts
// your plugin's serverDeclarations entry
registerVariableComputer(
  {
    prepare: async (hostId) => (await import('./server/rates')).prepareRates(hostId),
  },
  { pluginId: 'cellar' },
)

// prepareRates reads what it needs for the site, then answers a computation:
// ({ variables, functions }) => variables, with the computed ones' values filled in
```

| API | Semantics |
| --- | --- |
| `registerVariableComputer(computer, { pluginId? })` | Owner = the loader's marker, else `pluginId`; no owner throws. Registering again replaces the plugin's own. |
| `prepareComputedVariables(hostId)` | What the compose pipeline calls beside its variable and function reads: every computer's `prepare`, resolved to their computations applied in registration order. A computer that fails, or none registered, leaves each variable its stored value; with none registered, the app's declarations step is run once more first. |

Workflows registers one: a variable that names a workflow takes its result.

## Platform events — `plugin-events` (`/server`)

Core raises the events; a plugin that must react to what a core route did
subscribes from its `serverDeclarations` entry, so the subscription is in
place before the first request. Payloads carry the actor and the before /
after, never a reference to the plugin.

| Event | Raised by | Payload |
| --- | --- | --- |
| `org.seatAddons.changed` | the add-on checkout and the billing webhook | `{ orgId, actor, before, after }` — the `org.seatAddons` maps |
| `org.permissions.changed` | the member, role and host-member routes | `{ orgId, actor, subject: { type, id?, name? }, permission, granted }` |
| `host.records.removed` | the public API's deletes and a person's erasure, after the delete lands | `{ orgId, hostIds, collection, records: [{ id, data }] }` — each removed document as it stood |
| `billing.invoice.paid` | the billing webhook, once the invoice resolves to a workspace | `{ orgId, invoiceId, amountPaidCents, currency, paidOutOfBand, metadata }` |
| `billing.invoice.failed` | the billing webhook | `{ orgId, invoiceId, amountDueCents, metadata }` |
| `billing.invoice.closed` | the billing webhook, on `voided` and on `marked_uncollectible` | `{ orgId, invoiceId, reason: 'voided' \| 'uncollectible', metadata }` |
| `billing.dispute.opened` | the billing webhook, on a dispute that matched a workspace | `{ orgId, chargeId, invoiceId, amountCents }` |
| `billing.paymentMethod.changed` | the billing webhook, after reading the customer's default | `{ orgId, defaultType }` |

The five billing events carry the Stripe object's own `metadata`, which core
does not read. A plugin that stamped its own id on an invoice it created
recognizes its own by it; every other handler ignores the event. They are
awaited in the route rather than deferred, because a plugin's decision about
whether a workspace may keep spending must not lag the payment that settled it.

## Site beacons — `plugin-site-beacons` (`/server`)

A published page reports what visitors did through one collector, and the
collector owns what every beacon owes before anything is counted: the host must
exist, a lockdown refuses it silently, and the per-address rate limit applies.
What a plugin's site runtime reports beyond a pageview — an announcement bar
seen, a popup dismissed — is the plugin's to count, in its own documents. It
claims the body FIELD that marks its beacons, from `serverDeclarations`, and
imports its counting code on the first beacon:

```ts
registerPluginSiteBeacon(
  {
    field: 'tasting',
    count: async (request) => (await import('./server/tasting-beacon')).count(request),
  },
  { pluginId: 'cellar' },
)
```

| API | Semantics |
| --- | --- |
| `registerPluginSiteBeacon({ field, count }, { pluginId? })` | Claims a field. One owner per field: a second plugin throws naming both and the incumbent keeps it; the owner registering again replaces its own. |
| `count({ hostId, day, dayExpiresAt, body })` | One beacon, after the collector's gates. `day` is the collector's UTC day bucket and `dayExpiresAt` the platform's retention for that day's analytics document — an owner that writes there stamps it. `body` is what the browser sent: validate every field read. The collector answers 204 and counts no pageview; a throw is logged, never surfaced. |
| `pluginSiteBeaconFor(body)` | The owner of a beacon, or `null` when no claimed field holds a non-empty string. |

The site runtime posts with `sendAnalyticsBeacon({ hostId, tasting: 'poured' })`.
Marketing's announcement bar and popup are the first: `{ overlay, overlayId? }`.

| API | Semantics |
| --- | --- |
| `registerPluginEventHandler(event, handler, { pluginId? })` | Subscribes; attributed to the registering plugin. Idempotence is the subscriber's to keep — check `listPluginEventHandlers(event)` before subscribing again after a registry reset. |
| `runPluginEventHandlers(event, payload)` | What the core route calls after its write: every handler in registration order, a failure logged and counted (`{ handled, failed }`), never the route's failure. |

## Usage meters — `plugin-usage-meters` (`/server`)

The monthly usage sweep writes one rollup per workspace and month
(`orgs/{orgId}/usage/{month}`) and posts the month's billed figure as one
Stripe meter event. A plugin whose usage is measured in its own storage and
priced by its own band registers a meter from its `serverDeclarations` entry,
and the sweep asks it once per workspace; the plugin also declares the meter's
id under `usageAxes` → `meters`, so the sweep refuses to bill a month while a
declared meter is unregistered — the workspace fails loudly for that pass and
is swept again the next day, rather than billed without it. Import the
registry by its subpath; it is not on a barrel.

```ts
registerPluginUsageMeter({
  pluginId: 'cellar',
  id: 'tastings',
  measure: async (context) => {
    const { measureTastings } = await import('./billing/tastings-meter')
    return measureTastings(context)
  },
})
```

| API | Semantics |
| --- | --- |
| `registerPluginUsageMeter({ id, measure, closeMonth?, pluginId? })` | Idempotent per plugin and id. A meter with no owner, no id or no `measure` throws. |
| `measure(context)` | `context` is `{ orgId, org, month, closed, previous, releaseFlagOn(key) }` — `previous` is the month's rollup as it stood before this run, for a stock meter's period-end reading. Answers `{ fields, periodEndFields?, billedUsd, periodEndBasis? }`: `fields` are written onto the rollup on every run, under the names the plugin's usage axes read, and never over a field the platform writes; `periodEndFields` only while the month is open; `billedUsd` enters the billed figure, rounded to cents. A throw fails that workspace's pass. |
| `closeMonth(context)` | Run for every workspace of a CLOSED month, every day the sweep runs, before its already-reported skip — for a plugin that bills part of its usage itself and settles the remainder at the month's end. `context.stripeCustomerId()` reads the workspace's billing document only when called. Errors are logged, never the sweep's. |
| `listPluginUsageMeters()` / `unregisteredPluginUsageMeters()` | What the sweep runs, declared meters first in catalog order; and every declared meter nothing registered, as `pluginId:id`. |

## Account erasure — `plugin-user-erasure` (`/server`)

The account erasure deletes what core stores about a person. A plugin that
keeps data about a person where core's deletes do not reach — documents
under an org keyed by the uid, a collection carrying the uid as a field —
registers an eraser from its `serverDeclarations` entry:

```ts
registerPluginUserEraser(
  async ({ uid, orgIds }) => {
    const { eraseSnapshotsFor } = await import('./server/snapshots')
    return { snapshots: await eraseSnapshotsFor(uid, orgIds) }
  },
  { pluginId: 'acme-backups' },
)
```

| API | Semantics |
| --- | --- |
| `registerPluginUserEraser(eraser, { pluginId? })` | One eraser per plugin, attributed like an event handler; registering again replaces it in place. Check `listPluginUserErasers()` before registering again after a registry reset. |
| `runPluginUserErasers({ uid, orgIds })` | What the erasure calls once the person's memberships are removed: every eraser in registration order, with every workspace the person belonged to. Answers each plugin's report by plugin id, or `null` for an eraser that threw — logged, and never the erasure's failure. |

A report is counts and flags (`Record<string, number | boolean | null>`),
never the erased content: it lands in the erasure's audit record, which
outlives the data. `null` in a field is a figure the eraser could not
measure, and a `null` report says the plugin's data may remain — neither
is zero.

## Workspace erasure — `plugin-org-erasure` (`/server`)

The workspace erasure destroys the organization's document tree, its sites
and the top-level records keyed to it by a field. A plugin that holds
something those deletes cannot finish on their own — a grant at a provider
only the plugin can revoke, a record outside every path and field the
erasure sweeps — registers an eraser from its declarations:

```ts
registerPluginOrgEraser(
  async ({ orgId, dryRun }) => {
    const { revokeGrantsFor } = await import('./server/grants')
    return revokeGrantsFor(orgId, { dryRun })
  },
  { pluginId: 'acme-mail' },
)
```

| API | Semantics |
| --- | --- |
| `registerPluginOrgEraser(eraser, { pluginId? })` | One eraser per plugin, attributed like an event handler; registering again replaces it in place. Check `listPluginOrgErasers()` before registering again after a registry reset. |
| `runPluginOrgErasers({ orgId, dryRun })` | What the erasure calls BEFORE it deletes anything of its own, so an eraser that acts through a record — opening a stored grant to revoke it — finds the record there. Every eraser in registration order; answers each plugin's report by plugin id, or `null` for an eraser that threw — logged, and never the erasure's failure. |

The report lands under `plugins` on the erasure's result and audit record,
on the same terms as an account erasure's. A plan (`dryRun: true`) is handed
to every eraser, which then touches no provider and writes nothing: it
counts, and a figure it did not measure is `null`. An eraser that opens a
credential only the console holds registers from `consoleServerDeclarations`,
which the tenant runtime never loads. A required eraser that is not registered
when the erasure starts gets one more boot step before the erasure refuses.

The account, workspace and person eraser lists are each one per process, on
`globalThis` (AGL-3464): the app registers from `instrumentation.ts`, which Next
compiles apart from the route that runs the erasure, so a list kept in a module
would be filled in one copy and read empty in the other.

## Person erasure — `plugin-person-erasure` (`/server`)

The person erasure removes one person from one workspace. The platform closes
every site's door to the address (an address-free suppression row per site),
sweeps the delivery log filed under it and keeps the audit; everything else
the workspace keeps ABOUT the person is a plugin's, and each plugin that keeps
some registers an eraser from its declarations:

```ts
registerPluginPersonEraser(
  async ({ orgId, email, key, contactIds, dryRun, atMs }) => {
    const { eraseEnrollmentsFor } = await import('./server/enrollments')
    return eraseEnrollmentsFor({ orgId, email, contactIds, dryRun, atMs })
  },
  { pluginId: 'acme-mail' },
)
```

The plugin that keeps the PEOPLE registers a records eraser instead, with two
halves: `locate` names the person's records before anybody erases — the ids
every other eraser is handed as `contactIds`, because what they keep is filed
by them — and `erase` runs after every other eraser, while nothing else needs
the records to find what it keeps.

```ts
registerPluginPersonRecordsEraser(
  {
    locate: async ({ orgId, email }) => (await import('./server/people')).idsFor(orgId, email),
    erase: async (request) => (await import('./server/people')).erase(request),
  },
  { pluginId: 'acme-people' },
)
```

| API | Semantics |
| --- | --- |
| `registerPluginPersonEraser(eraser, { pluginId? })` | One eraser per plugin; registering again replaces it in place. |
| `registerPluginPersonRecordsEraser({ locate, erase }, { pluginId? })` | The record system's. One per process: the same plugin replaces its own, another is refused naming both. |
| `runPluginPersonErasure({ orgId, email, key, dryRun, atMs })` | What the erasure calls after every site's door is closed: `locate`, every other eraser in registration order, then the records eraser's `erase`. Answers `{ contactIds, reports }`, each plugin's report by plugin id or `null` for an eraser that threw — logged, and isolated, unless the share is required. |
| `missingRequiredPersonErasers()` / `missingRequiredPersonErasersAfterRepair()` | The required erasers not registered in this process. The second runs the app's boot step once when any is missing, then asks again; the erasure asks it before it writes anything. |

A share the erasure PROMISES the person — their contact record, their leads,
their name on an order or a booking, their place on an audience list — is
declared `"requiredPersonEraser": true` in `plugins.config.json`, compiled into
`PLUGIN_REQUIRED_PERSON_ERASERS`. The erasure refuses to start while one is not
registered — after running the app's boot step once more, since a boot whose
declarations failed looks the same — a records eraser that cannot `locate` stops it before anything is
erased, and a required eraser that throws fails it after every other eraser
ran; the request stays queued and the job retries it. A share that is a
courtesy is isolated as before.

`key` is `personKey(email)`: how every suppression list names the person
without the address. A record that the person asked not to be contacted,
keyed that way, is kept — the promise outlives the data — with anything that
could identify the person removed from it. `atMs` is the erasure's one time,
for every stamp it leaves. A dry run counts and writes nothing. Reports land
under `plugins` on the erasure's counts and audit row, beside `records`, the
count the record system located.

## Consent group changes — `plugin-consent-group-change` (`/server`)

When an organization creates, edits or dissolves a consent group, its sites
start or stop reading each other's refusals, and records keyed by a group's
id have to move. Core carries the refusals it stores per site — the
unsubscribe list, the topic opt-outs, the email frequency — and flips the
declaration. A plugin that keeps its own per-site refusals, or records keyed
by a group's id, registers a participant from its server declarations:

```ts
registerPluginConsentGroupParticipant(
  {
    async preview(request) {
      return (await import('./server/consent-groups')).preview(request)
    },
    async run(request) {
      return (await import('./server/consent-groups')).run(request)
    },
    summarize: (counts) => `${counts.moved ?? 0} records moved`,
  },
  { pluginId: 'acme-mail' },
)
```

| API | Semantics |
| --- | --- |
| `registerPluginConsentGroupParticipant(participant, { pluginId? })` | One participant per plugin; registering again replaces it in place. Participants run in registration order. |
| `preview({ orgId, plan })` | Lines for the admin's review step, each `{ id, text, count, severity }`, with `count: null` for a figure it did not count. Isolated: a preview that throws shows as `null` lines, and the review says part of the change could not be counted. |
| `run({ orgId, changeId, plan, phase, cursor, deadlineMs, dryRun })` | Called for `carry` before the declaration flips (twice: once, and again as the catch-up), `rehome` after it, and `sweep` six minutes after it. Answers `{ done, cursor, counts }`; the executor calls again from `cursor` until `done`. **Not isolated:** a throw stops the change before it takes effect, and five failures in a row mark it stalled while it keeps retrying. |
| `summarize(counts)` | Optional. The participant's clause of the "Finished a consent group change" activity line, from its counts totaled over the change. |

The `plan` names each carry — `toHostId` is about to stop reading
`fromHostId`'s refusals, so copy them first — and each holder flow, a `move`
or a `split` of the records under a group's id or a lone site's id. A run
returns before `deadlineMs`, writes nothing on `dryRun`, and keeps every
write create-if-absent or a restrictive merge: the catch-up and the sweep
are second runs over the same plan, and a second run over a finished change
writes nothing. Register from the server declarations, not the API register
function, so the participant is in place in every process that works a
change — the scheduled job that finishes an abandoned one included.

## Subscription topics — `subscriptionTopics`, `app-utils/subscription-topics`

Every marketing-purpose message names the stream it is sent under, its
unsubscribe link carries that stream, and the send path refuses a recipient
who left it. The state and the policy are the mail rail's; a plugin brings the
streams its mail is sent under, declared in the `subscriptionTopics` block of
`plugins.config.json` and compiled, because the unsubscribe and preference
pages name a stream whether or not the sending plugin has loaded:

```json
"subscriptionTopics": [
  {
    "id": "tastings",
    "name": "Tasting invitations",
    "description": "Invitations to our tastings and cellar events.",
    "order": 50
  }
]
```

`id` is a wire value — a Firestore path component and a component of the
unsubscribe link's signed subject — so it is never renamed, and it may carry
no `/` or `:`. `order` is the stream's place on the preference page. One
plugin marks its stream `default`: the stream a campaign or a scheduled
automated email belongs to when it names none.

| API | Semantics |
| --- | --- |
| `DECLARED_SUBSCRIPTION_TOPICS` / `DEFAULT_SUBSCRIPTION_TOPIC_ID` | The declared streams in preference-page order — the floor of every org's catalog, present with no write anywhere — and the default stream's id (`''` when none is declared). |
| `mergeSubscriptionTopics(stored)` / `activeSubscriptionTopics(topics)` / `resolveSubscriptionTopic(id, topics)` | The catalog a reader sees (the floor, overlaid by what the org stored, plus its own topics), the same without retired ones, and the stream a message belongs to — an unknown or missing id resolves to the default. |
| `readTopicSubscriptionState(entry)` / `topicRequiresDoubleOptIn(topic, siteDefault)` / `TOPIC_OPT_OUTS_SUBCOLLECTION` | One recipient's standing on one stream (`subscribed`, `pending`, `opted-out`) from `hosts/{hostId}/topicOptOuts`, and whether joining needs a confirmation click. Written through `@aglyn/tenant-data-admin/server/topic-subscriptions`. |

The catalog an org authors is kept by the Email plugin, which publishes it as
the `subscriptionTopic` record index (facts `{ description, archived,
doubleOptIn? }`). A plugin that has to ask what the org made of a stream reads
that index, never the collection.

## Email streams — `plugin-email-streams` (`/server`)

A slot one plugin holds (`core.email-streams`, built on the service contracts
above): the plugin that keeps a site's email preferences — its topic catalog,
the per-topic opt-outs and the site's unsubscribe list — reopens one stream
for a signed-in person who asks for it back. Core calls it when an account's
answer about product updates turns back to yes in the console, so it is
registered from `consoleServerDeclarations`:

```ts
registerPluginEmailStreams(
  { rejoin: async (request) => (await import('./server/streams')).rejoin(request) },
  { pluginId: 'acme-mail' },
)
```

| API | Semantics |
| --- | --- |
| `registerPluginEmailStreams(impl, { pluginId? })` | Fills the slot. The same plugin registering again replaces its entry; a second plugin throws naming both. |
| `rejoinEmailStream({ hostId, email, topicId })` | Reopens one stream. Answers `rejoined` (with `releasedSuppression` and `keptLeft`), `held` with the reason, `unavailable` when no plugin holds the slot, or `failed` for one that threw — logged, never thrown, because the caller has already recorded the person's answer. |

`rejoin` lifts the stream's opt-out. For an address that left everything, it
first records an opt-out for every *other* active stream in the catalog and
only then lifts the site's unsubscribe, so the rest stay left and there is no
moment in which the whole catalog is mailable; a catalog it cannot read lifts
nothing. A bounce, a complaint, an erasure or a staff hold is `held` and
nothing is written, and a pending double opt-in stays pending. The slot
authenticates nobody: core asks only with the verified address of a signed-in
account, because reopening a stream undoes something done from the mailbox.

## Lead conversion — `plugin-lead-conversion` (`/server`)

When a lead becomes a contact — from the console, over the REST API, or on its
own when the person signs up or buys — the record system stamps the lead,
moves its activities and tasks onto the contact, then tells every plugin with
a listener, so a plugin that keeps records naming the lead can re-point them:

```ts
registerPluginLeadConversionListener(
  async ({ orgId, hostId, leadId, contactId, email, by }) => {
    const { followLeadToContact } = await import('./server/enrollments')
    return followLeadToContact({ orgId, hostId, leadId, contactId })
  },
  { pluginId: 'acme-mail' },
)
```

| API | Semantics |
| --- | --- |
| `registerPluginLeadConversionListener(listener, { pluginId? })` | One listener per plugin; registering again replaces it in place. |
| `runPluginLeadConversionListeners({ orgId, hostId, leadId, contactId, email, by })` | What the conversion calls after the lead carries `convertedContactId` and its own records have moved. Every listener in registration order; each plugin's report by plugin id, or `null` for one that threw — logged, and never the conversion's failure, which has already happened. |

`by` names the door: `member`, `api`, `signup`, `purchase` or `backfill`.
`leadId` is the person key the lead is filed under on `hostId`.

## Console jobs — `plugin-console-crons` (`/server`)

A plugin whose scheduled work needs what only the console holds — a provider
key, a sealed grant to a person's mailbox — declares a job from its
`consoleServerDeclarations`, with the body imported when it first runs:

```ts
registerPluginConsoleCron(
  {
    id: 'acme-mail-sync',
    label: 'Acme mail sync',
    drives: 'Reads replies into the CRM. If it stops, replies are never filed.',
    run: async ({ nowMs, deadlineMs }) => (await import('./server/sync')).runSync({ nowMs, deadlineMs }),
  },
  { pluginId: 'acme-mail' },
)
```

| API | Semantics |
| --- | --- |
| `registerPluginConsoleCron(job, { pluginId? })` | Declares a job. Its id starts with the plugin's own (`acme-mail-…`); a platform job's id, another plugin's, a job with no label or no `drives` sentence is refused. The same plugin declaring the id again replaces it. |
| `runPluginConsoleCrons({ nowMs, deadlineMs, jobIds?, beat })` | What `POST /api/admin/plugin-crons` calls every fifteen minutes (the console's `consoleFastCrons` tick, on the console's `CRON_SECRET`): every job — or the one a manual run names — concurrently, each after its own `platformCronBeats` mark. A job that throws is `null` in the answer and the route answers 207. |
| `pluginConsoleCronScheduledJobs()` | Each job as a row of `/api/health/crons`, judged against the fifteen-minute tick with a 45-minute grace, beside the runner's own `plugin-console-crons` row. |

A job reports counts and flags, never content, and starts no new unit of work
after `deadlineMs`. A job that needs a slower cadence keeps its own last-run
mark and returns at once. Adding a job needs no route, no scheduler change
and no function deploy.

## Usage alerts — `plugin-manager/usage-alert-contributors`

The usage-alerts sweep walks every org once, reads its usage, and sends core's
own alerts: the plan quotas, the customer's budget and the free plan's
bandwidth cap. A plugin that meters a cost or enforces a ceiling core knows
nothing about adds to the same sweep by registering a contributor from its
`serverDeclarations` entry, importing the rule itself lazily: `quotaChecks`
for the bands the WORKSPACE is warned about, `evaluate` for STAFF alerts, or
both. Import the registry by its subpath; it is not on a barrel.

A band that needs no code — a monthly host counter against what the plan
includes of an entitlement — is declared on the plugin's usage band instead
(`bands[].alert`, [Usage axes](#usage-axes--plugin-usage-axes)), and an org
capacity a plugin declares (`plugin-org-capacity`) is warned about as it
fills with no contributor at all.

```ts
registerUsageAlertContributor({
  pluginId: 'acme-sms',
  id: 'carrier-spend',
  quotaChecks: async (context) => {
    const { smsQuotaChecks } = await import('./usage/sms-quota-checks')
    return smsQuotaChecks(context)
  },
  evaluate: async (context) => {
    const { evaluateCarrierSpend } = await import('./usage/carrier-spend-alerts')
    await evaluateCarrierSpend(context)
  },
})
```

| API | Semantics |
| --- | --- |
| `registerUsageAlertContributor(contributor)` | Idempotent per plugin and id: the same pair again replaces the earlier contributor in place. A contributor with no plugin id, no id, or neither `evaluate` nor `quotaChecks` throws. |
| `quotaChecks(context)` | Answers `{ key, label, noun, used, limit, cadence, outcome, reached, approach, reachedTitle? }[]` for one org, from `context.org`, `spend` and `month`. `cadence` is `crossing` (something the workspace has: announced once when reached, again only after usage falls back) or `monthly` (a meter that resets on the 1st); `outcome` is `stops`, `bills` or `continues`; `reached` and `approach` are the sentences that say what happens at the band. The sweep opens every notice itself — the workspace, the figures, then `noun` — and runs the checks after its own through the same approach threshold, guard map, first-sweep seeding, console notification and email, so a plugin's band warns exactly as a platform band does. A throw costs only that contributor's checks. |
| `listUsageAlertContributors()` | What the sweep runs for each org, after the budget alert and before the bandwidth cap: `FIRST_PARTY_PLUGINS` catalog order, then any other plugin id, then registration order within a plugin. |
| `context.recordAlert(key, threshold)` | Records the dedupe guard and answers whether the alert may be sent. On an org's first, silent evaluation it records the guard and answers `false`. Guard keys share one map with core's checks, so name yours for what it measures. |
| `context.alertStaff(alert)` | The sweep's own sender: the staff bell, the staff inbox with the same words, and a row in the run's report. It sends nothing on an org's first, silent evaluation. |
| `context.org` / `spend` / `guards` / `month` | The org document, its spend this month, its guard map as read, and the month the run dedupes against. A contributor never writes a guard itself. |

Contributors run one at a time and are isolated: a throw is logged against the
contributor, a guard it recorded for an alert it never delivered is dropped so
the next sweep tries again, and the next contributor runs.

## Activity actions — `plugin-activity-actions`

A plugin whose activity rows are read by more than a person stores a CODE
(`ai.job.output`) and declares what it means:

```ts
registerPluginActivityActions({
  pluginId: 'ai',
  group: { id: 'ai', label: 'AI', staffAuditPrefixes: ['billing.assistOverage.'] },
  actions: [
    { key: 'ai.job.output', label: 'AI generated', scope: ['org', 'host'] },
    { key: 'ai.addon.purchased', label: 'Added the AI add-on', scope: 'org' },
  ],
})
```

| API | Semantics |
| --- | --- |
| `registerPluginActivityActions({ pluginId, group, actions })` | Idempotent per plugin; a code another plugin declared refuses the registration, and so does a group of more than 30 actions (`PLUGIN_ACTIVITY_GROUP_MAX_ACTIONS`). Declare it from both entries, in code that is sure to run: the register function your `declarations` entry calls, or the top level of a file your `package.json` lists in `sideEffects`. |
| `pluginActivityActionLabel(action)` | What a reader sees for a code — `activityActionLabel` in the presenter reads it, so every feed, table and card shows the same words. |
| `listPluginActivityFilters()` | One chip per group with the codes it keeps: the org feed and the actor table draw their chips from this, and send `action isAnyOf …` on the list's query — which holds at most 30 values, which is why a group is capped at 30 codes. |
| `pluginStaffAuditActionGroup(action)` / `pluginStaffAuditActionGroupLabel(group)` | The staff audit facet's grouping: a registered group by code or by `staffAuditPrefixes`, else the action's leading namespace. |
| `isPluginStaffAuditAccess(action)` | Whether a staff audit action is one a plugin's group names in `staffAuditAccessActions` — the actions its staff doors write when staff READ something rather than change it. The audit log files them as accesses. Matched exactly. |

An org activity row names its target, `{ type, id, name }`. Core's target
types are core's own resources; a plugin files a row about one of ITS
resources under its own namespace, `pluginId:noun` (`PluginActivityTargetType`,
e.g. `outreach:mailbox`), which the org log accepts without naming the
plugin. The feed labels it by the noun (`Mailbox`), prefers the target's
`name` wherever it has one, and links it nowhere.

## Billing and access keys — `plugin-entitlements`

A plugin that sells something, gates something or can be paused in an
incident declares the KEYS; the numbers stay where they are checked
(`PLAN_PRICING` for a price, reconciled by `check-pricing-drift`).

```ts
registerPluginEntitlements({
  pluginId: 'ai',
  seatAddons: [
    {
      key: 'aiAddon', // org.seatAddons key
      label: 'AI add-on',
      maxUnits: 1, // org-wide: bought once
      quota: { key: 'assistCreditsPerMonth', perUnitByPlan: AI_ADDON_CREDITS_PER_MONTH },
      features: ['aiGenerative', 'aiAssist'],
    },
  ],
  features: [{ key: 'aiGenerative', label: 'AI generation' }],
  lockdownFeatures: [
    {
      key: 'ai-generate',
      label: 'AI generation', // the staff checklist
      customerName: 'AI generation', // the customer's mail: "our team paused AI generation"
      staffBypass: true,
      notice: { title: 'AI generation is temporarily unavailable', body: '…' },
      apiPaths: { prefixes: ['ai/generate'] },
    },
  ],
  permissions: [{ key: 'manageAi', label: 'Manage AI', defaults: { admin: true, editor: false, viewer: false } }],
  orgPermissions: [
    {
      key: 'ai.use', // stored on custom roles and member overrides
      label: 'Use AI assistance',
      description: 'Ask the assistant, rewrite copy with AI, and generate a section.',
      roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
      // Present: a site collaborator holds the key per site.
      hostRoleDefaults: { admin: true, editor: true, author: true, viewer: false },
    },
  ],
})
```

| API | Semantics |
| --- | --- |
| `registerPluginEntitlements(registration)` | Idempotent per plugin. A seat add-on, lockdown or catalog permission key another plugin owns refuses the registration. Permissions are forwarded to `registerPluginPermissions` with the owner filled in. |
| `listPluginOrgPermissions()` | The keys plugins add to the org permission catalog, in catalog order, with their owner. `ORG_PERMISSIONS` and `ORG_PERMISSION_KEYS` list them after the core keys and are kept in step in place, so a module that imported them first still reads them. `resolveOrgPermissions` layers a declared key like a core one — role default, custom role, per-member override — the role editor lists it, and a member, role or collaborator write raises `org.permissions.changed` once per declared key it moved (`pluginPermissionChanges`). A declaration naming a core key is refused. |
| `hostRoleDefaults` on a catalog key | Makes the key per-site for a site collaborator: `resolveCollaboratorHostPermissions` and `resolveMemberHostPermissions` decide it from the host role, refined by the per-site toggle on the member document, and `projectHostMemberPermissions` stamps the site's `memberPermissions` projection. On the server, `memberHasPermissionOnHost`, `permissionRefusal` and `setHostPermissions` are a door's rung, its 403 and the toggle write. |
| `listPluginSeatAddons()` / `pluginSeatAddon(key)` | What `resolveOrgEntitlements` folds: the quota named gains `perUnitByPlan[plan] × units` and the features switch on, after the org's overrides and before nothing. `pluginSeatAddonUnits(org.seatAddons, key)` / `hasPluginSeatAddon(org, key)` in `plan-entitlements` are the readings every surface shares. |
| `listPluginFeatures()` | A declared feature's `defaultByPlan` fills the plan tables where they are silent; a key the tables already carry keeps their answer. |
| `listPluginLockdownFeatures()` / `pluginLockdownFeature(key)` | The staff lockdown checklist lists it, `lockdownFeatureLabel` / `lockdownFeatureStaffBypass` / the visitor notice read it, the owners' pause email names it by `customerName` (`lockdownFeatureCustomerName`) and never by the staff `label`, and `lockdownFeaturesForPluginApiPath` gates the declared paths (exact, or a prefix on a segment boundary) at the dispatcher — a door under a declared prefix is gated by existing. |

Registration order is deterministic: `FIRST_PARTY_PLUGINS` catalog order,
then any other id alphabetically — plugin modules load in parallel, and a
staff checklist that followed arrival order would reorder per session.

## Typed entitlement keys — `plugin-entitlement-keys`

The TYPE half of the keys above. `registerPluginEntitlements` lets a plugin
REGISTER a key; this is what makes the key part of `OrgEntitlements` and
`OrgFeatureFlags` without the core listing it.

```ts
// libs/plugins/cellar — the plugin's own module
declare module '@aglyn/aglyn/plugin-manager/plugin-entitlement-keys' {
  interface PluginEntitlementQuotas {
    bottlesPerHost?: number
  }
  interface PluginEntitlementFeatures {
    cellarTastings?: boolean
  }
}

registerPluginEntitlementKeys({
  pluginId: 'cellar',
  keys: [
    {
      key: 'bottlesPerHost',
      kind: 'quota',
      label: 'Bottles per site',
      description:
        'Counts the CATALOG, never a pour: how many bottles a site may list, ' +
        'not how many tastings it may pour from them.',
    },
    { key: 'cellarTastings', kind: 'feature', label: 'Tasting notes' },
  ],
})
```

From then on `entitlements.bottlesPerHost` type-checks everywhere
`OrgEntitlements` is read, `keyof OrgFeatureFlags` admits `cellarTastings`, and
nothing in the core names a bottle.

| API | Semantics |
| --- | --- |
| `PluginEntitlementQuotas` / `PluginEntitlementFeatures` | Empty interfaces to augment with `declare module`. Declare each key OPTIONAL — an entitlement is resolved and may be absent, like every key the core declares. |
| `registerPluginEntitlementKeys({ pluginId, keys })` | The runtime twin: who owns a key, and what it means. Idempotent per plugin; a key another plugin declared refuses the whole registration, naming both. |
| `listPluginEntitlementKeys()` / `pluginEntitlementKey(key)` / `pluginIdForEntitlementKey(key)` / `listPluginEntitlementKeysOfKind(kind)` | Everything declared, one key, its owner, and the quota or feature half. |
| `unregisterPluginEntitlementKeys(pluginId)` / `resetPluginEntitlementKeysForTests()` | A bundle unloading, and the spec reset. |

**`Required` is over the CORE halves.** `CoreOrgEntitlements` and
`CoreOrgFeatureFlags` are what `PLAN_ENTITLEMENTS` declares and what
`ResolvedOrgEntitlements` keeps exhaustive — a plan that forgets a platform
quota or gate does not compile. A plugin's figure per plan comes from its own
plan declaration (below) instead, so it joins as declared: present, and
optional, because the core compiles without the plugin's type.

**No prices here.** A seat add-on's price stays a `PLAN_PRICING` row that the
Stripe wiring reads and `check-pricing-drift` reconciles. Two places holding a
number are two places that can disagree about what a customer is charged.

**The organization DOCUMENT does not compose this way**, deliberately. Its
fields are enumerated from `org-billing.types.ts`'s SOURCE and checked against
the Firestore write-deny rules, so a field declared from a plugin's own file
would be a hole in a rules-coverage guard. A plugin's settings block goes
through `registerPluginConfigSchema` into `pluginSettings/{pluginId}`, which is
its own document under its own rule.


## Plan figures — `plugin-plan-entitlements`

The VALUE half of a typed key: what each plan includes of it. A first-party
plugin names a function under `register.planEntitlements` in
`plugins.config.json`; the manifest generator loads
`${package}/plan-entitlements`, calls it and compiles the answer into
`first-party-plugins.generated.ts`, and `PLAN_ENTITLEMENTS` composes it into
every plan row. `/pricing`, the plan comparison and every quota gate read the
composed table, so a figure reads the same whether core or a plugin wrote it.

```ts
// libs/plugins/cellar/src/lib/plan-entitlements.ts
export function cellarPlanEntitlements(): PluginPlanEntitlementsDeclaration {
  return {
    quotas: [
      {
        key: 'bottlesPerHost',
        label: 'Bottles per site',
        byPlan: { free: 0, starter: 50, pro: 500 /* …every plan */ },
      },
    ],
    features: [
      { key: 'cellarTastings', label: 'Tasting notes', byPlan: { free: false /* … */ } },
    ],
  }
}
```

| API | Semantics |
| --- | --- |
| `register.planEntitlements` | The function's name. Called by the generator, never at runtime — the pricing tables and the plan comparison read the table without loading a plugin, so a runtime registry would be one they had not filled. |
| `quotas[]` / `features[]` | `{ key, label, byPlan }`. `byPlan` names every plan (the compiled rows are typed per plan, so a missing one does not compile); a quota is a non-negative number or `Infinity` (`UNLIMITED`), a feature a boolean. A quota that is a percentage of a sale says `price: true`, which keeps an uncapped plan comp from lifting it. |
| `pluginPlanQuotas()` / `pluginPlanFeatures()` / `pluginPlanEntitlementOwner(key)` | Every compiled declaration, and who declared a key. |
| `planQuotaOf(entitlements, key)` | A resolved quota by key, for core code that compiles without the plugin's type. An undeclared key reads as `0` — nothing included — never as unlimited. |

The generator refuses a key two plugins declare, a declaration naming a
different set of plans from the others, and a figure that is not a number or a
boolean. A key the platform's own rows already carry keeps the platform's
figure, and `plugin-plan-entitlements.spec.ts` fails on it. A plugin's entry
points re-export the declaring function as a type (`export type { … }`), which
brings the key's augmentation into every program that loads the package.

## Usage axes — `plugin-usage-axes`

The meters a plugin contributes to the platform's ONE cost model
(`orgMonthlyCogsUsd`, which the discount guardrail and the staff org page
read), to the staff utilization table, and to a workspace's usage budget. A first-party plugin names a
function under `register.usageAxes`; the manifest generator loads
`${package}/usage-axes`, validates the answer and compiles it into
`first-party-plugins.generated.ts`, beside the plan figures.

```ts
// libs/plugins/cellar/src/lib/usage-axes.ts
export function cellarUsageAxes(): PluginUsageAxesDeclaration {
  return {
    costAxes: [
      { id: 'tastings', order: 35, fields: ['tastingsRun'], rate: 'perRun' },
    ],
    bands: [
      {
        id: 'tastingsRun',
        label: 'Tastings',
        order: 45,
        fields: ['tastingsRun'],
        entitlement: 'tastingsPerMonth',
        perHost: true,
      },
    ],
  }
}
```

| Field | Semantics |
| --- | --- |
| `register.usageAxes` | The function's name. Called by the generator, never at runtime — the guardrail and the staff page price a rollup without loading a plugin, and a meter a registry had not filled would price at nothing, which approves a discount. |
| `costAxes[]` | `{ id, order, fields, fallbackFields?, recordedFields?, staffFields?, rate?, live? }`. `fields` are summed from the month's usage rollup; `fallbackFields` are read only when a rollup carries none of `fields` (an older, narrower basis — a measured zero never falls back); `recordedFields` ride along so the sum stays legible and are never priced; `staffFields` are what the plugin's usage sweep writes beside the meter for its own staff columns to read — served on the staff usage rows (`null` where a rollup never wrote one) and never handed to the cost model. `rate` names a key of `ORG_COGS_UNIT_RATES_USD` — never a number: the money stays core's, beside the billed table it reconciles against — or is left out when the fields are already dollars. `live: { collection, fields }` names `orgs/{orgId}/{collection}/{month}`, whose first positive field replaces the rollup's snapshot wherever a reader fetches it. |
| `bands[]` | `{ id, label, order, fields, fallbackFields?, entitlement, perHost?, unitCostUsd?, hostCounter?, orgCounter?, alert?, metered?, consoleWarning? }`. `entitlement` is the resolved key holding what the plan includes (read with `planQuotaOf`, so an undeclared key is nothing included); `perHost` expands it by the host limit; `unitCostUsd` is set when the band is sold in a unit OF cost and the rollup records dollars, and usage is then the dollars over it, rounded up. `hostCounter` names the per-site monthly counter the band is measured by (`hosts/{hostId}/counters/{hostCounter}`, field `{month}`). `orgCounter` names the workspace-wide monthly counter a workspace band is enforced against (`orgs/{orgId}/counters/{orgCounter}`, field `{month}`): declare it when the plugin counts every unit there as well as on the site's counter, in one write, and holds its own gate to it — the Billing card then meters the band once for the organization from that counter instead of once per site. `alert: { label, noun, outcome, reached, approach }` warns the workspace as it approaches and reaches the band, from that counter, once per threshold per month: `label` names the band in the title, `noun` in the opening sentence, and `outcome`, `reached` and `approach` say what happens at it. `metered: { rate, quotedPer, noun, withheldUntil? }` makes the band an infrastructure meter, billed past what the plan includes at the published billed rate — our cost + 30% kept after card fees, rounded up (`METERED_BILLED_RATES_USD`) — beside storage and bandwidth — on the invoice sweep, the Billing card's estimate, the monthly usage summary and the staff usage rows. It needs one field and its `hostCounter`: `rate` names a key of the console's `METERED_UNIT_RATES_USD` (never a number), `quotedPer` is the count a published price is quoted per (`1000` reads "per 1,000"), `noun` is the band in running prose, and `withheldUntil` names a release flag the overage waits behind — while it is off for a workspace the units are counted and the charge is recorded as withheld (`{field}Billed`, `{field}OverageWithheldUsd`) rather than billed. A band with a `hostCounter` and no `metered` is counted: summed by the usage sweep, recorded under its first field and shown on the staff usage rows. `consoleWarning: { standing, member, approach, reached: { stops, bills }, linksUsage? }` puts the band on the console's quota banner for an organization-wide reader: `standing` is a console API path the plugin serves, asked `?orgId=`, answering `{ used, limit }` in the band's own unit under `member` (`limit: null` is no band, and no row) and `stopsAtBand`; the banner says `approach` above 80% and `reached.stops` or `reached.bills` at the band — the wall when the route does not say — and links Billing → Usage when `linksUsage`. |
| `spendLines[]` | `{ id, label, live: { collection, field }, billedFromEnv, unit? }`. A line of the workspace's monthly spend on its usage budget: `orgs/{orgId}/{collection}/{month}`'s `field`, in the dollars it is billed at. It is always shown and counts toward the budget only from the month the deployment variable `billedFromEnv` names (anything that is not a `YYYY-MM` bills nothing). `unit: { costUsd, label }` is set when the stored dollars are the platform's cost: the customer's browser then receives `ceil(dollars / costUsd)` of the unit and never the dollars. |
| `meters[]` | `{ id }` of each meter the plugin registers with the monthly usage sweep ([Usage meters](#usage-meters--plugin-usage-meters-server)). The code is registered at runtime; the declaration is what lets the sweep refuse to bill a month the registration is missing from. |
| `pluginCostAxes()` / `pluginUsageBands()` / `pluginSpendLines()` / `pluginCostAxisFields()` | Every compiled declaration, and every rollup field the cost axes read or record (`orgCogsInputFrom` forwards them). |
| `meteredPluginBands()` / `countedPluginBands()` / `orgCountedPluginBands()` / `meteredBandField(band)` / `meteredBandVerdictFields(band)` | The bands billed as infrastructure meters, the bands only counted, and the bands kept on a workspace-wide counter, in band order; the rollup field a metered band records its count under, and the two fields a withheld band records its verdict under. |
| `pluginCostAxisProjection(get)` | A month's rollup as the staff usage rows serve it: every field the axes read, record or serve to staff. A priced field reads `0` where the rollup lacks it, except one whose absence selects a fallback basis, which reads `null`, as does a recorded or staff field the rollup never wrote. |
| `declaredMeterReading(rollup, declared)` / `liveMeterReading(doc, live)` | The one reading of a declared meter: a positive finite number, or nothing. |

The generator refuses an id or an `order` another axis or band already holds
(the platform's own sit at multiples of ten), a field name that is not plain,
and a `rate` that is not a key. A rate key core does not carry throws when the
model prices it, rather than pricing the meter at zero, and
`plugin-usage-axes.spec.ts` holds every declared key to a rate that exists.

## Enablement, flags, config, fields, permissions, jobs

| API | Semantics |
| --- | --- |
| `resolveEnabledPlugins(org)` | The org switchboard: absent field → all first-party; `alwaysOn` and `alwaysOnForWorkspace` ids unioned in, so no stored list can switch them off for a workspace; unknown (marketplace) ids kept. |
| `resolveHostEnabledPlugins(org, host)` / `isHostPluginEnabled(org, host, id)` | One site's set: the org's set minus the host's `disabledPlugins` deny-list, minus the default-off ids it has not opted into. Only `alwaysOn` ids (the base component library) survive the deny-list; an `alwaysOnForWorkspace` plugin (AI) is switched off for a site like any other. An absent host field means on. Forms is `alwaysOnForWorkspace` too, and core asks this about `FORMS_PLUGIN_ID` wherever a form's server half lives: the submit route, the publish-time contract check and the published render. |
| `isLockedOnForWorkspace(id)` / `isLockedOnForSite(id)` | Whether a switch is inert: the workspace switch for `alwaysOn` and `alwaysOnForWorkspace` plugins, the site switch for `alwaysOn` alone. A catalog entry's `siteOff` carries the copy the site page shows beside the switch — what switching it off stops, and what it keeps running — and `siteOff.confirm` makes the site switch ask first, naming the published pages its `siteOff.pages` sentences describe. |
| `EnabledPluginsContext` / `isSwitchedOffForRenderedSite(pluginId, ids)` | The rendered site's plugin set, published by the host app. The node renderer draws a registered component whose FIRST-PARTY plugin is not in it exactly as it draws an unregistered one, so a server holding a bundle another site loaded renders the same page the site's browser does. |
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
