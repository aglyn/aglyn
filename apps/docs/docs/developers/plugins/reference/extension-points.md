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
| Staff pages (`ConsoleExtension.staffPages`) | barrel (`staff`) | The staff area — a tab in the staff strip and a page at `/admin/{id}` | Once the staff area has loaded its plugins, behind the staff guard |
| Site runtimes (`registerSiteRuntime`) | barrel (`site`) | Every published page | Client render, reading enricher props |
| Redirect resolvers / page resolvers / enrichers | `/server` | Tenant page pipeline | Per request, in that order; enricher errors isolated |
| API routes (`registerPluginApiRoute`) | `/server` | `/api/*` on both apps | Per request behind the org + release gates |
| Billing webhook handlers | `/server` | Platform Stripe events | Per event; errors → redelivery |
| Platform events (`registerPluginEventHandler`) | `/server` (`serverDeclarations`) | A core route's write — the AI add-on bought or dropped, a permission moved | After the write, in the route; errors logged, never the route's |
| Account erasure (`registerPluginUserEraser`) | `/server` (`serverDeclarations`) | The data a plugin keeps about a person where core's deletes do not reach | During the erasure, once the memberships are removed; a failure recorded as `null`, never the erasure's |
| Declarations (`declarations` / `serverDeclarations` entries) | both | Every registry a core surface reads before the plugin has loaded | Once per process, at boot and with the console's plugin loader |
| Config schemas (`registerPluginConfigSchema`) | both | Settings UI + typed reads | Declared at module scope |
| Custom field types (`registerCustomFieldType`) | both | Dataset schema/record editors + validation | Declared at module scope |
| Permissions (`registerPluginPermissions`) | both | Every resolved role set | Declared at module scope |
| Service contracts (`definePluginServiceContract` / `registerPluginService`) | both | Another plugin's seam — an AI provider, a tool, a generator kind | Resolved lazily by the plugin that declared the contract |
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
