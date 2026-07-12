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
| Widgets (`ConsoleExtension.widgets`) | barrel (`console`) | Named console zones (dashboard, org, settings, admin, besigner) | With their host page |
| Providers (`ConsoleExtension.providers`) | barrel (`console`) | Around every console page | Once the registry is populated |
| Site runtimes (`registerSiteRuntime`) | barrel (`site`) | Every published page | Client render, reading enricher props |
| Redirect resolvers / page resolvers / enrichers | `/server` | Tenant page pipeline | Per request, in that order; enricher errors isolated |
| API routes (`registerPluginApiRoute`) | `/server` | `/api/*` on both apps | Per request behind the org + release gates |
| Billing webhook handlers | `/server` | Platform Stripe events | Per event; errors → redelivery |
| Config schemas (`registerPluginConfigSchema`) | both | Settings UI + typed reads | Declared at module scope |
| Custom field types (`registerCustomFieldType`) | both | Dataset schema/record editors + validation | Declared at module scope |
| Permissions (`registerPluginPermissions`) | both | Every resolved role set | Declared at module scope |
| Scheduled jobs (`registerPluginJob`) | `/server` | The platform job beat | When due, via `/api/plugins/run-jobs` |
| Install preset mappers | barrel | Besigner drawer presets | On install-doc render |
| Realm bundles (`register(host)` / `registerApi()`) | remote artifact | Everything above via the host ABI | After the trust chain verifies |

**Which app area does each reach?** Console = nav/pages/widgets/providers;
org = `orgData`/`orgSettings`/`orgAddons` zones + org-scoped config and
permissions; hosts = host-area pages/widgets + host-scoped installs;
besigner = canvas components + `besignerFunctions` zone + drawer presets;
published sites = canvas components, runtimes, page hooks, APIs; admin
(staff) = `adminOrgDetail` zone. Core itself is extended only through
these registries — plugins never edit core code.
