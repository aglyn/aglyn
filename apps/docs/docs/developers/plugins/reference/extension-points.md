---
sidebar_position: 4
title: Extension-point catalog
description: Every surface a plugin can extend, when it runs, and which part of Aglyn it reaches.
---

# Extension-point catalog

The surface matrix: what a plugin can extend, from which entry
(`barrel` = client, `/server` = API process), and when it runs.

| Extension point | Entry | Reaches | Runs |
| --- | --- | --- | --- |
| Canvas components (`defineUiFeatureBundle`) | barrel (`site`) | Besigner + published sites | Editor gates / SSR-suspended page load |
| Console nav + pages (`ConsoleExtension.navItems`) | barrel (`console`) | Console host area | After the org resolves, before the shell paints |
| Widgets (`ConsoleExtension.widgets`) | barrel (`console`) | Named console zones (dashboard, org, billing, team, staff, besigner, the assistant dock) — a widget with a `column` is a column of a shell-owned table | With their host page |
| Providers (`ConsoleExtension.providers`) | barrel (`console`) | Around every console page | Once the registry is populated |
| Zones a plugin HOSTS (`definePluginZone` / `registerPluginZone`) | barrel (`console`) | A position on a page the plugin owns, with the props it hands each widget carried on the token — so another plugin writes a widget for it without importing the owner | With the page that draws `useConsoleWidgetSlot()`; the token itself is type-only and ships nothing |
| Staff pages (`ConsoleExtension.staffPages`) | barrel (`staff`) | The staff area — a tab in the staff strip and a page at `/admin/{id}` | Once the staff area has loaded its plugins, behind the staff guard |
| Site runtimes (`registerSiteRuntime`) | barrel (`site`) | Every published page | Client render, reading enricher props |
| Redirect resolvers / page resolvers / enrichers | `/server` | Tenant page pipeline | Per request, in that order; enricher errors isolated |
| API routes (`registerPluginApiRoute`) | `/server` | `/api/*` on both apps | Per request behind the org + release gates |
| Billing webhook handlers | `/server` | Platform Stripe events | Per event; errors → redelivery |
| Platform events (`registerPluginEventHandler`) | `/server` (`serverDeclarations`) | A core route's write — the AI add-on bought or dropped, a permission moved | After the write, in the route; errors logged, never the route's |
| Account erasure (`registerPluginUserEraser`) | `/server` (`serverDeclarations`) | The data a plugin keeps about a person where core's deletes do not reach | During the erasure, once the memberships are removed; a failure recorded as `null`, never the erasure's |
| Workspace erasure (`registerPluginOrgEraser`) | `/server` (`serverDeclarations` or `consoleServerDeclarations`) | What a plugin holds for an organization that the erasure's own deletes cannot finish — a grant to revoke at its provider | Before the erasure deletes anything; a failure recorded as `null`, never the erasure's; a plan counts and touches no provider |
| Declarations (`declarations` / `serverDeclarations` / `consoleServerDeclarations` entries) | both (`consoleServerDeclarations`: the console's server only) | Every registry a core surface reads before the plugin has loaded | Once per process, at boot and with the console's plugin loader |
| Config schemas (`registerPluginConfigSchema`) | both | Settings UI + typed reads | Declared at module scope |
| Custom field types (`registerCustomFieldType`) | both | Dataset schema/record editors + validation | Declared at module scope |
| Permissions (`registerPluginPermissions`) | both | Every resolved role set | Declared at module scope |
| Service contracts (`definePluginServiceContract` / `registerPluginService`) | both | Another plugin's seam — an AI provider, a tool, a generator kind | Resolved lazily by the plugin that declared the contract |
| Record addresses (`registerPluginRecordRoute`) | both | Where the plugin's own records are read, by record KIND — every other surface, the console app included, asks instead of spelling the URL | Resolved when a card draws a link; `null` where the owner has no address at that scope |
| Record cards (`registerPluginRecordCardReader`) | server | What one of the plugin's records looks like in a line and an image, by record KIND — another plugin's server code draws it without reading the owner's collection or importing its model | Resolved when a handler asks; `null` where no plugin publishes the kind or the record is gone |
| Host subcollections (`registerPluginHostCollections`) | both | The media-usage scan, a reference row's deep link, and the site's artifact counters | Declared at module scope; read by each of the three when it runs |
| Contact capture (`registerPluginContactCaptureWriter`, `registerPluginContactSource`) | `/server` (`serverDeclarations`) | The person a capture silo met — the owner keys, merges, bands and stages them; the silo reports what it saw | Per capture; a refusal is RETURNED, so the silo keeps the submission or the order it already took |
| Typed entitlement keys (`PluginEntitlementQuotas` / `PluginEntitlementFeatures` + `registerPluginEntitlementKeys`) | both | `OrgEntitlements` and `OrgFeatureFlags` themselves — the plugin's key type-checks everywhere they are read | The type composes at compile time; the registration is declared at module scope |
| Activity actions (`registerPluginActivityActions`) | both | The org feed's chips, the actor table's filter, the staff audit facet, the action label every renderer shows | Declared at module scope |
| Billing and access keys (`registerPluginEntitlements`) | both | `resolveOrgEntitlements` (a seat add-on's quota and features), the plan tables' feature defaults, the staff lockdown checklist, the visitor notice, the dispatcher's path→lever map, the permission registry, the org permission catalog and a collaborator's per-site keys | Declared at module scope |
| Usage alert rules (`registerUsageAlertContributor`) | `/server` (`serverDeclarations`) | The usage-alerts sweep: staff alerts on a cost or ceiling core does not meter, through the sweep's own senders and guards | Once per org per sweep, after core's budget alert; a throw is isolated to the contributor |
| Subprocessor declarations (`subprocessors` entry) | generation time | The console's subprocessor inventory, which the published subprocessor list is derived from — recipients, the plugin's other hosts (`not-a-subprocessor`, `no-request`) and its uses of hosts declared elsewhere | When the manifest generator runs; a host declared twice, or a use of a host nothing declares, refuses |
| Scheduled jobs (`registerPluginJob`) | `/server` | The platform job beat | When due, via `/api/plugins/run-jobs` |
| Install preset mappers | barrel | Besigner drawer presets | On install-doc render |
| Realm bundles (`register(host)` / `registerApi()`) | remote artifact | Everything above via the host ABI | After the trust chain verifies |

**"Declared at module scope" means a module the bundler keeps.** A registry
call at a file's top level runs only when that file is evaluated. If your
`package.json` declares `sideEffects` and does not list the file, Turbopack
and webpack delete an import that uses none of its exports, such as
`import './register-jobs'`, while jest still runs it, so the registration
works in every spec and in neither app (AGL-3025). Make the call from a
register function your manifest entry names, or list the file in
`sideEffects`.

**Which app area does each reach?** Console = nav/pages/widgets/providers
and the `assistPanel` dock; org = `orgData`/`orgSettings`/`orgAddons`/
`orgBillingUsage`/`orgBillingOverview`/`orgMember`/`orgMembersListColumn`
zones + org-scoped config, permissions and entitlement keys; hosts =
host-area pages/widgets + the `hostMembers` zone + the `hostTheme` zone,
where a widget proposes a theme and the editor's own Save keeps it +
host-scoped installs; besigner =
canvas components + `besignerFunctions`/`besignerInspector` zones + drawer
presets; published sites = canvas components, runtimes, page hooks, APIs;
admin (staff) = `adminOrgDetail`/`staffOrg`/`staffUser` zones, staff pages,
and the lockdown levers a plugin declares. Core itself is extended only through
these registries — plugins never edit core code, and a capability core
lacks is added as a generic seam every plugin can use, never as a hook for
one.

**And a plugin's own surfaces are declared, not listed in core.** The zones it
hosts, the addresses its records are read at, the `hosts/{hostId}` collections
it writes and the entitlement keys it sells are each declared by the plugin
that owns them, with one owner per id and a second claimant refused naming
both. A core file that listed any of them would be the platform holding a map
of its plugins — a map that falls out of step the day a plugin ships something
nobody remembered to add to it.
