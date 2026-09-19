# Packages

Every `libs/**` project is a future npm package, and each is meant to be
taken on its own. Someone who wants to build their own editor takes the
besigner logic and the core; someone who wants the editor as it ships takes
the besigner UI on top of those; the console, the staff console, the tenant
runtime and every plugin are each one package. Publishing is a later project
(see [Later](#later)); what this document does now is state the map, so that
every change made from here on keeps to it, and describe how the map is held.

The map is held in three places, and they agree by construction:

| where | what |
| -- | -- |
| `tools/scripts/lib/lib-boundaries.mjs` | `DEP_CONSTRAINTS` — the map as data: which `scope:` may import which |
| `eslint.config.mjs` | `@nx/enforce-module-boundaries` takes those constraints, so every file is judged at lint; a project on the allowlist spreads `boundaryOverridesFor(import.meta.url)` from its own `eslint.config.mjs`, which allows exactly its listed targets and nothing more |
| `tools/scripts/check-lib-boundaries.mjs` | `check:lib-boundaries` judges the same constraints over `nx graph`, checks this document has a row for every project, and checks every lib `package.json` |
| `tools/scripts/lib-boundaries-allowlist.json` | the edges that break the map today, one row each; the guard is red for a row that is missing **and** for a row the graph no longer has |

```sh
npm run check:lib-boundaries                        # the guard (a few seconds; runs `nx graph`)
npm run test:lib-boundaries                         # its forced reds
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
| `scope:shared` | `shared` | Generic libraries with no knowledge of Aglyn's model. The floor everything stands on, so it stands on nothing. |
| `scope:core` | `core`, `shared` | `@aglyn/aglyn`: the platform model, its managers, its plugin-manager seams — no rendering, no designer, no tenancy, no plugin. |
| `scope:renderer` | `renderer`, `core`, `shared` | A node tree to React. |
| `scope:besigner` | `besigner`, `core`, `shared` | The designer's logic, publishable without its UI. |
| `scope:besigner-ui` | `besigner-ui`, `besigner`, `renderer`, `core`, `shared` | The designer's React surface. |
| `scope:tenant` | `tenant`, `renderer`, `core`, `shared` | The runtime that serves a published site, and the tenant app shell. Plugins reach it only through the loader manifests. |
| `scope:console` | everything above, plugins only dynamically | The console app. |
| `scope:plugin` | `tenant`, `renderer`, `besigner`, `core`, `shared` | A feature plugin. Never another plugin; never the designer UI. |
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
| `plugins-workflows` | `@aglyn/plugins-workflows` | `libs/plugins/workflows` | `scope:plugin` `type:feature` | yes | `.`, `./*` |

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
anyone who wants a generic piece; none is a product surface.

| project | npm name | root | tags | entry points |
| -- | -- | -- | -- | -- |
| `shared-data-enums` | `@aglyn/shared-data-enums` | `libs/shared/data/enums` | `scope:shared` `type:data` | `.`, `./*` |
| `shared-data-forms` | `@aglyn/shared-data-forms` | `libs/shared/data/forms` | `scope:shared` `type:data` | `.`, `./*` |
| `shared-data-mdi` | `@aglyn/shared-data-mdi` | `libs/shared/data/mdi` | `scope:shared` `type:data` | `.`, `./*` |
| `shared-data-regex` | `@aglyn/shared-data-regex` | `libs/shared/data/regex` | `scope:shared` `type:data` | `.`, `./*` |
| `shared-data-types` | `@aglyn/shared-data-types` | `libs/shared/data/types` | `scope:shared` `type:data` | `.`, `./*` |
| `shared-svg-icons-svg-icons` | `@aglyn/shared-svg-icons` | `libs/shared/svg-icons/svg-icons` | `scope:shared` `type:ui` | `.` (a Vite build with its own `exports`) |
| `shared-ui-color-picker` | `@aglyn/shared-ui-color-picker` | `libs/shared/ui/color-picker` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-email-campaigns` | `@aglyn/shared-ui-email-campaigns` | `libs/shared/ui/email-campaigns` | `scope:shared` `type:ui` | `.`, `./*` |
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

The 19 edges the allowlist carries, and what removes each. An edge leaves the
list when its fix lands; the guard then refuses the stale row, so the list and
this section move together.

**`shared-util-email` → `aglyn`** (1). A spec reads the shipped price table so
its ceiling assertions check real numbers. It is inline-disabled at the one
import and no production file may repeat it; the fix is a fixture that reads
the table from the core's server entry, or the spec moving to a project that
may import the core.

**Plugin → plugin** (17). What two plugins share moves down a layer or behind
a core seam, never sideways:

- `plugins-marketplace` → `mui`: a spec imports the MUI block presets to prove
  each one composes only publishable components. Fix: read them from the
  plugin-manager registry the loader manifests already fill.
- `plugins-forms` → `bookings`, `events-calendar`, `mui`: the placement menu
  and the form controls import plugin entries and components. Fix: the same
  registry, plus a form-control registration seam in the core.
- `plugins-forms` → `crm`, `inbox`; `plugins-inbox` → `crm`, `marketing`;
  `plugins-crm` → `bookings`, `email`, `marketing`; `plugins-marketing` →
  `email`, `commerce`; `plugins-bookings` → `commerce`; `plugins-commerce` →
  `data`; `plugins-workflows` → `logic`: route tables, model types, a card
  embedded in another plugin's hub, a hook that sends through another
  plugin's API. Fix: the model types and route tables move to `libs/shared`
  or the core; a card another plugin embeds is registered as a widget through
  the core's widget registry; a send path another plugin calls is a core
  seam (an API dispatch entry) rather than an import.
- `plugins-email` → `mui`: bundle constants. Fix: move them to the core's
  bundle constants.

**Plugin → designer UI** (1). `plugins-mui` renders nested children through
the designer's node leaf and contexts. A plugin that needs the designer UI
cannot be used without it, which is exactly
what the map forbids. Fix: the element-control seam moves into `@aglyn/besigner`
(the logic package) and the designer UI supplies its implementation at
registration time.

## Rules

1. **An app never holds logic a consumer would need.** If a piece of
   `apps/console` or `apps/tenant` is something a package consumer would want
   — a hook, a data helper, a server routine — it moves to a lib. The app
   keeps routes, layout and wiring.
2. **A plugin never imports another plugin.** Not its entry, not its model,
   not a component. It goes through a plugin-manager seam in the core
   (registries for widgets, providers, site runtimes, page hooks, API
   dispatch) or down into `libs/shared`.
3. **Core never imports a plugin.** The core is runnable with every plugin
   absent. Nothing AI-, commerce- or CRM-shaped lives in `libs/aglyn`,
   `libs/tenant/**` or `apps/**`; those get generic extension points only.
4. **`libs/shared` stays generic.** Widen a narrow shared utility rather than
   fork it — but never at a bundle cost. A shared lib that would need the
   core to do its job belongs one layer up, not in `shared` with a copy.
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
