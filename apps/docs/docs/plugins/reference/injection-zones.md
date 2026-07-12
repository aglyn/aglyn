---
sidebar_position: 2
title: Injection zones
description: Every named console zone a plugin widget can render into, and what each receives.
---

# Injection zones

Register a widget with `ConsoleExtension.widgets: [{ slot, widgetId,
title?, Component }]`; the shell renders it through `PluginWidgetSlot`.
The guaranteed zones are the exported `CONSOLE_WIDGET_SLOTS` catalog —
`slot` stays an open string so custom zones don't need a core release.

| Zone | Where it renders | Props your widget receives |
| --- | --- | --- |
| `hostActivity` | Host dashboard + screen-view activity column | `hostId`, `max?`, `viewAllHref?` |
| `commerceGlance` | Host dashboard commerce summary | `hostId` |
| `orgData` | Organization → Data page body | `orgId`, `tenant` |
| `besignerFunctions` | Besigner ƒx panel | `hostId` |
| `communityListing` | Marketplace listing detail body | `hostId`, `listingId`, `permissions` |
| `orgAddons` | Plugins & add-ons hub, installs section | `hostId` (the acting site) |
| `dashboardFooter` | Bottom of the host dashboard | `hostId` |
| `orgSettings` | Organization → Settings, below the tabs | `orgId`, `tenant` |
| `hostSettings` | Host setup page, below the built-in cards | `hostId` |
| `adminOrgDetail` | Staff admin org detail page (staff-only) | `orgId` |

Rules of thumb: widgets receive shell-resolved context as props and must
not reach for console-app hooks; data access goes through
`@aglyn/tenant-feature-instance` (`useFirestoreCollection`, `useUser`,
`usePluginConfig`, …). A widget renders for a workspace only when its
plugin is enabled and released — the shell never mounts widgets from
unloaded plugins.
