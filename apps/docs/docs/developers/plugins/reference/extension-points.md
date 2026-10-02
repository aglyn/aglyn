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
| Built-in themes (`ConsoleExtension.themePresets`) | barrel (`console`) | The theme picker on every site's **Setup → Theme** | When the theme page loads the plugins declaring `hostThemePresets` |
| Search sources (`ConsoleExtension.searchSources`) | barrel (`console`) | The console's search palette — one group of results per source, each row linking where the plugin says | When the palette opens and loads the plugins declaring `consoleSearch`, for a reader the extension's gates admit |
| Staff pages (`ConsoleExtension.staffPages`) | barrel (`staff`) | The staff area — a tab in the staff strip and a page at `/admin/{id}` | Once the staff area has loaded its plugins, behind the staff guard |
| Site runtimes (`registerSiteRuntime`) | barrel (`site`) | Every published page | Client render, reading enricher props |
| Redirect resolvers / page resolvers / enrichers | `/server` | Tenant page pipeline | Per request, in that order; enricher errors isolated |
| API routes (`registerPluginApiRoute`) | `/server` (`tenantApi` / `consoleApi`) | `/api/*` of the app whose surface registered the route: `tenantApi` routes answer on the published site, `consoleApi` routes on the console. Neither app loads the other's, so a route the console calls is registered from `consoleApi` | Per request behind the org + release gates |
| Billing webhook handlers | `/server` | Platform Stripe events | Per event; errors → redelivery |
| Customer REST API resources (`registerApiV1Resource`, `registerApiV1SiteResource`) | `/server` (`consoleServerDeclarations`) | `/v1/<resource>` — or `/v1/sites/{siteId}/<resource>`, behind the router's check that the key's organization owns the site — on the customer REST API, behind the router's key, quota, rate limit and plan checks | Per request; the handler loaded with the first |
| Intake gates (`registerPluginIntakeGate`) | `/server` (`serverDeclarations`) | A monitor's question about a plugin's public door — would a visitor's next write be accepted — answered by the door's own gates without writing | When the funnel probe asks, memoized per instance |
| Platform events (`registerPluginEventHandler`) | `/server` (`serverDeclarations`) | A core route's write — the AI add-on bought or dropped, a permission moved | After the write, in the route; errors logged, never the route's |
| Server steps (`registerServerStepExecutor`) | `/server` (`serverDeclarations`) | An automation step that writes the plugin's own records — the engine hands it the step, with the site, the plan document, the event and its payload | Per step of a run; a refusal or a throw is that step's failure and the run goes on; declared under `serverSteps`, and a declared step left unregistered fails rather than reading as done |
| Interaction recipes (`registerInteractionRecipes`) | both (`declarations`) | The automation editor's Recipes menu: a ready-to-edit automation the plugin writes, opened as a draft, its id stamped on what is saved | Once per process at boot; declared under `interactionRecipes` so a stored stamp is known where the plugin's declarations never ran |
| Account erasure (`registerPluginUserEraser`) | `/server` (`serverDeclarations`) | The data a plugin keeps about a person where core's deletes do not reach | During the erasure, once the memberships are removed; a failure recorded as `null`, never the erasure's |
| Workspace erasure (`registerPluginOrgEraser`) | `/server` (`serverDeclarations` or `consoleServerDeclarations`) | What a plugin holds for an organization that the erasure's own deletes cannot finish — a grant to revoke at its provider | Before the erasure deletes anything; a failure recorded as `null`, never the erasure's; a plan counts and touches no provider |
| Declarations (`declarations` / `serverDeclarations` / `consoleServerDeclarations` entries) | both (`consoleServerDeclarations`: the console's server only) | Every registry a core surface reads before the plugin has loaded | Once per process, at boot and with the console's plugin loader |
| Config schemas (`registerPluginConfigSchema`) | both | Settings UI + typed reads | Declared at module scope |
| Custom field types (`registerCustomFieldType`) | both | Dataset schema/record editors + validation | Declared at module scope |
| Permissions (`registerPluginPermissions`) | both | Every resolved role set | Declared at module scope |
| Service contracts (`definePluginServiceContract` / `registerPluginService`) | both | Another plugin's seam — an AI provider, a tool, a generator kind | Resolved lazily by the plugin that declared the contract |
| Record addresses (`registerPluginRecordRoute`) | both | Where the plugin's own records are read, by record KIND — every other surface, the console app included, asks instead of spelling the URL | Resolved when a card draws a link; `null` where the owner has no address at that scope |
| Record cards (`registerPluginRecordCardReader`) | server | What one of the plugin's records looks like in a line and an image, by record KIND — another plugin's server code draws it without reading the owner's collection or importing its model | Resolved when a handler asks; `null` where no plugin publishes the kind or the record is gone |
| Record indexes (`registerPluginRecordIndex`) | server | The live records of one KIND the plugin keeps, listed and read by id with the facts it chooses to share — another plugin's server code finds and reads them without reading the owner's collection | Resolved when a handler asks; `null` where no plugin keeps the kind here, which a reader treats as none |
| Record lists (`registerPluginRecordListSource`) | console | The same records, listed in the browser for another plugin's picker or check — the query a scope is read by (the owner's rule-proving filter) and how a stored document reads as a record | Run by the reader's own listener when it opens; `null` where no plugin keeps the kind here, which a reader treats as none |
| Tax profile (`registerPluginTaxProfile`) | server | The tenant's tax rule, owned by one plugin — what a flat rate adds to a charge and which regime a settled payment was taxed under — so every plugin that takes money prices it one way | Resolved when a charge is priced or confirmed; **throws** where no plugin owns the rule, rather than answering zero |
| Host subcollections (`registerPluginHostCollections`) | both | The media-usage scan, a reference row's deep link, and the site's artifact counters | Declared at module scope; read by each of the three when it runs |
| Contact capture (`registerPluginContactCaptureWriter`, `registerPluginContactSource`) | `/server` (`serverDeclarations`) | The person a capture silo met — the owner keys, merges, bands and stages them; the silo reports what it saw | Per capture; a refusal is RETURNED, so the silo keeps the submission or the order it already took |
| People (`registerPluginPersonRecords`) | `/server` (`serverDeclarations`) | The person behind an address or a record ref, a filing under containers, a refund — asked of the plugin that keeps people, never read off its storage | Per question; `null` when no plugin keeps people, which is not "nobody found" |
| Typed entitlement keys (`PluginEntitlementQuotas` / `PluginEntitlementFeatures` + `registerPluginEntitlementKeys`) | both | `OrgEntitlements` and `OrgFeatureFlags` themselves — the plugin's key type-checks everywhere they are read | The type composes at compile time; the registration is declared at module scope |
| Activity actions (`registerPluginActivityActions`) | both | The org feed's chips, the actor table's filter, the staff audit facet, the action label every renderer shows | Declared at module scope |
| Billing and access keys (`registerPluginEntitlements`) | both | `resolveOrgEntitlements` (a seat add-on's quota and features), the plan tables' feature defaults, the staff lockdown checklist, the visitor notice, the dispatcher's path→lever map, the permission registry, the org permission catalog and a collaborator's per-site keys | Declared at module scope |
| Usage meters (`registerPluginUsageMeter`) | `/server` (`serverDeclarations`) | The monthly usage sweep: the fields a plugin's meter writes onto a workspace's month rollup, the dollars it adds to the billed figure, and the close-out of what the plugin bills itself | Once per workspace per sweep; declared under `usageAxes` → `meters`, and a declared meter left unregistered refuses the month |
| Usage alert rules (`registerUsageAlertContributor`) | `/server` (`serverDeclarations`) | The usage-alerts sweep: the plugin's bands the workspace is warned about (`quotaChecks`) and staff alerts on a cost or ceiling core does not meter (`evaluate`), through the sweep's own thresholds, senders and guards | Once per org per sweep — quota checks after core's, staff alerts after the budget alert; a throw is isolated to the contributor |
| Subprocessor declarations (`subprocessors` entry) | generation time | The console's subprocessor inventory, which the published subprocessor list is derived from — recipients, the plugin's other hosts (`not-a-subprocessor`, `no-request`) and its uses of hosts declared elsewhere | When the manifest generator runs; a host declared twice, or a use of a host nothing declares, refuses |
| Tenant emails (`tenantEmails` entry) | generation time | The site's Emails page, the email besigner's template list and merge tokens, and the send path's designed-template lookup — each email a site sends its own customers through the plugin, keyed by its template document id | When the manifest generator runs; a key declared twice, an entry naming another plugin, or an `external` entry with no `authoredIn` refuses. First-party only: the catalog is compiled into the email lib |
| Starter sites (`starterTemplates` entry) | generation time | `STARTER_TEMPLATES`: the template gallery's Starters shelf, the route that seeds a starter into a site's library, and the examples the AI plugin shows a model — starters built around the plugin's own elements, after the platform's own | When the manifest generator runs; a starter id declared twice, a starter with no pages or a repeated page key, or a page placing another plugin's element refuses. First-party only: the list is compiled into core |
| Plan figures (`planEntitlements` entry) | generation time | `PLAN_ENTITLEMENTS` itself — what each plan includes of the plugin's own quotas and gates, read by `/pricing`, the plan comparison and every quota gate | When the manifest generator runs; a key declared twice, a plan left out or a figure that is not a number or boolean refuses |
| Record pages (`recordPages` entry) | generation time | Where a person reads a record kind the plugin's console page shows, for a server's notification link (`pluginRecordPageLink`) | When the manifest generator runs; a kind already shown or a path outside the plugin's own console routes refuses |
| Entity pickers (`entityPickers` entry) | generation time | The Besigner's id-based pickers — which attribute type lists the plugin's records, where they are read and in what words, and for a kind with fields the attribute that offers them | When the manifest generator runs; a kind or attribute type already held, an unknown scope or a field attribute without its record kind refuses |
| Usage axes (`usageAxes` entry) | generation time | The platform's cost model (`orgMonthlyCogsUsd`), which the discount guardrail, the staff org page and the margin table read, the utilization table's bands, and the usage budget's spend — the rollup fields a meter is recorded under, the core rate that prices it, the entitlement its band is measured against, and the month document holding what it came to | When the manifest generator runs; an id or order already held, a field that is not plain or a rate that is not a key refuses |
| Video hosts (`videoEmbedProviders` entry) | generation time | The Video element, the page's `VideoObject`, the built-in entry page and the published page's `frame-src` — which links play in a host's own player, where the media id sits in them, and the one origin that player is framed from | When the manifest generator runs; a domain or id declared twice, a player path that is not closed, or an origin that is not https refuses. First-party only: a declaration widens every site's `frame-src` |
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
and the `consoleDock` dock; org = `orgData`/`orgSettings`/`orgAddons`/
`orgBillingUsage`/`orgBillingOverview`/`orgMember`/`orgMembersListColumn`
zones + org-scoped config, permissions and entitlement keys; hosts =
host-area pages/widgets + the `hostMembers` zone + the `hostTheme` zone,
where a widget proposes a theme and the editor's own Save keeps it +
host-scoped installs; besigner =
canvas components + `besignerFunctions`/`besignerInspector` zones + drawer
presets; published sites = canvas components, runtimes, page hooks, APIs;
admin (staff) = `adminOrgDetail`/`staffOrg`/`staffUser`/`staffSite` zones, staff pages,
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
