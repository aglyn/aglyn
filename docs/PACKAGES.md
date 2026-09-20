# Packages

Every `libs/**` project is a future npm package, and each is meant to be
taken on its own. Someone who wants to build their own editor takes the
besigner logic and the core; someone who wants the editor as it ships takes
the besigner UI on top of those; the console, the staff console, the tenant
runtime and every plugin are each one package. Publishing is a later project
(see [Later](#later)); what this document does now is state the map, so that
every change made from here on keeps to it, and describe how the map is held.

The map is held in these places, and they agree by construction:

| where | what |
| -- | -- |
| `tools/scripts/lib/lib-boundaries.mjs` | `DEP_CONSTRAINTS` — the map as data: which `scope:` may import which |
| `eslint.config.mjs` | `@nx/enforce-module-boundaries` takes those constraints, so every file is judged at lint; a project on the allowlist spreads `boundaryOverridesFor(import.meta.url)` from its own `eslint.config.mjs`, which allows exactly its listed targets and nothing more |
| `tools/scripts/check-lib-boundaries.mjs` | `check:lib-boundaries` judges the same constraints over `nx graph`, checks this document has a row for every project, and checks every lib `package.json` |
| `tools/scripts/lib-boundaries-allowlist.json` | the edges that break the map today, one row each; the guard is red for a row that is missing **and** for a row the graph no longer has |
| `tools/scripts/check-plugin-domain-in-core.mjs` | `check:plugin-domain-in-core` holds Rule 3, which the import graph cannot see: a domain-named file or route directory, a vendor literal, a first-party plugin id or a static plugin import in any tree that is not a plugin |
| `tools/scripts/plugin-domain-in-core-allowlist.json` | the files that carry a plugin's domain outside its plugin today, each with the AGL-3080 lane that moves it, or `stays` and the argument; red for a finding with no row **and** for a row nothing trips (`--prune`) |

```sh
npm run check:lib-boundaries                        # the guard (a few seconds; runs `nx graph`)
npm run test:lib-boundaries                         # its forced reds
npm run check:plugin-domain-in-core                 # Rule 3 (a second; reads tracked source)
npm run test:plugin-domain-in-core                  # its forced reds
npx nx graph --file=/tmp/graph.json                 # the baseline this document summarizes
node tools/scripts/run-guards.mjs --only check:lib-boundaries
```

## The scopes

Each project carries one `scope:` tag naming the package family it publishes
in, and one or more `type:` tags naming its kind (`data`, `util`, `ui`,
`feature`). The older tags (`scope:lib`, `scope:aglyn`, `scope:data|ui|util|
feature`, `aglyn:framework|besigner|tenancy|addons`) stay: their rules still
hold and the new axis sits beside them.

| scope | may import | what it is |
| -- | -- | -- |
| `scope:shared` | `shared` | Generic libraries with no knowledge of Aglyn's model. The floor everything stands on, so it stands on nothing — and no plugin's domain stands on it either, types included: a model, a route table or a field vocabulary two plugins agree on is still that domain's, and `shared` is not where it goes (Rule 4). |
| `scope:core` | `core`, `shared` | `@aglyn/aglyn`: the platform model, its managers, its plugin-manager seams — no rendering, no designer, no tenancy, no plugin. |
| `scope:renderer` | `renderer`, `core`, `shared` | A node tree to React. |
| `scope:besigner` | `besigner`, `core`, `shared` | The designer's logic, publishable without its UI. |
| `scope:besigner-ui` | `besigner-ui`, `besigner`, `renderer`, `core`, `shared` | The designer's React surface. |
| `scope:tenant` | `tenant`, `renderer`, `core`, `shared` | The runtime that serves a published site, and the tenant app shell. Plugins reach it only through the loader manifests. |
| `scope:console` | everything above, plugins only dynamically | The console app. |
| `scope:plugin` | `tenant`, `renderer`, `besigner`, `core`, `shared` | A feature plugin. Never another plugin; never the designer UI. Its domain lives here and nowhere else — what it imports from the layers below it is generic, never its own model wearing a lower layer's tag. |
| `scope:cli` | `cli`, `core`, `shared` | The command-line client. |

The `type:` axis is the same rule the `scope:data|ui|util|feature` tags
already enforce, restated in the map's vocabulary: `data` and `util` import
each other only; `ui` adds `ui`; `feature` imports anything.

## The map

`npm name` is today's `tsconfig.base.json` alias, which is what every import
already says. **Entry points** are what the package's `exports` map publishes:
`.` is `src/index.ts`; `./server` is `src/server.ts` where one exists; `./*` is
`src/lib/*` where a deep alias (`@aglyn/x/*`) exists today. A deep alias is a
published subpath, not a private door — the console's shells import the core
by subpath on purpose (AGL-2706) so a page pays for what it uses, and a
consumer gets the same choice. **Consumer** marks the pieces someone takes on
their own; the rest are published because those depend on them.

A plugin with both a site half and a console half publishes `./site`
(`src/lib/site.ts`) and names it in its `plugins.config.json` `modules`
(AGL-3116). The loader reads a register function off the module it loaded, so
a bundler keeps everything that module exports: loading the site surface from
`.` carried the console registrar, its nav entries and its lazy pages onto
every published page that used the plugin. `./site` is how a published page
gets the canvas half alone, and it rides the `./*` alias the table already
lists.

### Core

| project | npm name | root | tags | consumer | entry points |
| -- | -- | -- | -- | -- | -- |
| `aglyn` | `@aglyn/aglyn` | `libs/aglyn` | `scope:core` `type:data` `type:feature` | yes | `.`, `./server`, `./*` |
| `aglyn-markdown-editor` | `@aglyn/aglyn-markdown-editor` | `libs/aglyn-markdown-editor` | `scope:core` `type:ui` | with the designer UI | `.`, `./*` |
| `aglyn-node-renderer` | `@aglyn/aglyn-node-renderer` | `libs/aglyn-node-renderer` | `scope:renderer` `type:feature` | yes | `.`, `./*` |
| `cli` | `@aglyn/cli` | `libs/cli` | `scope:cli` `type:util` | yes — already on the registry at its own version | `.` |

### Designer

| project | npm name | root | tags | consumer | entry points |
| -- | -- | -- | -- | -- | -- |
| `besigner-core` | `@aglyn/besigner` | `libs/besigner/core` | `scope:besigner` `type:data` `type:feature` | yes — the logic, for a build-your-own-UI consumer | `.`, `./*` |
| `besigner-feature-designer` | `@aglyn/besigner-ui` | `libs/besigner/feature/designer` | `scope:besigner-ui` `type:feature` | yes — the editor as it ships | `.`, `./*` |

### Tenant runtime

| project | npm name | root | tags | consumer | entry points |
| -- | -- | -- | -- | -- | -- |
| `tenant-runtime` | `@aglyn/tenant-runtime` | `libs/tenant/runtime` | `scope:tenant` `type:feature` | yes | `.`, `./*` |
| `tenant-data-admin` | `@aglyn/tenant-data-admin` | `libs/tenant/data/admin` | `scope:tenant` `type:data` | with the runtime — its server data layer | `.`, `./*` |
| `tenant-feature-instance` | `@aglyn/tenant-feature-instance` | `libs/tenant/feature/instance` | `scope:tenant` `type:feature` | with the runtime — the client hooks a site instance uses | `.`, `./*` |

`tenant-runtime` raises host events and runs none of what they trigger:
`emitHostEvent` hands each event to the listeners in `host-event-listeners`,
which a plugin joins by a call from its `serverDeclarations` entry. The
automation engine — the workflow and action runners, their step executors and
the flow enrollments — is one such listener and lives in `plugins-workflows`
(AGL-3105).

### Plugins

Each plugin is one package. `libs/plugins/ai` (`@aglyn/plugins-ai`, AGL-2939)
takes the same tags and the same row shape when it lands; a plugin's
`project.json` needs `scope:plugin` and `type:feature` and nothing else here
changes, because every rule is by tag.

| project | npm name | root | tags | consumer | entry points |
| -- | -- | -- | -- | -- | -- |
| `plugins-ai` | `@aglyn/plugins-ai` | `libs/plugins/ai` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-bookings` | `@aglyn/plugins-bookings` | `libs/plugins/bookings` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-commerce` | `@aglyn/plugins-commerce` | `libs/plugins/commerce` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-crm` | `@aglyn/plugins-crm` | `libs/plugins/crm` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-data` | `@aglyn/plugins-data` | `libs/plugins/data` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-email` | `@aglyn/plugins-email` | `libs/plugins/email` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-events-calendar` | `@aglyn/plugins-events-calendar` | `libs/plugins/events-calendar` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-forms` | `@aglyn/plugins-forms` | `libs/plugins/forms` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-inbox` | `@aglyn/plugins-inbox` | `libs/plugins/inbox` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-logic` | `@aglyn/plugins-logic` | `libs/plugins/logic` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-marketing` | `@aglyn/plugins-marketing` | `libs/plugins/marketing` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-marketplace` | `@aglyn/plugins-marketplace` | `libs/plugins/marketplace` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-mui` | `@aglyn/plugins-mui` | `libs/plugins/mui` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-outreach` | `@aglyn/plugins-outreach` | `libs/plugins/outreach` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-redirects` | `@aglyn/plugins-redirects` | `libs/plugins/redirects` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-video-delivery` | `@aglyn/plugins-video-delivery` | `libs/plugins/video-delivery` | `scope:plugin` `type:feature` | yes — library video served from Cloudflare R2 through a Worker, behind core's `core.media-delivery` contract | `.`, `./*` |
| `plugins-workflows` | `@aglyn/plugins-workflows` | `libs/plugins/workflows` | `scope:plugin` `type:feature` | yes — the Automation section and the automation engine | `.`, `./*` |

**What a plugin contributes, and where (AGL-3116).** Every plugin declares
`contributes` — its `plugins.config.json` entry for the packages above, its
published manifest for a marketplace plugin — and the loaders place it by that
declaration alone. A published page loads a plugin only where it places one of
the plugin's components or the site runs one of its features; a console screen
only where it renders one of its slots or routes, or where the shell draws its
nav tab or provider. Installing a plugin loads nothing. The contract, and the
default for a marketplace version published before it, live in core
(`plugin-manager/plugin-contributions.ts`); the generator validates the
catalog's entries and `apps/console/specs/plugin-contributions-declared.spec.ts`
holds them to what each registrar registers.

### Shared

Published as dependencies of the packages above, and usable on their own by
anyone who wants a generic piece; none is a product surface, and none holds a
plugin's domain (Rule 4). One row below breaks that second half today and is
marked where it sits.

| project | npm name | root | tags | entry points |
| -- | -- | -- | -- | -- |
| `shared-data-enums` | `@aglyn/shared-data-enums` | `libs/shared/data/enums` | `scope:shared` `type:data` | `.`, `./*` |
| `shared-data-forms` | `@aglyn/shared-data-forms` | `libs/shared/data/forms` | `scope:shared` `type:data` | `.`, `./*` |
| `shared-data-mdi` | `@aglyn/shared-data-mdi` | `libs/shared/data/mdi` | `scope:shared` `type:data` | `.`, `./*` |
| `shared-data-regex` | `@aglyn/shared-data-regex` | `libs/shared/data/regex` | `scope:shared` `type:data` | `.`, `./*` |
| `shared-data-types` | `@aglyn/shared-data-types` | `libs/shared/data/types` | `scope:shared` `type:data` | `.`, `./*` |
| `shared-svg-icons-svg-icons` | `@aglyn/shared-svg-icons` | `libs/shared/svg-icons/svg-icons` | `scope:shared` `type:ui` | `.` (a Vite build with its own `exports`) |
| `shared-ui-color-picker` | `@aglyn/shared-ui-color-picker` | `libs/shared/ui/color-picker` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-email-campaigns` | `@aglyn/shared-ui-email-campaigns` | `libs/shared/ui/email-campaigns` | `scope:shared` `type:ui` | `.`, `./*` — **a carried violation, not a shared library**: it holds the campaign domain model. See [Violations](#violations); the row goes when the lib is dissolved. |
| `shared-ui-json-editor` | `@aglyn/shared-ui-json-editor` | `libs/shared/ui/json-editor` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-jsx` | `@aglyn/shared-ui-jsx` | `libs/shared/ui/jsx` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-jsx-forms` | `@aglyn/shared-ui-jsx-forms` | `libs/shared/ui/jsx-forms` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-next` | `@aglyn/shared-ui-next` | `libs/shared/ui/next` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-snackstack` | `@aglyn/shared-ui-snackstack` | `libs/shared/ui/snackstack` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-theme` | `@aglyn/shared-ui-theme` | `libs/shared/ui/theme` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-util-dom` | `@aglyn/shared-util-dom` | `libs/shared/util/dom` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-email` | `@aglyn/shared-util-email` | `libs/shared/util/email` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-errors` | `@aglyn/shared-util-errors` | `libs/shared/util/errors` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-fbserver` | `@aglyn/shared-util-fbserver` | `libs/shared/util/fbserver` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-http` | `@aglyn/shared-util-http` | `libs/shared/util/http` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-logger` | `@aglyn/shared-util-logger` | `libs/shared/util/logger` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-next` | `@aglyn/shared-util-next` | `libs/shared/util/next` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-rest-api` | `@aglyn/shared-util-rest-api` | `libs/shared/util/rest-api` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-timestamp` | `@aglyn/shared-util-timestamp` | `libs/shared/util/timestamp` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-tools` | `@aglyn/shared-util-tools` | `libs/shared/util/tools` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-vendor` | `@aglyn/shared-util-vendor` | `libs/shared/util/vendor` | `scope:shared` `type:util` | `.`, `./*` |

### Apps and deploy units

Not packages today. The console becomes one (and the staff console, which
lives inside it under its staff routes, becomes a second) once what a consumer
would need from `apps/console` has moved into libs — see the rules below.

| project | root | tags | what it is |
| -- | -- | -- | -- |
| `console` | `apps/console` | `scope:app` `scope:console` | The console and, under its staff routes, the staff console. |
| `tenant` | `apps/tenant` | `scope:app` `scope:tenant` | The shell that serves published sites on the tenant runtime. |
| `docs` | `apps/docs` | `scope:app` `scope:public` | The documentation site; standalone, not a package. |
| `cloud-functions` | `cloud/functions` | `scope:app` | Cloud Functions; a deploy unit, not a package. |
| `console-e2e` | `apps/console-e2e` | `scope:app` `scope:e2e` | End-to-end suites; not a package. |
| `tenant-e2e` | `apps/tenant-e2e` | `scope:app` `scope:e2e` | End-to-end suites; not a package. |

## Baseline graph

`nx graph --file` on the day the map was written (2026-09-14): 54 projects,
294 static project-to-project edges and 25 dynamic ones. The dynamic edges are
the two apps' generated loader manifests reaching every plugin, plus the
console lazy-loading designer surfaces; they are the sanctioned seam and the
guard does not judge them. Static edges by scope:

| from \ to | shared | core | renderer | besigner | besigner-ui | tenant | plugin |
| -- | -- | -- | -- | -- | -- | -- | -- |
| shared | 42 | **1** | | | | | |
| core | 7 | 1 | | | | | |
| renderer | 5 | 1 | | | | | |
| besigner | 4 | 1 | | | | | |
| besigner-ui | 12 | 2 | 1 | 1 | | | |
| tenant | 18 | 4 | 1 | | | 3 | |
| console | 19 | 2 | 1 | 1 | 1 | 3 | |
| plugin | 94 | 14 | | | **2** | 31 | **22** |

Bold cells break the map; every one of their edges is listed below and in the
allowlist. Everything else already holds.

## Violations

The 5 edges the allowlist carries, and what removes each. An edge leaves the
list when its fix lands; the guard then refuses the stale row, so the list and
this section move together. One violation at the end of the section is not an
allowlist row at all — the map permits the edge that carries it, so the guard
is silent and only this document holds it.

**`shared-util-email` → `aglyn`.** Gone (AGL-3080). One spec read the shipped
price table so its ceiling assertions checked real numbers. The check needs
both the table and the ceiling model, and only one direction between them is
legal, so it lives beside the table as
`libs/aglyn/src/lib/app-utils/plan-entitlements-deliverable.spec.ts` and
imports the model from the email library. `shared` imports only `shared`
again, with no inline disable anywhere.

**Plugin → plugin** (4, numbered to 17). What two plugins share goes behind a core seam. It
does not go sideways, and it does not go down into `libs/shared`: a plugin's
domain is not generic, so `shared` is not a home for it, types included
(Rule 4). One row per allowlist edge, in the allowlist's order, because each is
one lane's work and each lane reads its own row. "Crosses" is what the source
files import today, not what the allowlist's `why` says — four of those
sentences have drifted from the code, and the row says so where they have. A
seam called **present** was verified by reading its export; a seam called
**owed** does not exist yet and is AGL-3124's to build before the lane that
needs it starts.

1. **`plugins-bookings` → `plugins-commerce`.** Crosses: `resolveFlatTaxCents`
   and `TaxSettings` (`src/lib/server.ts`), `storefrontTaxModeOf`
   (`src/lib/server/billing-webhook.ts`). Not model reuse, as the allowlist's
   `why` has it — it is tax: two plugins that take money need the same tenant
   tax profile. Fix: a tax-profile service contract on
   `definePluginServiceContract` / `registerPluginService` /
   `resolvePluginServices` — commerce registers the profile, bookings resolves
   it, neither imports the other. The machinery is **present**; the named
   contract is **owed** (AGL-3124), beside the payment-provider contract the
   same money path needs.
2. **`plugins-commerce` → `plugins-data`.** Gone (AGL-3080). Commerce was
   reaching `parseCsv` through the data plugin's barrel, which only re-exports
   it; it now imports the function from the core's `dataset-csv`, where it
   lives. The number stays so the rows below keep theirs.
3. **`plugins-crm` → `plugins-bookings`.** Gone (AGL-3080). "Book a meeting"
   read the bookings services collection, the booking plugin's per-site
   setting and its link builder: a bookings feature living in the CRM. The
   whole control moved to `libs/plugins/bookings`, and the CRM hosts a
   `crmRecordBooking` zone for it in a record's header and beside the
   composer. That zone is `bare` — `registerPluginZone` gained a `layout`, so
   a plugin-hosted zone can be one control in a row rather than a block. The
   composer's caret helper stayed with the CRM. The number stays.
4. **`plugins-crm` → `plugins-email`.** Gone (AGL-3080). What crossed was
   `useSendingApi`, the client of `/api/email/sending-identity` — a route the
   console itself serves, because which address a site's mail leaves from is
   the platform's mail rail and not the email plugin's. The hook lives in
   `@aglyn/tenant-feature-instance/hooks/use-sending-identity-api`, beside the
   other client hooks a plugin may import, and the CRM's one-to-one composer
   reads the identity from the platform. The number stays.
5. **`plugins-crm` → `plugins-marketing`.** Gone (AGL-3080). The CRM hosts a
   `crmRecordAttribution` zone on a contact's page and in a lead's history and
   hands it `{ hostId, recordKind, recordId }` in its own words; marketing
   registers one widget there that reads the kind as the identify moment it
   credits, and draws nothing for a kind it never credits. The number stays.
6. **`plugins-email` → `plugins-mui`.** Gone (AGL-3080). `sanitizeCustomHtml`
   had already become a one-line delegation to the core's `sanitizeAuthorHtml`
   (AGL-1901), so the email blocks call the core's function themselves — the
   same one the mailed copy is rendered under. The number stays.
7. **`plugins-forms` → `plugins-bookings`.** Gone (AGL-3080). The only
   crossing was `plugin-id-backfill-table.spec.ts`, which checks a tools
   script against four plugins' bundles and so was never the forms plugin's
   spec. It lives in `apps/console/specs` and reaches each plugin through the
   generated manifest, the one door an app has. The number stays.
8. **`plugins-forms` → `plugins-crm`.** Gone (AGL-3080), in two halves. The
   link to a form's people asks `pluginRecordFilteredHref('contact', …,
   'form', formId)`. The "Saves to contact fields" card moved to the CRM: what
   a contact's fields are is the CRM's to know, so the card is its widget, in a
   `formContactFields` zone the form's page hosts. The widget decides what the
   declaration becomes and calls `saveFields`; the page writes the form
   document, which is the forms plugin's. It is gated on the `crm` entitlement
   like every CRM card, since a workspace without the suite has no fields to
   map onto. The number stays.
9. **`plugins-forms` → `plugins-events-calendar`.** Gone (AGL-3080), with
   row 7: the same spec, the same move. The number stays.
10. **`plugins-forms` → `plugins-inbox`.** Gone (AGL-3080). The forms plugin
    declares a `formSubmissions` zone (`definePluginZone`, `registerPluginZone`)
    and draws it on a form's page behind the reader's ask; the Inbox registers
    its submissions table there as a widget, narrowed to that form. The page
    says where submissions are read when no plugin registered a reader. The
    number stays.
11. **`plugins-forms` → `plugins-mui`.** Crosses: `BUNDLE_ID as MUI_BUNDLE_ID`
    (`src/lib/components/form.tsx`), plus MUI's `Product` component and its
    bundle id in two specs. Fix: a form never needs another plugin's bundle id
    spelled out — the id comes off the node being read, through the loader
    registry, and the specs read presets and ids from that same registry.
    **Present.** The core carries a copy of the literal (`MUI_BUNDLE_ID` in
    `plugin-manager/feature-plugins.ts`); that file is AGL-3116's and is not
    this row's to change.
12. **`plugins-inbox` → `plugins-crm`.** Gone (AGL-3080). The CRM publishes
    where a contact, a lead, a company and a deal are read through
    `registerPluginRecordRoute`, and the Inbox's three cards ask
    `pluginRecordHref` and its siblings with the org and site already in the
    URL. With no plugin publishing the kind they draw text, not a link to a
    page the workspace cannot open. The number stays so the rows below keep
    theirs.
13. **`plugins-inbox` → `plugins-marketing`.** No shipped file crosses any
    more (AGL-3080). The Inbox hosts two zones marketing fills: its Campaigns
    section (`inboxCampaigns`) and the attribution under a lead or a submission
    (`inboxRecordAttribution`, as in row 5). What still crosses is one spec,
    `an-enrollment-is-not-a-license-to-send.spec.ts`, which drives the real
    `performCampaignSend` against the real Inbox enrollment to prove the send
    re-checks suppression. It is the consent proof, its header argues where it
    lives, and the sender is not reachable through marketing's server entry, so
    it keeps the row until it can assert the same thing on the shared mail
    rail (`@aglyn/shared-util-email`'s `marketing-send` injection seam).
14. **`plugins-marketing` → `plugins-commerce`.** Gone (AGL-3080). The campaign
    sender read the products collection itself and imported `productPriceRange`
    to price what it read. Commerce publishes a `product` card through
    `registerPluginRecordCardReader` — a new core seam, since a send has no
    member for the facts reader to answer — and the sender asks
    `readPluginRecordCard`. The "from" price is worked out in one place. The
    number stays.
15. **`plugins-marketing` → `plugins-email`.** The widest row. Crosses:
    `CampaignComposer`, `useCampaignManageApi` and `useOrgEmailTopics`
    (`campaign-detail-card.tsx`, `campaigns-card.tsx`), and
    `@aglyn/plugins-email/model` (`src/lib/server/campaign-send.ts`). Fix, in
    three parts: the composer is a widget email registers into a
    marketing-hosted zone (**present**); the send and manage calls go through
    email's own `registerPluginApiRoute` doors rather than a borrowed client
    hook (**present**); and the model import becomes a plugin-declared campaign
    resource kind whose numbers resolve through `registerPluginFigureReader` —
    the reader is **present**, while the resource kind and the
    subscription-topic contract `useOrgEmailTopics` needs are **owed**
    (AGL-3124). That resource kind is the one the finding below turns on.
16. **`plugins-marketplace` → `plugins-mui`.** Gone (AGL-3080). The only
    crossing was the spec proving each block preset composes publishable
    components. It is about the palette's owner and the allowlist's owner at
    once, so that half lives in `apps/console/specs` and reaches both through
    the generated manifest; the marketplace keeps the half that is its own.
    The number stays.
17. **`plugins-workflows` → `plugins-logic`.** Gone (AGL-3080). What crossed
    was a client and a dialog. The client called a route the console itself
    serves (`/api/hosts/where-used`), which scans variables, functions and
    workflows alike, so it was never logic's: it lives in the core beside the
    route, at `@aglyn/aglyn/app-utils/where-used`, and both plugins ask the
    platform. The dialog is a widget logic registers in the `workflowUsage`
    zone the Automation page hosts; with nothing registered the page gives the
    answer in words. The number stays.

**Plugin → designer UI** (1). `plugins-mui` renders nested children through
the designer's node leaf and contexts. A plugin that needs the designer UI
cannot be used without it, which is exactly
what the map forbids. Fix: the element-control seam moves into `@aglyn/besigner`
(the logic package) and the designer UI supplies its implementation at
registration time.

**A plugin domain on the generic floor: `@aglyn/shared-ui-email-campaigns`** (a
finding, not an allowlist row). `libs/shared/ui/email-campaigns` holds the
campaign domain model — `model/campaign-container.ts`,
`campaign-conversions.ts`, `campaign-report.ts`, `campaign-revenue.ts`,
`campaign-send-time.ts`, `email-record.ts`,
`components/campaign-picker.component.tsx`, `components/report-figures.tsx` —
and `campaign-container.ts` opens by naming the Firestore path a send is stored
at. Five plugins read it, plus both apps. The guard cannot see it: `plugin` →
`shared` is a legal edge on the map, so there is no allowlist row and this
document is the only place the finding can live.

It was not a mistake. It is what this section used to prescribe — a shared model
rather than a sideways import — and five plugins sharing one model is strictly
better than the edges above. What changed is the rule, not the file: `shared` is
generic only, plugin domains included, so the prescription that put it there is
gone and what that prescription produced is now a finding.

Fix: a campaign becomes a plugin-declared resource kind. `report-figures.tsx`
and the numbers behind it resolve through `registerPluginFigureReader`
(**present**); `campaign-picker.component.tsx` becomes a widget through the
console widget registry (**present**); `email-record.ts`'s field names become
part of the declared resource rather than a shared type. The resource-kind
declaration itself is **owed** (AGL-3124) — the same contract row 15 needs.

Whatever replaces it keeps the split the package has now: `src/index.ts` exports
only the model, with `components/report-figures` reached by its own `./*`
subpath, so a server handler reading a stored field name never pulls a component
graph — and MUI — behind it. Firestore rules name `hosts/{hostId}/campaigns`;
rules are the last step, not the first. Dissolving the lib is its own AGL-3080
child and not this section's commit, so the package keeps its map row above
until that child lands.

## Rules

1. **An app never holds logic a consumer would need.** If a piece of
   `apps/console` or `apps/tenant` is something a package consumer would want
   — a hook, a data helper, a server routine — it moves to a lib. The app
   keeps routes, layout and wiring.
2. **A plugin never imports another plugin.** Not its entry, not its model,
   not a component. It goes through a plugin-manager seam in the core
   (registries for widgets, providers, site runtimes, page hooks, API
   dispatch). Moving the shared piece down into `libs/shared` is not the
   alternative: that only relocates the domain onto the generic floor, where
   nothing refuses it and every plugin inherits it. Only code that carries no
   plugin's domain goes down a layer, and then it goes because it is generic,
   not because two plugins wanted it.
3. **A plugin's code lives only in its own plugin.** The core is runnable with
   every plugin absent, and so is every other tree. Nothing AI-, commerce- or
   CRM-shaped lives in `libs/aglyn`, `libs/tenant/**`, `libs/besigner/**`,
   `libs/shared/**`, `apps/**`, `tools/**` or `cloud/**` — nor in another
   plugin. Those get generic extension points only. A plugin-specific type in
   any of them is the same defect as a plugin-specific module: the seam has to
   let the plugin declare its own shape. Nor is a layer below a plugin ever
   bespoke in the other direction: a named vendor, a named provider or a switch
   over plugin ids sits behind a contract any implementer can satisfy. A
   binding that is genuinely the platform's own infrastructure is argued case
   by case and written down where it is argued, never assumed from the fact
   that it is already there. `check:plugin-domain-in-core` refuses a new one, and
   its allowlist is where an argued binding is written: a `stays` row with its
   `why`.
4. **`libs/shared` stays generic.** Widen a narrow shared utility rather than
   fork it — but never at a bundle cost. A shared lib that would need the
   core to do its job belongs one layer up, not in `shared` with a copy. And
   no plugin's domain belongs there at all, types included: a model, a route
   table, a field vocabulary or a stored field name is that plugin's, however
   many plugins agree on it. Two plugins agreeing is what a core contract is
   for; it is not evidence that the thing is generic.
5. **A new lib gets its tags and its map row in the same commit.** `scope:`
   and `type:` in `project.json`, `name`/`version`/`exports`/
   `peerDependencies`/`sideEffects` in `package.json`, a row here. The guard
   refuses a project it cannot find in this document.
6. **The allowlist only shrinks.** A new cross-package edge is refused at
   lint and at the guard; it is fixed, not recorded. A row whose edge is gone
   is removed in the same commit, or the guard is red for the stale row.
7. **Never import another lib's internals by relative path.** Every cross-lib
   import is `@aglyn/<name>` or `@aglyn/<name>/<subpath>`; the subpath is a
   published entry point.

## `package.json` per lib

Every lib carries, today:

- `name`: the npm name, which is the alias.
- `version`: the repo version from the root `package.json`, written by
  `release:prepare --write` into every lib at once ([RELEASING.md](RELEASING.md)).
  `@aglyn/cli` is the one exception, already on the registry at its own number.
- `exports`: `.` and, where they exist, `./server` and `./*`, in the shape the
  swc build emits (`./src/index.js` beside `./src/index.d.ts`), so the same
  file is right in source and in `dist/`.
- `peerDependencies`: `react`, `react-dom`, `next`, `firebase`,
  `firebase-admin` and each `@mui/*` package the lib's shipped source imports,
  at the root's range. A consumer has one of each; a lib never carries its own.
- `sideEffects`: `false`, or the list of modules that register on import.

Build output is unchanged: the executors, entry files and `dist/` layout are
what they were.

## Later

A follow-up project, not this document's commit:

- `nx release` with independent versioning and `publishConfig` per package.
- A `publish-packages.yml` workflow on the `production` promotion tag that
  publishes every changed package with provenance, and a `CHANGELOG` per
  package.
- An `examples/` consumer that builds the designer UI from the published
  packages, which is the proof the map is real.
- The licensing decision — which pieces are open source and under which
  license — is an owner decision tracked separately.
