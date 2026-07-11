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

## The UI half

Build a bundle with `defineUiFeatureBundle` from `@aglyn/aglyn` and register
it the same way the mui bundle registers itself. The bundle automatically
declares a dependency on the `mui` bundle, so primitives and theming load
first.

```ts
import * as Aglyn from '@aglyn/aglyn'
import * as EventList from './components/event-list'

export const BUNDLE_ID = 'events-calendar'

export function registerEventsCalendarPlugin(): void {
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return
  Aglyn.plugins.addDependency(
    Aglyn.defineUiFeatureBundle(
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
generic host route (`apps/console/pages/[hostId]/[pluginSlug].tsx`) mounts
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
tenant }` — so it stays free of console-app hooks. `tenant` is the resolved
org billing doc the shell already loaded, so the page can run its own
`checkEntitlement`/`checkQuota` (e.g. per-plan limits) without the app's
org/session hooks:

```tsx
import { checkQuota, type ConsolePluginPageProps } from '@aglyn/aglyn'

export default function BookingsConsolePage({
  hostId,
  entitled,
  tenant,
}: ConsolePluginPageProps) {
  const quota = checkQuota(tenant, 'servicesPerHost', services.length)
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
   staff still preview flagged-off surfaces.
3. The generic `[hostId]/[pluginSlug]` route resolves the page with
   `resolveConsolePluginPage('/'+slug)`, renders it inside `DashboardLayout`
   under `Suspense`, and applies the release-flag `FeatureGate`. Named routes
   (setup, media, …) still win over this dynamic segment.

## Project setup

- Tag new plugin libs like the mui plugin: `["scope:lib", "scope:aglyn",
  "aglyn:addons"]` — module-boundary lint rules then apply unchanged.
- Plugin libs may import `@aglyn/plugins-mui` for primitives; nothing may
  import a feature plugin from `@aglyn/plugins-mui` (that direction is the
  anti-pattern this rule exists to stop).

## Reference implementations

- **Events calendar** (`libs/plugins/events-calendar`) — the reference: its
  whole console page lives in the plugin (AGL-313/394).
- **Bookings** (`libs/plugins/bookings`) — the second full extraction
  (AGL-395): the `booking` canvas component moved out of `plugins-mui` and the
  bookings manager out of the app; the page reads plan limits via the
  `tenant` prop + `checkQuota`.
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
- **Data** (`libs/plugins/data`) — console-only, and dual-surfaced (AGL-395):
  the datasets editor is served both as the host `/data` plugin page and,
  because datasets are org-scoped, imported directly by the org `/org/data`
  app route. The card takes the `tenant` doc as a prop so both callers drive
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
