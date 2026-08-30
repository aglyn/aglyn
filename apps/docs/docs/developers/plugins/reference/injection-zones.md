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
| `hostActivity` | Host dashboard + screen-view activity column | `hostId`, `targetId?`, `header?`, `viewAllHref?` |
| `hostDashboard` | Host dashboard glance row, one card per capability | `hostId` |
| `commerceGlance` | Host dashboard commerce summary | `hostId` |
| `orgData` | Organization → Data page body | `orgId`, `org` |
| `besignerFunctions` | Besigner ƒx panel | `hostId` |
| `marketplaceListing` | Marketplace listing detail body | `hostId`, `listingId`, `permissions` |
| `orgAddons` | Plugins & add-ons hub, installs section | `hostId` (the acting site) |
| `dashboardFooter` | Bottom of the host dashboard | `hostId` |
| `orgSettings` | Organization → Settings, below the tabs | `orgId`, `org` |
| `hostSettings` | Host setup page, below the built-in cards | `hostId` |
| `adminOrgDetail` | Staff admin org detail page (staff-only) | `orgId` |

Rules of thumb: widgets receive shell-resolved context as props and must
not reach for console-app hooks; data access goes through
`@aglyn/tenant-feature-instance` (`useFirestoreCollection`, `useUser`,
`usePluginConfig`, …). A widget renders for a workspace only when its
plugin is enabled and released — the shell never mounts widgets from
unloaded plugins.

## `widgetId` is a persisted identifier

On the host dashboard a person chooses which cards they keep and in what
order, and that choice is stored by `widgetId`. Give a retired id to a
different card and a returning reader gets an arrangement they never made
— a card they never hid, hidden. Retire an id by leaving it reserved and
minting a new one; never reuse it.

Give every dashboard widget a `title`, matching the heading the card
itself renders. It is the name beside the switch that controls the card,
and the two sit a click apart. Without one the shell falls back to the
extension's `displayName`, which reads correctly for a plugin
contributing one card and ambiguously for one contributing several.

The reader's choice is applied strictly after enablement and entitlement
and can only subtract: a widget the workspace is not entitled to stays
absent however the stored preference is written, and a widget no stored
preference mentions renders. Nothing a plugin declares participates in
that decision.
