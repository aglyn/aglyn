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
| `defineUiFeatureBundle(options, components)` | Site/canvas component bundle; auto-depends on the base `mui` bundle. Component and bundle ids are **persisted in screen docs — never rename**. |
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
`settingsSections?`, `widgets?`, `providers?`, `staffPages?`.

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
| `handler` as `(req, res)` or `{ web }` | The node shape takes `PluginApiRequest` / `PluginApiResponse`. The Web shape, `{ web: (request, { params }) => Response }`, takes the dispatcher's own `Request` and answers a `Response` — the form for a door that streams (server-sent events, a chat answer) or reads the raw body itself; `params` carries the path segments and every `:name` filled. |
| `PluginApiRequest` | `{ method, query, body, headers, rawBody? }` — `rawBody` carries the unparsed payload for Stripe/Svix signature verification. |
| `resolvePluginApiMatch(path)` / `runPluginApiMatch(match, request, params, runLegacy)` | What a dispatcher does: the route and its filled `:name` params for a path, then either shape run — the host app supplies `runLegacy` for the node shape. `resolvePluginApiRoute(path)` answers the node handler alone, for the specs that drive one directly. |

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
| `pluginHostArtifactCollections()` | The collections whose documents a site counts beside its screens, layouts and components. |
| `listPluginHostCollections()` / `pluginHostCollection(name)` / `pluginIdForHostCollection(name)` | Everything declared, one by name, and its owner. |
| `listPluginOrgCollections()` / `pluginOrgCollection(name)` / `pluginOrgCollectionsScannedGenerically()` | Storage that lives on the ORGANIZATION (`orgs/{orgId}/…`) rather than on a site, declared by a first-party plugin in the `orgCollections` block of `plugins.config.json` and compiled, with no runtime door. Scanned by default like a host collection (`mediaScan` is `generic` or `none`); `siteField` names the document field that says which site a row belongs to, so a reference row can name the site and link into its hub. Marketing's email sends are the first: `orgs/{orgId}/campaigns`, each carrying `hostId`. |

**The default is to scan**, and a declaration says only why it should not be.
That is inverted on purpose: "does this carry media?" needs a judgment about a
schema nobody wrote down, and a collection nobody has thought about is READ, so
a plugin shipping a media-bearing collection is covered the day it lands. A
declaration names no FIELDS — the scan flattens generically, and a field list
would be the same staleness trap one level down.

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

## The tenant's tax rule — `plugin-tax-profile` (`/server`)

More than one plugin takes money, and a merchant has one tax profile. The
plugin that keeps it answers what a flat rate adds to a charge and which regime
a settled payment was taxed under; any other plugin that charges asks here
instead of importing the owner's model.

```ts
// the owner, from each of its server registrars
registerPluginTaxProfile({
  flatTax: (rate, chargeCents, fallbackLabel) => resolveFlatTax(rate, chargeCents, fallbackLabel),
  taxModeOf: (settledPayment, manualTaxCents) => modeOf(settledPayment, manualTaxCents),
})

// a plugin that charges
const tax = pluginTaxProfile().flatTax(settings.service, chargeCents, 'Service tax')
const total = chargeCents + tax.taxCents
```

| API | Semantics |
| --- | --- |
| `registerPluginTaxProfile(profile, { pluginId? })` | A slot: a workspace has one tax profile, so a second plugin's is refused and the incumbent keeps serving. |
| `pluginTaxProfile()` | The rule — and it **throws** when no plugin registered one. |
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

## Record timeline — `plugin-record-timeline` (`/server`)

A plugin that sends mail or books meetings files what happened on the
contact, company or deal it happened with — an email sent, a reply read, a
task for a person — without writing the record system's documents or
importing its plugin. The record system registers one writer (a slot), and a
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
| `registerPluginRecordTimelineWriter(writer, { pluginId? })` | The record system's writer. A single-implementation contract: a second plugin's writer throws naming both, and the incumbent keeps serving. The CRM registers it from its console API surface. |
| `pluginRecordTimelineWriter()` | The writer with its owner, or `null` when no plugin keeps records — a caller then files nothing. |
| `writer.logActivity(request)` | An activity on a record, scoped like one a member made on `hostId`. An `email` is filed ONCE per `Message-ID`, under the id the capture address files a copy of the same message by; any other kind once per the caller's `dedupeKey`. |
| `writer.createTask(request)` | A task for `assigneeUid`, due at `dueAtMs`, filed once per `dedupeKey`. |

Both answer `{ ok: true, id, created }` — `created: false` for an entry a
previous call, or a copy through another door, already filed — or a refusal
(`{ ok: false, status, error }`: no record system on the plan, a record at its
activity ceiling), and never throw for a refusal. The registry authenticates
nobody: the caller has already decided the entry is the workspace's to write.

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

## Platform events — `plugin-events` (`/server`)

Core raises the events; a plugin that must react to what a core route did
subscribes from its `serverDeclarations` entry, so the subscription is in
place before the first request. Payloads carry the actor and the before /
after, never a reference to the plugin.

| Event | Raised by | Payload |
| --- | --- | --- |
| `org.seatAddons.changed` | the add-on checkout and the billing webhook | `{ orgId, actor, before, after }` — the `org.seatAddons` maps |
| `org.permissions.changed` | the member, role and host-member routes | `{ orgId, actor, subject: { type, id?, name? }, permission, granted }` |
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

## A meter line a plugin bills itself — `plugin-metered-lines` (`/server`)

The monthly usage sweep prices several lines into one figure and posts it as a
single Stripe meter event. A plugin that bills one of those lines its own way
claims it, and the sweep leaves it out of the metered figure from the month the
claim names — so one month's usage reaches exactly one invoice.

| API | Semantics |
| --- | --- |
| `registerPluginMeteredLine({ lineId, billsFrom, closeMonth?, pluginId? })` | Claims a line. `billsFrom()` answers the first `YYYY-MM` the plugin bills, or `null` while it is registered and not yet switched on; it is called per question, so a deployment change takes effect without a restart. One plugin per line — a second claimant throws. |
| `pluginBillsMeteredLine(lineId, month)` | What the sweep asks. `false` for an unclaimed line, a month before the claim, an unparseable start month, and a claim that throws — so every failure bills through the sweep, which already works. |
| `runPluginMeteredLineClose(lineId, context)` | Run by the sweep once a month has CLOSED, per workspace, with `{ orgId, month, org, stripeCustomerId }` — the remainder of a line charged as it accrues is owed whether or not the meter reported. Errors are logged, never the sweep's. |
| `pluginMeteredLineOwner(lineId)` | The claiming plugin, for diagnostics. |

Only the BILLING moves. A claimed line is still measured, still priced and
still written to the month's audit fields, so a month's usage history reads the
same either way and the handover is countable from the rows.

| API | Semantics |
| --- | --- |
| `registerPluginEventHandler(event, handler, { pluginId? })` | Subscribes; attributed to the registering plugin. Idempotence is the subscriber's to keep — check `listPluginEventHandlers(event)` before subscribing again after a registry reset. |
| `runPluginEventHandlers(event, payload)` | What the core route calls after its write: every handler in registration order, a failure logged and counted (`{ handled, failed }`), never the route's failure. |

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
which the tenant runtime never loads.

## Person erasure — `plugin-person-erasure` (`/server`)

The person erasure removes one person from one workspace: the contact, what
the CRM files beside it, and the leads, list memberships and delivery log
under the address. A plugin that keeps records about such a person under the
organization — keyed by the contact or by the address — registers an eraser
from its declarations:

```ts
registerPluginPersonEraser(
  async ({ orgId, email, key, contactIds, dryRun }) => {
    const { eraseEnrollmentsFor } = await import('./server/enrollments')
    return eraseEnrollmentsFor({ orgId, email, contactIds, dryRun })
  },
  { pluginId: 'acme-mail' },
)
```

| API | Semantics |
| --- | --- |
| `registerPluginPersonEraser(eraser, { pluginId? })` | One eraser per plugin; registering again replaces it in place. |
| `runPluginPersonErasers({ orgId, email, key, contactIds, dryRun })` | What the erasure calls after every site's suppression row is written and before the contacts are deleted. Every eraser in registration order; each plugin's report by plugin id, or `null` for an eraser that threw — logged, and never the erasure's failure. |

`key` is `personKey(email)`: how every suppression list names the person
without the address. A record that the person asked not to be contacted,
keyed that way, is kept — the promise outlives the data — with anything that
could identify the person removed from it. A dry run counts and writes
nothing. Reports land under `plugins` on the erasure's counts and audit row.

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
nothing about adds staff alerts to the same sweep by registering a contributor
from its `serverDeclarations` entry, importing the rule itself lazily. Import
the registry by its subpath; it is not on a barrel.

```ts
registerUsageAlertContributor({
  pluginId: 'acme-sms',
  id: 'carrier-spend',
  evaluate: async (context) => {
    const { evaluateCarrierSpend } = await import('./usage/carrier-spend-alerts')
    await evaluateCarrierSpend(context)
  },
})
```

| API | Semantics |
| --- | --- |
| `registerUsageAlertContributor(contributor)` | Idempotent per plugin and id: the same pair again replaces the earlier contributor in place. A contributor with no plugin id, no id or no `evaluate` throws. |
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
| `registerPluginActivityActions({ pluginId, group, actions })` | Idempotent per plugin; a code another plugin declared refuses the registration. Declare it from both entries, in code that is sure to run: the register function your `declarations` entry calls, or the top level of a file your `package.json` lists in `sideEffects`. |
| `pluginActivityActionLabel(action)` | What a reader sees for a code — `activityActionLabel` in the presenter reads it, so every feed, table and card shows the same words. |
| `listPluginActivityFilters()` | One chip per group with the codes it keeps: the org feed and the actor table draw their chips from this, and send `action isAnyOf …`. |
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
      label: 'AI generation',
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
| `listPluginLockdownFeatures()` / `pluginLockdownFeature(key)` | The staff lockdown checklist lists it, `lockdownFeatureLabel` / `lockdownFeatureStaffBypass` / the visitor notice read it, and `lockdownFeaturesForPluginApiPath` gates the declared paths (exact, or a prefix on a segment boundary) at the dispatcher — a door under a declared prefix is gated by existing. |

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
quota or gate does not compile. A plugin's band comes from its own seat add-on
declaration instead, so it joins as declared: present, and optional, because a
workspace without the plugin has no value for it.

**No prices here.** A seat add-on's price stays a `PLAN_PRICING` row that the
Stripe wiring reads and `check-pricing-drift` reconciles. Two places holding a
number are two places that can disagree about what a customer is charged.

**The organization DOCUMENT does not compose this way**, deliberately. Its
fields are enumerated from `org-billing.types.ts`'s SOURCE and checked against
the Firestore write-deny rules, so a field declared from a plugin's own file
would be a hole in a rules-coverage guard. A plugin's settings block goes
through `registerPluginConfigSchema` into `pluginSettings/{pluginId}`, which is
its own document under its own rule.

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
