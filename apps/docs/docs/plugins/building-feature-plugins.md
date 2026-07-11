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
libs/plugins/ui/{feature}       → Besigner/host components (depends on plugins-ui-mui)
libs/plugins/console/{feature}  → console nav, dashboard cards, settings
```

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
shell renders the nav items, dashboard cards, and settings sections — and
applies the `featureFlag` entitlement gate itself, so an extension can't
bypass plans.

```ts
import { registerConsoleExtension } from '@aglyn/aglyn'

registerConsoleExtension({
  pluginId: 'events-calendar',
  displayName: 'Events Calendar',
  featureFlag: 'eventCalendar',
  navItems: [{ label: 'Events', href: '/manage/events' }],
  dashboardCards: [{ cardId: 'events-upcoming', title: 'Upcoming events' }],
})
```

## Project setup

- Tag new plugin libs like the mui plugin: `["scope:lib", "scope:aglyn",
  "aglyn:addons"]` — module-boundary lint rules then apply unchanged.
- UI plugin libs may import `plugins-ui-mui` for primitives; nothing may
  import a feature plugin from `plugins-ui-mui` (that direction is the
  anti-pattern this rule exists to stop).

## Reference implementations

- **Events calendar** — the first extraction; see `libs/plugins/ui/events-calendar`.
- **Commerce** — the storefront component set; see `libs/plugins/ui/commerce`.
