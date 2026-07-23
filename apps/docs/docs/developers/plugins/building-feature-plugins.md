---
sidebar_position: 3
title: Building feature plugins
description: The console-extension + frontend-UI plugin pair pattern for shipping features as plugins.
---

# Building feature plugins

Aglyn features that add both **console surface** and **site components** ship
as a single library (AGL-277) — never merged into the core `mui` plugin, which
stays purely component and theme definitions for the Besigner and hosts.

```
libs/plugins/{feature}          → Besigner/host components + the console page,
                                  and both register* entry points
                                  (published as @aglyn/plugins-{feature},
                                  depends on @aglyn/plugins-mui)
```

Plugins live directly under `libs/plugins/{feature}` (moved out of the old
`.../ui/` nesting in AGL-395) and publish as `@aglyn/plugins-{feature}`. A
plugin keeps its Besigner component, its console page, and both registration
functions in the one lib — the console half is a separate `register*Console()`
export, so the shell can register nav + pages at app load without pulling in
the Besigner canvas bundle.

**Sharing app hooks.** A relocated console page can't import console-app
hooks. Genuinely reusable ones move into a shared lib the plugin can import —
e.g. `useFirestoreCollection`, `useFirestoreDoc`, and `useHostOrgId` now live
in `@aglyn/tenant-feature-instance`, and `HubTabs` in `@aglyn/shared-ui-next`
(the app keeps thin re-export shims).

**Reaching app-only UI (media browser).** Some app UI can't move — the media
library is coupled to the org/session context. Instead of importing it, a
plugin consumes it through a context: `MediaPickerContext` /
`useMediaPicker()` in `@aglyn/aglyn` exposes `pickMedia(): Promise<PickedMedia
| null>`. The shell mounts the app's `ConsoleMediaPickerProvider` (which owns
the real dialog) around every plugin page, so a plugin component just calls
`pickMedia()` and gets the chosen asset — see the commerce product editor.
This is the escape hatch for the dependency cascade a naive promotion would
hit.

![The Plugins & add-ons hub where your plugin lands](/img/plugins/org-plugins-page.png)

## The UI half

Build a bundle with `defineUiFeatureBundle` from `@aglyn/aglyn` (the
plugin-manager registration API, AGL-415) and register
it the same way the mui bundle registers itself. The bundle automatically
declares a dependency on the `mui` bundle, so primitives and theming load
first.

```ts
import * as Aglyn from '@aglyn/aglyn'
import { defineUiFeatureBundle } from '@aglyn/aglyn'
import * as EventList from './components/event-list'

export const BUNDLE_ID = 'events-calendar'

export function registerEventsCalendarPlugin(): void {
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return
  Aglyn.plugins.addDependency(
    defineUiFeatureBundle(
      {
        bundleId: BUNDLE_ID,
        displayName: 'Events Calendar',
        components: [
          {
            component: EventList.default,
            schema: EventList.schema,
            presets: EventList.presets,
          },
        ],
      },
      Aglyn.components,
    ),
  )
}
```

:::warning Component and bundle ids are persisted
`componentId` and `pluginId` are stored in screen documents. Never rename
them — when a component moves between bundles, keep the old ids resolving
(the mui plugin's legacy-id aliases are the precedent).
:::

## The console half

Export a `ConsoleExtension` and register it at console startup. The console
shell renders the nav items **and their pages** from the registry — and
applies the `featureFlag` entitlement gate itself, so an extension can't
bypass plans. A feature plugin adds a menu item to the host app bar **and a
new page** without editing any core console file (AGL-394).

A nav item that carries a `Component` becomes a full page: the shell's
generic host route (`apps/console/app/(app)/[hostId]/[pluginSlug]/page.tsx`) mounts
it under the active host, wires the breadcrumb/header, resolves the
`featureFlag` entitlement, and passes it in as `entitled`.

```ts
import { registerConsoleExtension } from '@aglyn/aglyn'
import { lazy } from 'react'
import { mdiCalendarMonthOutline } from '@aglyn/shared-data-mdi'

// Code-split: the manager UI only loads when the page opens.
const EventsConsolePage = lazy(() => import('./components/events-console-page'))

export function registerEventsCalendarConsole(): void {
  registerConsoleExtension({
    pluginId: 'events-calendar',
    displayName: 'Events Calendar',
    featureFlag: 'eventCalendar',
    navItems: [
      {
        label: 'Events',
        href: '/events', // host-relative → '/[hostId]/events'
        navTabId: 'nav-tab-events', // reuse a release flag's staff-preview gate
        icon: { path: mdiCalendarMonthOutline.path },
        header: { title: 'Events' },
        Component: EventsConsolePage,
      },
    ],
    dashboardCards: [{ cardId: 'events-upcoming', title: 'Upcoming events' }],
  })
}
```

The page component receives `ConsolePluginPageProps` — `{ hostId, entitled,
org }` — so it stays free of console-app hooks. `org` is the resolved
org billing doc the shell already loaded, so the page can run its own
`checkEntitlement`/`checkQuota` (e.g. per-plan limits) without the app's
org/session hooks:

```tsx
import { checkQuota } from '@aglyn/aglyn'
import type { ConsolePluginPageProps } from '@aglyn/aglyn'

export default function BookingsConsolePage({
  hostId,
  entitled,
  org,
}: ConsolePluginPageProps) {
  const quota = checkQuota(org, 'servicesPerHost', services.length)
  // …authenticated Firestore reads/writes scoped to hostId
}
```

### How the shell consumes the registry

1. `apps/console/constants/register-console-plugins.ts` calls each plugin's
   `register*Console()` at import time; `_app` imports it so the registry is
   populated before any nav renders. This registers only the console half —
   never the Besigner canvas bundle — so plugin canvas code stays out of the
   general console bundle.
2. `hostNavTabItems` splices `listConsoleNavItems()` into the host tab strip.
   Nav gating is unchanged: an item's `navTabId` maps to a release flag, so
   staff still preview flagged-off surfaces. The strip itself is built by
   `useSecondaryNav()` from the current route and rendered once by
   `app/(app)/layout.tsx` — a plugin never passes tabs to a page, and pages
   have no nav props to set (AGL-754/755).
3. The generic `[hostId]/[pluginSlug]` route resolves the page with
   `resolveConsolePluginPage('/'+slug)`, renders it inside `DashboardLayout`
   under `Suspense`, and applies the release-flag `FeatureGate`. Named routes
   (setup, media, …) still win over this dynamic segment.

## Loading: org-gated and dynamic (AGL-417)

Apps never import `@aglyn/plugins-*`. `plugins.config.json` maps plugin ids
to packages and register entry points; `tools/scripts/generate-plugin-manifests.mjs`
emits the per-app loader manifests (`plugins.*.generated.ts`) — the ONLY
sanctioned plugin references outside `libs/plugins` (an nx `scope:app`
boundary rule enforces this). At runtime the core plugin loader activates
the plugins in `org.enabledPlugins` (AGL-416, org settings → Plugins):
console surfaces behind the providers gate, site/canvas surfaces behind the
editor/tenant suspense gates, API handlers lazily on first dispatch with a
per-request org gate (a disabled plugin's API 404s for that workspace).

Each first-party plugin is additionally **release-flagged** (AGL-422,
`FirstPartyPlugin.releaseFlag`): a flag staff turn off in the console
Feature Flags page subtracts the plugin from every workspace's effective
set — nav, editor, published sites, and API — with the usual staff preview
bypass. Register a flag for any new plugin (registry + Remote Config
template + the catalog entry).

## Extending beyond pages: slots, providers, runtimes, hooks (AGL-418/419)

- **Widgets** — `ConsoleExtension.widgets` render into named shell slots
  via the app's `PluginWidgetSlot`. The guaranteed zones (and the props
  each receives) are the exported `CONSOLE_WIDGET_SLOTS` catalog
  (AGL-433): `hostActivity`, `commerceGlance`, `orgData`,
  `besignerFunctions`, `communityListing`, `orgAddons`,
  `dashboardFooter`, `orgSettings`, `hostSettings`, and the staff-only
  `adminOrgDetail`.
- **Providers** — `ConsoleExtension.providers` mount around every console
  page (e.g. community's AI-assist provider).
- **Site runtimes** — `registerSiteRuntime` components run on every rendered
  tenant page (marketing's overlays/experiments/automations), reading back
  the props their server enricher wrote.
- **Site-page hooks** — `/server` entries register redirect resolvers, page
  resolvers (commerce PDP/PLP), and enrichers into the tenant loader.
- **Billing webhook hooks** — `registerBillingWebhookHandler` receives the
  platform Stripe events (commerce orders, booking payments, marketplace
  purchases live in their plugins).
- **Permissions** (AGL-435) — `registerPluginPermissions([{key, label,
  defaults: {admin, editor, viewer}}])` contributes role-resolved keys:
  they ride every resolved permission set (`ConsolePluginPageProps.
  permissions`, API-side resolution), and custom roles override them
  key-by-key. Reference adopter: commerce's `managePos`.
- **Scheduled jobs** (AGL-435) — `registerPluginJob({pluginId, name,
  intervalMinutes, handler})` on the `/server` surface; the deployment's
  scheduler POSTs `/api/plugins/run-jobs` (shared `PLUGIN_JOBS_SECRET`
  header, 501 when unconfigured) and due jobs run with error isolation.
  Keep handlers idempotent and bounded. Reference adopter: bookings'
  `expire-stale-holds`.
- **Custom field types** (AGL-434) — `registerCustomFieldType({name,
  pluginId, label, baseType, Input, validate})` adds a named field type to
  the dataset schema editor, riding an existing storage type (text/bool/
  int32/float/map — no new storage primitives). The record editor mounts
  your `Input`; your `validate` runs after the base checks on both client
  and server. Register the pure-data half from `/server` too (the AGL-428
  pattern) so imports/writes validate without a client. Reference adopter:
  community's `rating`.
- **Bootstrap phase** (AGL-429) — export `bootstrap<Surface>()`
  (`bootstrapConsole`, `bootstrapSite`, …) next to your register fn and the
  loader calls it after EVERY plugin in the batch has registered — the
  sanctioned place for cross-plugin wiring. Registers always precede
  bootstraps; a plugin bootstraps once per surface; late-loaded plugins
  bootstrap in their own batch, so read registries lazily.
- **Config schemas** (AGL-428) — declare settings once with
  `registerPluginConfigSchema` (pure-data schema module, registered from
  BOTH the client barrel and `/server` entry) and the platform provides
  the rest: a generic settings form on the Plugins & add-ons hub, storage
  in `orgs/{orgId}/pluginSettings/{pluginId}`, defaults-merged type-coerced
  reads via `getPluginConfig` (server) and `usePluginConfig` (client).
  Reference adopter: bookings' `maxDaysAhead` horizon.

## Remote bundles: the trusted realm tier (AGL-420)

Marketplace plugins normally run sandboxed in the cross-origin
`PluginFrame`. Listings a staff member has reviewed and **signed**
(`trust: 'realm'` + an Ed25519 signature over the bundle's sha256 on the
version doc) instead load INTO the app realm and use every registry above —
first-party-grade extensions installed per workspace, no repo change.

- Build with `tools/plugin-loader/realm/rollup.config.mjs`: your `react`,
  `react/jsx-runtime`, and `@aglyn/aglyn` imports compile to lookups on
  `globalThis.__AGLYN_PLUGIN_HOST__` (the app's own singletons), so the
  emitted bundle imports nothing. Export `register(host)` for client
  surfaces; `registerApi()` for server handlers.
- Publish through the community pipeline, install (pins `{version,
  sha256}`), then staff grant trust via `POST /api/admin/sign-plugin`.
- The console loads an org's realm installs before the shell renders;
  published sites load them post-hydration (additive runtimes — first
  paint never waits on a marketplace CDN). Every load verifies the sha256
  pin and the platform signature and fails closed; `revocations` is the
  hard kill switch.
- Server handler bundles are additionally gated by
  `PLUGIN_REMOTE_SERVER=enabled` + a per-deploy
  `PLUGIN_REMOTE_SERVER_BUNDLES` allowlist, default off everywhere.

Full trust chain, env matrix, and walkthrough: `docs/PLUGIN_LOADING.md` in
the repo; a runnable demo lives at `tools/plugin-loader/realm/demo`.

## The server half (API routes)

A feature's server logic — Next.js API routes backed by firebase-admin —
moves into its plugin the same way, through the **API-route registry**
(AGL-396), the server counterpart to the ConsoleExtension registry.

```ts
// libs/plugins/{feature}/src/lib/server.ts — a SEPARATE entry point that
// pulls in firebase-admin; never re-export it from the client barrel.
// Import from `@aglyn/aglyn/server` (context-free), NOT the `@aglyn/aglyn`
// barrel: the tenant's dispatcher is an App Router route handler, whose
// module graph forbids `createContext`, and the full barrel re-exports the
// client React contexts (AGL-405/408).
import { registerPluginApiRoute, type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

const listHandler: PluginApiHandler = async (req, res) => {
  // req/res are structural (not `next`) types, so the plugin stays
  // framework-light; NextApiRequest/Response satisfy them.
  res.status(200).json({ events: [] })
}

export function registerEventsCalendarApi(): void {
  registerPluginApiRoute('events/list', listHandler)
}
```

Each Next app ships **one catch-all dispatcher** that imports a server-only
registration module (`register*PluginApis()`) and resolves the request path
against the registry. Both apps are on the **App Router**
(`app/api/[...pluginApi]/route.ts`, AGL-408/410); the same `PluginApiHandler`
runs unchanged in either. The dispatcher runs the handler through the
`runLegacyHandler` adapter (`@aglyn/aglyn/server`, AGL-407), which bridges the
Web `Request`/`Response` to the framework-light `(req,res)` contract:

```ts
// app/api/[...pluginApi]/route.ts (both apps)
import { resolvePluginApiRoute, runLegacyHandler } from '@aglyn/aglyn/server'
import '../../../utils/register-plugin-apis' // side-effect registration
async function dispatch(request, { params }) {
  const { pluginApi } = await params
  const route = resolvePluginApiRoute((pluginApi ?? []).join('/'))
  if (!route) return Response.json({ error: 'Not found' }, { status: 404 })
  return runLegacyHandler(route, request, { pluginApi }) // handler unchanged
}
export { dispatch as GET, dispatch as POST, dispatch as PUT, dispatch as PATCH, dispatch as DELETE }
```

Named API routes win over the catch-all, so **URLs are preserved**: to
migrate `/api/events/list`, delete the named route file and register the
handler — the dispatcher serves the same URL. Import the plugin's `/server`
entry **only** from the dispatcher's registration module (server code); the
client barrel must never pull it in, or firebase-admin leaks into the browser
bundle. Reference: `libs/plugins/events-calendar/src/lib/server.ts`.

**Both Next apps carry a dispatcher.** The tenant (site-facing) app registers
via `registerTenantPluginApis`; the console (authoring) app has its own
dispatcher + `registerConsolePluginApis`, and plugins expose a separate
`register*ConsoleApi()` for console-only handlers (staff/merchant ops, cron
jobs) so each app registers only what it serves. A migrated route keeps its
`/api/...` URL in whichever app owned it.

**Raw-body routes.** On the App Router a handler reads the raw body directly
(`request.text()`/`arrayBuffer()`), so webhooks (Stripe `billing/webhook`,
Svix `email/events`) and size-capped uploads need no `bodyParser` config —
the old Pages Router `export const config` exceptions are gone; byte caps
are enforced in-handler.

**Build-time evaluation gotcha (AGL-410).** App Router route modules are
evaluated during `next build` (page-data collection) — unlike Pages API
routes, which never were. Module-scope side effects in a route's import
graph must therefore tolerate a credential-less build: the firebase-admin
init in `@aglyn/shared-util-fbserver` skips when the full credential is
absent, and server libs must resolve Firestore/RTDB/Auth handles lazily
inside functions, never at module scope.

### Shared server runtime (`@aglyn/tenant-runtime`)

Some handlers need tenant runtime that no single plugin owns — the host-event
fan-out (`emitHostEvent`, `runSingleAction`, `runEventWorkflows`) and the
server-side screen-composition read-path (`getScreen`, `composeScreenNodes`,
and the `get-*` loaders behind it). These live in `@aglyn/tenant-runtime`, a
server lib tagged `scope:lib`+`scope:aglyn` so both the tenant app's own API
routes and any plugin `server.ts` can import it (and it, unlike the
`scope:data` `tenant-data-admin`, may import `@aglyn/aglyn`). The host-event
functions come from the package root; the composition pipeline is reached via
subpath, e.g. `@aglyn/tenant-runtime/compose-screen-nodes`:

```ts
import { emitHostEvent } from '@aglyn/tenant-runtime'
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
```

The bookings `book`, events `dispatch`, and commerce `membership/*` handlers
are reference consumers.

## Project setup

Scaffold a new first-party plugin instead of hand-copying one (AGL-425):

```bash
node tools/scripts/create-plugin.mjs my-plugin \
  --label "My Plugin" --surfaces console,tenantApi
```

That generates the complete `libs/plugins/my-plugin` library (correctly
tagged, with register entries per surface and a passing spec), registers it
in `plugins.config.json` + the tsconfig aliases, re-runs the manifest
codegen, and prints the two manual follow-ups (catalog entry + release
flag). Community/marketplace authors start from
`tools/plugin-loader/realm/template` instead — a standalone npm package
that builds a host-ABI realm bundle.

Conventions the scaffold already applies:

- Tag new plugin libs with **exactly** `["aglyn:addons"]` — nothing else
  (AGL-409). This single tag is a plugin's whole module-boundary identity: as
  a dependency *target* no core scope's allowlist reaches it, so `nx lint`
  rejects any core lib importing `@aglyn/plugins-*` (the app can run without
  the plugin). As a *source*, the `aglyn:addons` rule still lets a plugin
  import any lib and other plugins. Do NOT add `scope:lib`/`scope:aglyn` back —
  that reopens the hole (every lib carries `scope:lib`).
- Plugins are wired in only through the generated loader manifests
  (`plugins.config.json` → `plugins.*.generated.ts`, AGL-417); core libs
  and app feature code must never import a plugin.
- Plugin libs may import `@aglyn/plugins-mui` for primitives; nothing may
  import a feature plugin from `@aglyn/plugins-mui` (that direction is the
  anti-pattern this rule exists to stop).

## Reference implementations

- **Events calendar** (`libs/plugins/events-calendar`) — the reference: its
  whole console page lives in the plugin (AGL-313/394).
- **Bookings** (`libs/plugins/bookings`) — the second full extraction
  (AGL-395): the `booking` canvas component moved out of `plugins-mui` and the
  bookings manager out of the app; the page reads plan limits via the
  `org` prop + `checkQuota`.
- **Redirects** (`libs/plugins/redirects`) — a **console-only** plugin
  (AGL-395): redirects enforce server-side (ISR), not through a canvas
  component, so it exports only `registerRedirectsConsole()` and ships no UI
  bundle — nothing to register in the tenant/besigner. The minimal shape when
  a feature has console surface but no site component.
- **Logic** (`libs/plugins/logic`) — console-only (AGL-395): variables +
  no-code functions and the reference-integrity audit. It also *exports*
  shared tooling — the where-used dialog and its fetch util, plus the
  variable/function cards — which the app's workflows surface and besigner
  ƒx button import from `@aglyn/plugins-logic`. Always-on (not release-flagged).
- **Contacts** (`libs/plugins/contacts`) — console-only (AGL-395): the unified
  contacts list, segments, and profile drawer. A whole self-contained page
  relocated with just the layout wrapper + inline `FeatureGate` stripped (the
  shell supplies both); reads the `contactsPerHost` quota off the `org` prop.
- **Inbox** (`libs/plugins/inbox`) — console-only (AGL-395): form-submissions
  reader, site members + leads, and the borrowed **Orders** and **Campaigns**
  tabs. Depends on `@aglyn/plugins-commerce` + `@aglyn/plugins-email` — a
  plugin can compose tabs from other plugins the same way the app did.
- **Community** (`libs/plugins/community`) — console-only, multi-page
  (AGL-395): the plugin owns the hub page and its cards + `useCommunityActions`,
  but the listing/publisher **detail** pages stay as app file-routes (nested
  dynamic segments the single-segment plugin route can't serve) and import the
  hook from the plugin. It's why `ConsolePluginPageProps` also carries
  `permissions` (shell-resolved) — the install action gates on `installPlugins`.
- **Marketing** (`libs/plugins/marketing`) — console-only (AGL-395): the
  at-a-glance rollup, overlay/announcement/popup managers, and A/B testing.
  The first relocated plugin to consume the media browser — the popup image
  picker calls `useMediaPicker()` (the shell mounts the provider around plugin
  pages), so the app media dialog never leaves the console app.
- **Workflows** (`libs/plugins/workflows`) — console-only (AGL-395): the
  workflow builder, actions builder, and webhooks tabs, plus the shared
  `HostActivityCard` (exported for the app dashboard + screen-view). Each tab
  gates on its own plan flag (workflows / actions / webhooks), so all three
  read the passed `org` rather than a single `entitled`. Depends on
  `@aglyn/plugins-logic` for the where-used tooling — the first plugin→plugin
  dependency.
- **Data** (`libs/plugins/data`) — console-only, and dual-surfaced (AGL-395):
  the datasets editor is served both as the host `/data` plugin page and,
  because datasets are org-scoped, imported directly by the org `/org/data`
  app route. The card takes the org doc as a prop so both callers drive
  its entitlement/quota checks. `useHostActivityLogger` was promoted to
  `@aglyn/tenant-feature-instance` for the move.
- **Email** (`libs/plugins/email`) — full console relocation (AGL-395): the
  campaigns composer, audience lists, and a dedicated email-screens list moved
  into the plugin and surface as the **Emails** page; the Besigner offers only
  email-safe blocks when editing an email document.
- **Commerce** (`libs/plugins/commerce`) — full console relocation (AGL-395):
  all Products management cards + the `CommerceConsolePage` live in the plugin;
  the product editor reaches the console media browser through
  `useMediaPicker()`.
