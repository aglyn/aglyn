---
sidebar_position: 3
title: Building feature plugins
description: The console-extension + frontend-UI plugin pair pattern for shipping features as plugins.
---

# Building feature plugins

Aglyn features that add both **console surface** and **site components** ship
as a *pair* of libraries (AGL-277) — never merged into the core `mui` plugin,
which stays purely component and theme definitions for the Besigner and hosts.

```
libs/plugins/ui/{feature}       → Besigner/host components + the console page,
                                  and both register* entry points
                                  (depends on plugins-ui-mui)
```

The events-calendar plugin keeps its Besigner component, its console page, and
both registration functions in the one `ui` lib — the console half is just a
separate `register*Console()` export, so the shell can register nav+pages at
app load without pulling in the Besigner canvas bundle.

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

The page component receives `ConsolePluginPageProps` — `{ hostId, entitled }`
— so it stays free of console-app hooks:

```tsx
import type { ConsolePluginPageProps } from '@aglyn/aglyn'

export default function EventsConsolePage({ hostId, entitled }: ConsolePluginPageProps) {
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
- UI plugin libs may import `plugins-ui-mui` for primitives; nothing may
  import a feature plugin from `plugins-ui-mui` (that direction is the
  anti-pattern this rule exists to stop).

## Reference implementations

- **Events calendar** — the first extraction; see `libs/plugins/ui/events-calendar`.
- **Commerce** — the storefront component set; see `libs/plugins/ui/commerce`.
