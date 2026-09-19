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
| `registerPluginApiRoute(path, handler, options?)` | Registers a path under the `[...pluginApi]` dispatchers. Ownership is recorded at registration time for the per-request org gate — a disabled plugin's paths 404 for that workspace. `path` may carry `:name` segments (`ai/jobs/:jobId/cancel`); an exact registration wins over a pattern. `options.subject` names the organization (and, for a signed tokenless redirect, the account) a request is for when it names no site — see [Naming the subject](../guides/server-apis.md#route-subject). |
| `resolvePluginApiRequestSubject(path, request)` | What a dispatcher asks before its release gate when no `hostId` was named: the declared resolver's answer, read from a clone, or `null` for an undeclared route, a resolver that threw, or ids that are not plain path segments. |
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
