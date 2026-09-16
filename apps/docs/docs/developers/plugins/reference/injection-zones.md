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
| `orgDashboard` | The organization's Sites page, above the site grid — the org-level twin of `hostDashboard`, rendered only for an org-wide member who may open the org-level CRM | `hostId` (always `null`), `orgMount`, `basePath` (the org-level hub's path) |
| `commerceGlance` | Host dashboard commerce summary | `hostId` |
| `orgData` | Organization → Data page body | `orgId`, `org` |
| `besignerFunctions` | Besigner ƒx panel | `hostId` |
| `marketplaceListing` | Marketplace listing detail body | `hostId`, `listingId`, `permissions` |
| `orgAddons` | Plugins & add-ons hub, installs section | `hostId` (the acting site) |
| `dashboardFooter` | Bottom of the host dashboard | `hostId` |
| `orgSettings` | Organization → Settings, below the tabs | `orgId`, `org` |
| `hostSettings` | Host setup page, below the built-in cards | `hostId` |
| `adminOrgDetail` | Staff admin org detail page (staff-only) | `orgId` |
| `orgBillingUsage` | Billing → Usage, below the meters | `orgId`, `org` (the billing-merged org doc), `canManage` |
| `orgBillingOverview` | Billing → Overview, among the plan and add-on cards | `orgId`, `org`, `plan`, `canManage` |
| `staffOrg` | Staff org page, among its cards (staff-only) | `orgId` |
| `staffUser` | Staff user page, below the account's activity (staff-only) | `uid` |
| `staffOrgsListColumn` | A **column** of the staff Organizations list — see [Column zones](#column-zones) (staff-only) | per row: `row`, `orgId`, `orgIds` (every org on the page); its `Header`: `orgIds` |
| `staffOrgUsageColumn` | The staff org usage table: a column between Forms and Cost when the widget declares `column`, a line above the table otherwise (staff-only) | per month: `month`, `orgId`; above the table: `orgId`, `org` (the org document, where the page holds one) |
| `orgMember` | Team → member detail, below the member's activity | `orgId`, `uid`, `member`, `canManage` |
| `orgMembersListColumn` | A **column** of the org Team table — see [Column zones](#column-zones) | per row: `member`, `orgId`, `canManage` |
| `hostMembers` | The site collaborators card: a column of its table when the widget declares `column`, a card beneath it otherwise | per row: `member`, `hostId`, `canManage`; as a card: `hostId`, `canManage` |
| `assistPanel` | The console shell's assistant dock, above every route boundary in both the app and editor shells | none — resolve your own scope from the URL |
| `besignerInspector` | A section at the bottom of the besigner's Attributes panel, under the selected element's fields, on every editor the designer opens | `hostId` (`null` on an editor that names no site), `node` (the selected element) |
| `besignerToolbar` | The besigner's secondary toolbar, after undo and redo, on every editor the designer opens | `hostId` (`null` on an editor that names no site) |
| `hostScreens` | A site's Screens page, beside Templates and Create New Screen: another way to start a screen | `hostId`, `orgId` (`undefined` while the page resolves it) |
| `hostTemplates` | A site's Templates page, beside Create Template: another way to start a template | `hostId`, `orgId` |
| `hostLayouts` | A site's Layouts page, beside Templates and Create New Layout: another way to start a layout | `hostId`, `orgId` |
| `hostForms` | A site's Forms page, beside Create Form: another way to start a form. The Forms page is the forms plugin's, which hosts the zone — see [Zones a plugin hosts](#zones-a-plugin-hosts) | `hostId`, `orgId` |
| `hostComponents` | A site's Components page, beside Templates and Create Component: another way to start a reusable component | `hostId`, `orgId` |

Rules of thumb: widgets receive shell-resolved context as props and must
not reach for console-app hooks; data access goes through
`@aglyn/tenant-feature-instance` (`useFirestoreCollection`, `useUser`,
`usePluginConfig`, …). A widget renders for a workspace only when its
plugin is enabled and released — the shell never mounts widgets from
unloaded plugins.

## Zones a plugin hosts

A zone can sit on a plugin's own surface rather than on a console page, such as `hostForms`
on the forms plugin's Forms page. A plugin cannot import the console's `PluginWidgetSlot`,
so the shell hands its renderer down: read it with `useConsoleWidgetSlot()` from
`@aglyn/aglyn` and draw the zone through it.

```tsx
const Slot = useConsoleWidgetSlot()
return Slot ? <Slot slot="hostForms" hostId={hostId} orgId={orgId} /> : null
```

The renderer is the same gated slot a console page mounts, so a widget there passes the
same enablement, entitlement and permission gates. Outside the console shell it is `null`,
and the zone draws nothing.

## Staff zones

`adminOrgDetail`, `staffOrg`, `staffUser`, `staffOrgsListColumn` and
`staffOrgUsageColumn` are on the staff pages, which
name no workspace: a staff page is about an org or an account, not about the
reader's own. So these zones do not read an org's enabled plugins. The staff
area loads every plugin whose `plugins.config.json` entry names a `staff`
register surface (see [the manifest](./manifest-and-envs.md)), before any
staff page renders, and a staff zone renders those plugins' widgets. A
widget's `featureFlag` and `permission` are not consulted there: both are
answers about a workspace, and the staff area's guard admits the reader.
A plugin with a widget on a staff zone and no `staff` surface is never
loaded on the staff pages, so its widget never renders.

## Column zones

A zone documented as a **column** (`orgMembersListColumn` and
`staffOrgsListColumn`, and `hostMembers` and `staffOrgUsageColumn` when you
want a column rather than a card) takes a widget with a `column`:

```ts
widgets: [
  {
    slot: 'orgMembersListColumn',
    widgetId: 'ai-usage-column',
    column: { header: 'AI this month', sortKey: 'aiCredits', align: 'right' },
    Component: AiUsageCell, // rendered once per row with { member, orgId, canManage }
  },
]
```

The table draws the header and mounts your component once per row with the
row beside the zone's props; `sortKey` names the row field a sortable table
orders by (the two member tables render in fetch order today and carry it
for the ones that will). A widget on a column zone without a `column` is not
a column and renders nothing there — register a card on a card zone instead.
On a zone that takes both, a column widget is drawn only in the table, never
among the cards.

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
