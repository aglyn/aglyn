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
| `hostActivity` | Host dashboard + a page's detail view: the activity column | `hostId`, `targetId?`, `header?`, `viewAllHref?` |
| `hostDashboard` | Host dashboard glance row, one card per capability | `hostId` |
| `orgDashboard` | The organization's Sites page, above the site grid — the org-level twin of `hostDashboard`, rendered only for an org-wide member who may open the org-level CRM | `hostId` (always `null`), `orgMount`, `basePath` (the org-level hub's path) |
| `commerceGlance` | Host dashboard commerce summary | `hostId` |
| `orgData` | Organization → Data page body | `orgId`, `org` |
| `besignerFunctions` | Besigner ƒx panel | `hostId` |
| `hostArtifactPublish` | Wherever a console page offers to publish something it holds (a site's layouts, the organization's publish panel): the dialog that publishes it. The page keeps the control that opens it, and leaves that control out when no widget is registered here | `artifact` (`{ kind, hostId?, orgId?, artifactId?, displayName?, description? }`, or `null` while nothing is open), `onClose()` |
| `orgPluginInstalls` | Organization → Plugins, above the built-in plugins: the plugins your plugin installed into the workspace, one row per installation, each linking to `/[orgSlug]/plugins/[pluginRef]` | `orgId`, `orgSlug`, `hosts` (`{ id, label }` for each site the reader can see) |
| `pluginInstallStatus` | An installation's own page, above where it runs: what the installing plugin says about the version the workspace runs. Drawn only for an installation that exists | `orgSlug`, `pluginRef` (the installation's id), `pin` (one pin of it) |
| `templateGallery` | The template gallery ("Start from a template" on a site's Pages, Layouts and Components tabs), below the site's own templates and the starters: a shelf of templates your plugin offers to install. Call `reportShelf` with `loading`, `empty` or `shown` so the gallery's "nothing matches" line counts your shelf, and `onInstalled()` once an install lands so the gallery closes | `hostId`, `kind` (`page`, `layout` or `component`), `search` (the word typed in the gallery's search, `''` for none), `onInstalled()`, `reportShelf(shelfId, state)` |
| `templateInstallStatus` | A row of a site's Templates library whose template a plugin installed, beside its Source badge: what your plugin says about the copy the site holds, such as an update to install. Drawn once per such row; draw nothing for a template you did not install | `hostId`, `template` (the row's template document, `$id` included) |
| `dashboardFooter` | Bottom of the host dashboard | `hostId` |
| `orgSettings` | Organization → Settings, below the tabs | `orgId`, `org` |
| `hostSettings` | Host setup page, below the built-in cards | `hostId` |
| `hostSeo` | A site's **Setup → SEO**, under the SEO check and above the SEO cards: fixes for what the check found, and values proposed for the cards, which each card's **Update** writes | `hostId`, `orgId`, `orgSlug`, `host`, `seo` (the stored settings), `check` (the SEO check's last report and the keyword lines it ran with; `null` until someone runs it — add to its findings, never list them again), `proposeDraft(values, key)` — puts values in the SEO cards as unsaved edits |
| `seoFields` | Inside a search listing editor, under its fields: a page's **SEO** card, and the commerce product editor's search engine listing | `hostId`, `orgId`, `orgSlug`, `subject` (the page or the product), `fields`, `values`, `hasImage`, `proposeValues(values, key)` — stages values in the editor as unsaved edits |
| `adminOrgDetail` | Staff admin org detail page (staff-only) | `orgId` |
| `orgBillingUsage` | Billing → Usage, below the meters | `orgId`, `org` (the billing-merged org doc), `canManage` |
| `orgBillingOverview` | Billing → Overview, among the plan and add-on cards | `orgId`, `org`, `plan`, `canManage` |
| `staffOrg` | Staff org page, among its cards (staff-only) | `orgId` |
| `staffUser` | Staff user page, below the account's activity (staff-only) | `uid` |
| `staffSite` | Staff site page, below its own cards (staff-only) | `hostId`, `orgId` (`''` for none), `host` (the site document, `undefined` while loading) |
| `staffOrgsListColumn` | A **column** of the staff Organizations list — see [Column zones](#column-zones) (staff-only) | per row: `row`, `orgId`, `orgIds` (every org on the page); its `Header`: `orgIds` |
| `staffOrgUsageColumn` | The staff org usage table: a column between Forms and Cost when the widget declares `column`, a line above the table otherwise (staff-only) | per month: `month`, `orgId`; above the table: `orgId`, `org` (the org document, where the page holds one) |
| `orgMember` | Team → member detail, below the member's activity | `orgId`, `uid`, `member`, `canManage` |
| `orgMembersListColumn` | A **column** of the org Team table — see [Column zones](#column-zones) | per row: `member`, `orgId`, `canManage` |
| `hostMembers` | The site collaborators card: a column of its table when the widget declares `column`, a card beneath it otherwise | per row: `member`, `hostId`, `canManage`; as a card: `hostId`, `canManage` |
| `siteMember` | A visitor account's drawer on a site's Users page, between the account's password help and its saved addresses: what your plugin holds about the person — what they bought, what they subscribe to. Each widget is a section of the drawer's column; open it with a `Divider` heading like the drawer's own | `hostId`, `member` (the account's `siteMembers` document, `$id` included; its `email` is how to find what the person did on the site) |
| `consoleDock` | The console dock: a floating panel above every route boundary in both the app and editor shells (it was `assistPanel` until AGL-3080) | `orgId`, `org`, `orgReady`, `scopedOrgId` (the org a widget may act and be metered for, `undefined` where the page names none), `orgSlug`, `hostId`, `productName`, `releaseVerdict(key)` (`{ visible, staffPreview }` for any release flag, staff bypass applied), `isStaff`, `permissionsOnHost` |
| `besignerInspector` | A section at the bottom of the besigner's Attributes panel, under the selected element's fields, on every editor the designer opens | `hostId` (`null` on an editor that names no site), `node` (the selected element) |
| `besignerToolbar` | The besigner's secondary toolbar, after undo and redo, on every editor the designer opens | `hostId` (`null` on an editor that names no site) |
| `besignerInteractions` | The besigner's Interactions section, on every editor that offers one. Your widget draws nothing: it reads the section experiments your plugin runs on the site and calls `reportSectionExperiments` from an effect, and the section badges an element that has one and offers to start one from your `create`. Report `null` to withdraw | `hostId`, `screenId` (`null` on a layout or a component, which is no page to run one on: report no `create` there), `reportSectionExperiments(reporterId, { experiments, create? } \| null)` |
| `hostScreens` | A site's **Pages** list, beside Templates and Create New Page: another way to start a page | `hostId`, `orgId` (`undefined` while the page resolves it) |
| `hostTemplates` | A site's Templates page, beside Create Template: another way to start a template | `hostId`, `orgId` |
| `hostLayouts` | A site's Layouts page, beside Templates and Create New Layout: another way to start a layout | `hostId`, `orgId` |
| `hostComponents` | A site's Components page, beside Templates and Create Component: another way to start a reusable component | `hostId`, `orgId` |
| `recordInsights` | A CRM contact's, company's, deal's or lead's page, under its header. Hosted by the CRM plugin (see [Zones a plugin hosts](#zones-a-plugin-hosts)) | `hostId` (`null` at the organization level), `orgId`, `record` (`{ kind, id, name }`), `proposeTask(task, key)` (opens the CRM's task form filled in; absent on a lead), and on a deal `stages`, `stageId` and `proposeStage(stageId, key)` (asks, then moves the deal through its stage route) |
| `recordEmail` | Inside the CRM's one-to-one composer, under the message. Hosted by the CRM plugin (see [Zones a plugin hosts](#zones-a-plugin-hosts)) | `hostId`, `orgId`, `record`, `subject`, `body`, `proposeDraft({ subject, body }, key)` (fills the composer, asking before it replaces a written message; Send is the member's) |
| `importMapping` | Inside a CRM contacts, companies, deals or leads import, under its column matching. Hosted by the CRM plugin (see [Zones a plugin hosts](#zones-a-plugin-hosts)) | `hostId`, `orgId`, `collection`, `columns` (each `{ header, shape }`, where `shape` is `email`, `phone`, `number`, `date`, `yes-no`, `url`, `text` or `empty`; never a cell), `mapping`, `proposeMapping(mapping, key)` (replaces the drawer's matching; Import is the write) |

Rules of thumb: widgets receive shell-resolved context as props and must
not reach for console-app hooks; data access goes through
`@aglyn/tenant-feature-instance` (`useFirestoreCollection`, `useUser`,
`usePluginConfig`, …). A widget renders for a workspace only when its
plugin is enabled and released — the shell never mounts widgets from
unloaded plugins.

## Zones a plugin hosts

A zone can sit on a plugin's own surface rather than on a console page, such as `hostForms`
on the forms plugin's Forms page, `hostAutomations`, `automationEditor` and `automationRun`
on the workflows plugin's Automation page, or `recordInsights`, `recordEmail` and
`importMapping` on the CRM plugin's record pages, one-to-one composer and import drawers. A plugin cannot import the console's `PluginWidgetSlot`,
so the shell hands its renderer down: read it with `useConsoleWidgetSlot()` from
`@aglyn/aglyn` and draw the zone through it.

```tsx
const Slot = useConsoleWidgetSlot()
return Slot ? <Slot slot={HOST_FORMS_ZONE.id} hostId={hostId} orgId={orgId} /> : null
```

The renderer is the same gated slot a console page mounts, so a widget there passes the
same enablement, entitlement and permission gates. Outside the console shell it is `null`,
and the zone draws nothing.

A plugin that hosts a zone also declares it, with `registerPluginZone` and a token that
carries the props it hands each widget (see
[Zones a plugin hosts](./plugin-manager-api.md#zones-a-plugin-hosts--plugin-zones) in the
plugin-manager reference). The forms, workflows and commerce plugins declare these on
their own surfaces; a widget from another plugin restates the props it reads rather than
importing the host's package:

| Zone | Where it renders | Props your widget receives |
| --- | --- | --- |
| `hostForms` | A site's Forms page, the forms plugin's, beside Create Form: another way to start a form | `hostId`, `orgId` |
| `hostAutomations` | The workflows plugin's Automation page, its Actions, beside **Add action** and **Recipes**: another way to start an automation | `hostId`, `orgId`, `openAction(actionId)` — opens a listed action in the Actions editor, and answers `false` for one the list has not read yet |
| `automationEditor` | Inside the editor of one saved automation, an action or a workflow, on the Automation page | `hostId`, `orgId`, `target` (`{ type: 'action' \| 'workflow', id, name }`, the automation as it is stored) |
| `automationRun` | On each failed run in an automation's run history | `hostId`, `orgId`, `target` (as above), `runId` (the run's entry in the site's activity log) |
| `productEditor` | The commerce product editor, under a product's description, tags and categories: copy proposed for the fields, which Save product writes | `hostId`, `orgId`, `product` (as the editor holds it), `categories`, `proposeValues(values, key)` — stages copy in the editor as unsaved edits |
| `productsHub` | The commerce products page, above its catalog table: proposals the hub writes when a member applies them | `hostId`, `orgId`, `products` (the catalog rows the hub holds), `lastImport` (the products the latest import created, with its options, or `null`), and the hub's writes a widget asks for: `applyProductCopy`, `createProductDrafts`, `createCategories`, `createDiscountDrafts` |
| `productImport` | Inside the commerce CSV import dialog: options for what happens to the imported products once they land | `hostId`, `orgId`, `count` (products the import creates), `options`, `setOption(key, on)` |

## How a zone spaces your widget

Most zones are a **stack**. The shell draws their widgets one under another,
with the same gap the page puts between its own cards, and keeps that gap
between the zone and the page's cards beside it. Render your card with no
outer margin: the zone spaces it, and a margin on your widget's root is
reset.

The other zones hand each widget to a layout the page draws itself, and the
page spaces it there:

- `hostDashboard`, `commerceGlance` and `orgDashboard`: a tile of a dashboard
  grid.
- `hostScreens`, `hostTemplates`, `hostLayouts`, `hostForms`,
  `hostComponents` and `besignerToolbar`: a control in a row.
- `hostAutomations`, `automationEditor` and `automationRun`: a control the
  workflows plugin places beside its Actions buttons, in an automation's
  editor, and on a failed run.
- `siteMember`: a section of a site user's drawer.
- `besignerInspector` and `seoFields`: a section among a panel's own fields.
- `productEditor`, `productsHub` and `productImport`: a section the commerce
  plugin places among its product editor's fields, above its catalog table,
  and in its CSV import dialog.
- `recordEmail` and `importMapping`: a section the CRM plugin places under its
  one-to-one composer's message and under an import drawer's column matching.
- `besignerFunctions`, `orgData`, `orgMarketplace`, `orgAddons` and
  `marketplaceListing`: the body of a dialog or a page.
- `consoleDock`: a floating dock.
- `besignerInteractions`: nothing; a widget there reports to the section and
  renders `null`.
- `orgMembersListColumn`, `staffOrgsListColumn` and `staffOrgUsageColumn`: a
  column of a table, or, on `staffOrgUsageColumn`, a line above it.

A widget that renders nothing leaves no gap in either kind of zone.

## Staff zones

`adminOrgDetail`, `staffOrg`, `staffUser`, `staffSite`, `staffOrgsListColumn`
and `staffOrgUsageColumn` are on the staff pages, which
name no workspace: a staff page is about an org, a site or an account, not about the
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
