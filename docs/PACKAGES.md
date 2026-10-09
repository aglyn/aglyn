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
| `tools/scripts/check-plugin-domain-in-core.mjs` | `check:plugin-domain-in-core` holds Rule 3, which the import graph cannot see, in any tree that is not a plugin: a domain-named file or route directory, a vendor literal, a first-party plugin id, a static plugin import, **a Firestore collection one plugin owns addressed from outside it**, **exports that are mostly one plugin's vocabulary**, and **any declaration in a plugin's vocabulary mixed into a platform file**. The last three read the CODE rather than the name; two content sweeps added them after names alone had missed 111 files, the largest group being platform files with a plugin's rows, keys and types written into them (`plan-entitlements.ts`, `org-billing.types.ts`, `usage-budget.ts`). Inside `libs/plugins/**` it holds the "nor in another plugin" half: **another plugin's Firestore collection** addressed from this one, and **another plugin's console page** built here — its nav slug as a `pluginSlug`, a `*_SLUG` constant or a path segment, or a core route that is its page. The owner publishes a record index, card, facts or figure reader, and a record route; the other plugin asks for the kind |
| `tools/scripts/plugin-domain-in-core-allowlist.json` | the files that carry a plugin's domain outside its plugin today, each with the AGL-3080 lane that moves it, or `stays` and the argument, and the plugin files that still reach into another plugin (`coupling`); red for a finding with no row **and** for a row nothing trips (`--prune`) |

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
| `scope:plugin` | `tenant`, `renderer`, `besigner`, `core`, `shared` | A feature plugin. Never another plugin; never the designer UI. Its domain lives here and nowhere else — what it imports from the layers below it is generic, never its own model wearing a lower layer's tag. Its native screens live in `src/ios` (a Swift package) and `src/android` (a Kotlin module), reached only through the generated native manifest (AGL-3651). |
| `scope:mobile` | `mobile` only | The native apps and their foundation: Swift and Kotlin projects that import no TypeScript project. What they share with TypeScript is generated from the proven-pure modules in `tools/scripts/mobile-pure-modules.json`, and `check:mobile-isolation` holds the file level both ways: no web file or tsconfig reaches a native tree, and no native file reaches outside one. |
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
| `aglyn-transfer-ui` | `@aglyn/aglyn-transfer-ui` | `libs/aglyn-transfer-ui` | `scope:core` `type:ui` | yes — the import wizard and export dialog; the console renders them, and a plugin opens them through `useTransferLauncher()` in `@aglyn/aglyn`, never by importing this | `.`, `./*` |
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
| `plugins-accounting` | `@aglyn/plugins-accounting` | `libs/plugins/accounting` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-accounting --publish`, then `trust:packages --set`); QuickBooks Online and Xero sync of commerce sales, refunds, fees and payouts | `.`, `./*` |
| `plugins-ai` | `@aglyn/plugins-ai` | `libs/plugins/ai` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-bookings` | `@aglyn/plugins-bookings` | `libs/plugins/bookings` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-calculator` | `@aglyn/plugins-calculator` | `libs/plugins/calculator` | `scope:plugin` `type:feature` | no — the source of the Calculators marketplace bundle, installed from the marketplace | `.`, `./*` |
| `plugins-commerce` | `@aglyn/plugins-commerce` | `libs/plugins/commerce` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-crm` | `@aglyn/plugins-crm` | `libs/plugins/crm` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-data` | `@aglyn/plugins-data` | `libs/plugins/data` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-email` | `@aglyn/plugins-email` | `libs/plugins/email` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-events-calendar` | `@aglyn/plugins-events-calendar` | `libs/plugins/events-calendar` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-fonts` | `@aglyn/plugins-fonts` | `libs/plugins/fonts` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-forms` | `@aglyn/plugins-forms` | `libs/plugins/forms` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-funnels` | `@aglyn/plugins-funnels` | `libs/plugins/funnels` | `scope:plugin` `type:feature` | yes — funnels on a site's Analytics page, over the visits core's journey recorder records | `.`, `./*` |
| `plugins-inbox` | `@aglyn/plugins-inbox` | `libs/plugins/inbox` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-logic` | `@aglyn/plugins-logic` | `libs/plugins/logic` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-marketing` | `@aglyn/plugins-marketing` | `libs/plugins/marketing` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-marketing-platforms` | `@aglyn/plugins-marketing-platforms` | `libs/plugins/marketing-platforms` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-marketing-platforms --publish`, then `trust:packages --set`); two-way contact and consent sync with a merchant's own Mailchimp, Klaviyo, Omnisend or Attentive account, through core's person-records seam and site consent module, and order events through commerce's domain events | `.`, `./*` |
| `plugins-fulfillment-networks` | `@aglyn/plugins-fulfillment-networks` | `libs/plugins/fulfillment-networks` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-fulfillment-networks --publish`, then `trust:packages --set`); routes commerce's paid orders to a merchant's own ShipBob, ShipMonk or Amazon Multi-Channel Fulfillment account through commerce's domain events, writes shipments and tracking back through core's shipment-records seam, publishes what a network holds on core's fulfillment-providers seam and sets stock counts through core's stock-levels seam | `.`, `./*` |
| `plugins-couriers` | `@aglyn/plugins-couriers` | `libs/plugins/couriers` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-couriers --publish`, then `trust:packages --set`); books a DoorDash Drive courier from the merchant's own account for commerce's local deliveries, reading and writing them through core's local-delivery-records seam and calling couriers off on commerce's order events | `.`, `./*` |
| `plugins-marketplaces` | `@aglyn/plugins-marketplaces` | `libs/plugins/marketplaces` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-marketplaces --publish`, then `trust:packages --set`); keeps a merchant's own Amazon, eBay, Etsy, TikTok Shop, Walmart and Faire listings in step with the catalog read through core's product-catalog seam, records their orders through core's channel-orders seam, and confirms shipments back from commerce's order events | `.`, `./*` |
| `plugins-inventory-sync` | `@aglyn/plugins-inventory-sync` | `libs/plugins/inventory-sync` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-inventory-sync --publish`, then `trust:packages --set`); keeps a merchant's own Cin7 Core, inFlow or Brightpearl account in step with the store: counts set through core's stock-levels seam or read through core's product-catalog seam and adjusted in the system, products imported through core's product-writer seam or made in the system, and paid orders sent from commerce's order events | `.`, `./*` |
| `plugins-delivery-apps` | `@aglyn/plugins-delivery-apps` | `libs/plugins/delivery-apps` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-delivery-apps --publish`, then `trust:packages --set`); brings a merchant's own DoorDash, Uber Eats and Grubhub orders to the POS register through commerce's `posOrders` zone, records them and the services' changes, cancels and refunds through core's channel-orders seam, and builds the menu from core's product-catalog seam | `.`, `./*` |
| `plugins-marketplace` | `@aglyn/plugins-marketplace` | `libs/plugins/marketplace` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-mui` | `@aglyn/plugins-mui` | `libs/plugins/mui` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-outreach` | `@aglyn/plugins-outreach` | `libs/plugins/outreach` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-live-chat` | `@aglyn/plugins-live-chat` | `libs/plugins/live-chat` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-live-chat --publish`, then `trust:packages --set`); the merchant's own Tidio or LiveChat widget on their site's pages, loaded only on a visitor's press or, where chosen, after idle on an analytics grant, with the vendor hosts declared to core's site-CSP seam | `.`, `./*` |
| `plugins-loyalty` | `@aglyn/plugins-loyalty` | `libs/plugins/loyalty` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-loyalty --publish`, then `trust:packages --set`); built-in rewards for commerce's sales — points, referral codes and store credit — through core's `core.checkout-credits` contract, commerce's order events by name and commerce's console zones, or the merchant's own Smile.io or Yotpo Loyalty account in their place (AGL-3677, hidden until `LOYALTY_CONNECTORS_TOKEN_KEY`) | `.`, `./*` |
| `plugins-post-purchase` | `@aglyn/plugins-post-purchase` | `libs/plugins/post-purchase` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-post-purchase --publish`, then `trust:packages --set`); AfterShip tracking, Route package protection and Narvar for commerce's orders, with the merchant's own accounts, through core's `core.checkout-extras`, `core.tracking-pages` and `core.shipment-records` contracts and commerce's order events by name | `.`, `./*` |
| `plugins-print-on-demand` | `@aglyn/plugins-print-on-demand` | `libs/plugins/print-on-demand` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-print-on-demand --publish`, then `trust:packages --set`); a merchant's own Printful store or Printify shop: products imported through core's `core.product-writer`, paid orders sent through commerce's order events, parcels written back through `core.shipment-records` | `.`, `./*` |
| `plugins-redirects` | `@aglyn/plugins-redirects` | `libs/plugins/redirects` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-sales-channels` | `@aglyn/plugins-sales-channels` | `libs/plugins/sales-channels` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-sales-channels --publish`, then `trust:packages --set`); product feeds for Google, Meta, TikTok, Pinterest, Snapchat and Microsoft, read through core's `core.product-catalog` contract and answering commerce's old feed address through `core.catalog-feed` | `.`, `./*` |
| `plugins-shipping` | `@aglyn/plugins-shipping` | `libs/plugins/shipping` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-shipping --publish`, then `trust:packages --set`); carrier rates, labels and tracking for commerce's orders, through core's `core.shipping-rate-quoter` and `core.shipment-records` contracts | `.`, `./*` |
| `plugins-sms` | `@aglyn/plugins-sms` | `libs/plugins/sms` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-sms --publish`, then `trust:packages --set`); text messages behind core's `core.messaging.sms` contract, Twilio adapter | `.`, `./*` |
| `plugins-stock-photos` | `@aglyn/plugins-stock-photos` | `libs/plugins/stock-photos` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-stock-photos --publish`, then `trust:packages --set`); stock photo libraries behind core's `core.stock-photos` contract, Pixabay adapter with a 24-hour search cache; photos are copied into a site's library through core's `core.media-ingest` | `.`, `./*` |
| `plugins-tax-engines` | `@aglyn/plugins-tax-engines` | `libs/plugins/tax-engines` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-tax-engines --publish`, then `trust:packages --set`); a merchant's own Avalara AvaTax or TaxJar account behind core's `core.tax-engine` contract, recording through commerce's order events | `.`, `./*` |
| `plugins-themes` | `@aglyn/plugins-themes` | `libs/plugins/themes` | `scope:plugin` `type:feature` | yes | `.`, `./*` |
| `plugins-video-delivery` | `@aglyn/plugins-video-delivery` | `libs/plugins/video-delivery` | `scope:plugin` `type:feature` | yes — library video served from Cloudflare R2 through a Worker, behind core's `core.media-delivery` contract | `.`, `./*` |
| `plugins-workflows` | `@aglyn/plugins-workflows` | `libs/plugins/workflows` | `scope:plugin` `type:feature` | yes — the Automation section and the automation engine | `.`, `./*` |
| `plugins-zapier` | `@aglyn/plugins-zapier` | `libs/plugins/zapier` | `scope:plugin` `type:feature` | no — held `private` until its npm name is created by hand (`publish:packages -- --only @aglyn/plugins-zapier --publish`, then `trust:packages --set`); the REST hooks Aglyn's Zapier app (`apps/zapier`) subscribes to, delivering commerce's order events and the bookings plugin's booking events by name, and relayed contact and form host events, through core's domain-event outbox | `.`, `./*` |

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
| `shared-ui-email-campaigns` | `@aglyn/shared-ui-email-campaigns` | `libs/shared/ui/email-campaigns` | `scope:shared` `type:ui` | `.`, `./*` — the bulk-send reporting math (`model/send-report`: a send's counters, a rate with its denominator named, the link rollup), divided by every plugin that mails in bulk. The campaign model it once held is the Marketing plugin's (AGL-3080); see [Violations](#violations). |
| `shared-ui-json-editor` | `@aglyn/shared-ui-json-editor` | `libs/shared/ui/json-editor` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-jsx` | `@aglyn/shared-ui-jsx` | `libs/shared/ui/jsx` | `scope:shared` `type:ui` | `.`, `./*` — also the one list-table filter path every plugin's lists use: `./components/list-table.component`, `./const/list-filter`, `./const/list-grid-filter`, `./hooks/use-list-grid-filter`, `./const/list-query-plan` (both re-export `@aglyn/shared-util-tools/list-query/*`), `./components/list-query-notices.component`, `./components/list-filter-chips.component` (AGL-3317, AGL-3321) |
| `shared-ui-jsx-forms` | `@aglyn/shared-ui-jsx-forms` | `libs/shared/ui/jsx-forms` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-next` | `@aglyn/shared-ui-next` | `libs/shared/ui/next` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-snackstack` | `@aglyn/shared-ui-snackstack` | `libs/shared/ui/snackstack` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-ui-theme` | `@aglyn/shared-ui-theme` | `libs/shared/ui/theme` | `scope:shared` `type:ui` | `.`, `./*` |
| `shared-util-dom` | `@aglyn/shared-util-dom` | `libs/shared/util/dom` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-email` | `@aglyn/shared-util-email` | `libs/shared/util/email` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-errors` | `@aglyn/shared-util-errors` | `libs/shared/util/errors` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-fbserver` | `@aglyn/shared-util-fbserver` | `libs/shared/util/fbserver` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-first-touch` | `@aglyn/shared-util-first-touch` | `libs/shared/util/first-touch` | `scope:shared` `type:util` | `.`, `./*` — also served as one script tag by `/api/first-touch` on the console and the tenant (AGL-3289) |
| `shared-util-http` | `@aglyn/shared-util-http` | `libs/shared/util/http` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-logger` | `@aglyn/shared-util-logger` | `libs/shared/util/logger` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-next` | `@aglyn/shared-util-next` | `libs/shared/util/next` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-rest-api` | `@aglyn/shared-util-rest-api` | `libs/shared/util/rest-api` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-timestamp` | `@aglyn/shared-util-timestamp` | `libs/shared/util/timestamp` | `scope:shared` `type:util` | `.`, `./*` |
| `shared-util-tools` | `@aglyn/shared-util-tools` | `libs/shared/util/tools` | `scope:shared` `type:util` | `.`, `./*` — also the pure list filter grammar under `./list-query/*` (`list-filter`, `list-query-plan`, `list-filter-codecs`, `list-filter-sentence`, `list-query-refusals`): no React, no MUI, so the native app plans the same Firestore queries the console does (AGL-3622) |
| `shared-util-vendor` | `@aglyn/shared-util-vendor` | `libs/shared/util/vendor` | `scope:shared` `type:util` | `.`, `./*` |

### Native (Kotlin)

The Kotlin Multiplatform foundation of the native Android and JVM desktop apps
(AGL-3652, AGL-3653). Kotlin and Gradle, built by `apps/android`'s Gradle root;
not npm packages, and no web toolchain reads it. Native code never imports web
or server code: it shares only generated files (tokens, contracts, the plugin
manifest) with TypeScript.

| project | npm name | root | tags | entry points |
| -- | -- | -- | -- | -- |
| `native-kotlin` | none (Gradle modules, not npm) | `libs/native/kotlin` | `scope:mobile` `type:feature` | Gradle modules `core` (config, auth and Firestore seams, console API client, workspace store), `ui` (Material 3 theme from the generated tokens, the shared component kit, adaptive layouts), `plugin-host` (registrar, registry, deep links), `webview` (the authenticated console view), `shell` (the Aglyn and Aglyn POS shells), `contracts` (generated), `hardware` (POS peripherals) |

### Native (Apple)

The Swift foundation of the native iOS, iPadOS and macOS apps (AGL-3651,
AGL-3653; `docs/mobile/native-architecture.md`). Swift packages built and
tested by `xcodebuild`, not npm packages: no web toolchain reads them, and
plugins reach the apps only through the generated `apps/ios/PluginManifest`.

| project | npm name | root | tags | what it holds |
| -- | -- | -- | -- | -- |
| `native-apple` | none (Swift package `AglynKit`, not npm) | `libs/native/apple` | `scope:mobile` `type:feature` | Swift products `AglynCore` (config, Firebase auth, Firestore reader, workspace and site store, console API client, deep links, console sessions), `AglynUI` (generated theme tokens and typography, Roboto Flex, brand artwork, the shared component kit, adaptive layouts), `AglynWebView` (the authenticated console view and its bridge), `AglynPluginHost` (registrar, registry, loader), `AglynContracts` (generated), `AglynHardware` (POS peripherals) |

### Apps and deploy units

Not packages today. The console becomes one (and the staff console, which
lives inside it under its staff routes, becomes a second) once what a consumer
would need from `apps/console` has moved into libs — see the rules below.

| project | root | tags | what it is |
| -- | -- | -- | -- |
| `console` | `apps/console` | `scope:app` `scope:console` | The console and, under its staff routes, the staff console. |
| `tenant` | `apps/tenant` | `scope:app` `scope:tenant` | The shell that serves published sites on the tenant runtime. |
| `docs` | `apps/docs` | `scope:app` `scope:public` | The documentation site; standalone, not a package. |
| `ios` | `apps/ios` | `scope:app` `scope:mobile` `type:app` | The Aglyn and Aglyn POS apps for iPhone, iPad and Mac (SwiftUI, one Xcode project); not a package. |
| `android` | `apps/android` | `scope:app` `scope:mobile` `type:app` | Aglyn (`com.aglyn.app`) and Aglyn POS (`com.aglyn.pos`) for Android, and both on the JVM desktop (Windows); the Gradle root for every Kotlin module; not a package. |
| `cloud-functions` | `cloud/functions` | `scope:app` | Cloud Functions; a deploy unit, not a package. |
| `zapier` | `apps/zapier` | `scope:app` `type:app` | Aglyn on Zapier: the Zapier platform app (plain CommonJS on the public REST API, its triggers the `plugins-zapier` REST hooks), published by the operator with the Zapier CLI; imports no project; not a package. |
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

The 1 edge the allowlist carries, and what removes it. An edge leaves the
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

**Plugin → plugin** (2, numbered to 17). What two plugins share goes behind a core seam. It
does not go sideways, and it does not go down into `libs/shared`: a plugin's
domain is not generic, so `shared` is not a home for it, types included
(Rule 4). One row per allowlist edge, in the allowlist's order, because each is
one lane's work and each lane reads its own row. "Crosses" is what the source
files import today, not what the allowlist's `why` says — four of those
sentences have drifted from the code, and the row says so where they have. A
seam called **present** was verified by reading its export; a seam called
**owed** does not exist yet and is AGL-3124's to build before the lane that
needs it starts.

1. **`plugins-bookings` → `plugins-commerce`.** Gone (AGL-3080). Two plugins
   that take money need one tax rule. Commerce registers it through
   `registerPluginTaxProfile` from both of its server registrars, and a booking
   is priced and confirmed by asking `pluginTaxProfile()` — for the site's
   service rate too (`flatRate`), so bookings no longer reads the store
   settings document commerce keeps its rates in. That contract throws
   rather than answer zero when no plugin owns the rule, and
   `tax-profile-is-registered.spec.ts` in each app runs the real registrars
   through the manifest to prove the owner is there. The number stays.
2. **`plugins-commerce` → `plugins-data`.** Gone (AGL-3080). Commerce was
   reaching `parseCsv` through the data plugin's barrel, which only re-exports
   it; it now imports the function from the core's `app-utils/csv`, where it
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
11. **`plugins-forms` → `plugins-mui`.** Gone (AGL-3080). The form block's
    preset places a mui heading and stack, and its nodes name the bundle that
    registers them. It takes that id from the core's `MUI_BUNDLE_ID`, as
    commerce, bookings and events-calendar already do, instead of importing the
    mui plugin for one string. The spec that rendered mui's `Product` beside
    the form was two plugins' claims in one file: `begin_checkout` is held by
    `product-checkout-analytics.spec.tsx` in the mui plugin now. The core still
    carries that literal (`plugin-manager/feature-plugins.ts`), which is this
    document's to record and not a plugin-to-plugin edge. The number stays.
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
15. **`plugins-marketing` → `plugins-email`.** Gone (AGL-3080). The widest
    row, and the two plugins were coupled in BOTH directions: marketing served
    `/api/campaigns/send`, `/manage` and `/recipients` while their client hook,
    the composer that drives them and the message pages that call them lived
    in the email plugin. The owner decided (2026-09-20) that **marketing owns
    campaigns end to end**, so the move was made with a seam on each side
    rather than by swapping this edge for its reverse.
    *The mail rail.* Rendering one message for one recipient was never a
    campaign's or an email design's alone — email checks a design through the
    same call — so it sits in core as
    `@aglyn/aglyn/app-utils/recipient-email-render`.
    *What moved to marketing.* The composer, the test-send drawer, the
    campaign API hooks, and the three message pages (list, report, compose)
    with the recipients table: a message is one send of a campaign, and every
    action on those pages is a marketing route.
    *Zones email hosts, marketing fills.* `emailMessages` is the whole body of
    `/emails/messages/**` — email owns the URL, marketing draws it — and
    `emailTemplateRecipients` is the recipients table under a template's
    report. A template links its campaigns through
    `pluginRecordHref('campaign', …)`, which marketing publishes.
    *Zones marketing hosts, email fills.* What a campaign email needs of the
    mail itself: `campaignTopicSelect` (the stream picker),
    `campaignTopicOptions` (a widget that draws nothing and REPORTS the active
    topics to the two drawers whose select takes a list, read only while the
    drawer is open), `campaignSenderEditor`, `campaignDesignCreate` and
    `campaignDesignPreview`. Every one reports through a callback; none writes
    a campaign. The tokens are in
    `libs/plugins/marketing/src/lib/components/campaign-email-zones.tsx` and
    `libs/plugins/email/src/lib/components/email-zones.ts`.
    `plugin-email-boundary.spec.ts` now holds the whole line — marketing
    imports nothing from the email plugin. The number stays.
16. **`plugins-marketplace` → `plugins-mui`.** Gone (AGL-3080). The only
    crossing was the spec proving each block preset composes publishable
    components. It is about the palette's owner and the allowlist's owner at
    once, so that half lives in `apps/console/specs` and reaches both through
    the generated manifest; the marketplace keeps the half that is its own.
    The number stays.
17. **`plugins-workflows` → `plugins-logic`.** Gone (AGL-3080). What crossed
    was a client and a dialog. The client called a route the console itself
    serves (`/api/hosts/where-used`), so it was never logic's: it lives in the
    core beside the route, at `@aglyn/aglyn/app-utils/where-used`, and both
    plugins ask the platform. The route reads published pages itself and asks
    the plugins for the rest through `plugin-dependents`: logic answers which
    variables a workflow computes, workflows which workflows call a function.
    The dialog is a widget logic registers in the `workflowUsage` zone the
    Automation page hosts; with nothing registered the page gives the answer
    in words. The number stays.

**Plugin → designer UI.** Gone (AGL-3080). No shipped file in `plugins-mui`
imported the designer any more; two specs did, to draw the mui image and video
elements inside the designer's own `NodeLeaf` and prove the canvas reserves a
replaced asset's box. A suite about a plugin's element AND the designer's leaf
lives where both are reached: `apps/console/specs/mui-image-canvas-facts` and
`mui-video-canvas-facts`, which take the element from the generated manifest.
A plugin can be used without the designer UI, which is what the map asks.

**A plugin domain on the generic floor: `@aglyn/shared-ui-email-campaigns`** —
resolved (AGL-3080). The lib held the campaign domain model:
`campaign-container.ts`, `campaign-report.ts` and `email-record.ts`. Two of
them already had allowlist rows. All three are now the Marketing plugin's
`model/`, together with the Email plugin's design report (`template-report.ts`),
which summed a campaign's sends. Before that, the send-time rule, what a
campaign caused and earned, and the campaign picker had gone the same way:
the AI asks for a list's send time through `plugin-record-facts`
(`listSendTime`), and a campaign is a container kind the Marketing plugin
declares.

The Email plugin's template page reads no send. It hosts an
`emailTemplateReport` zone, and the Marketing plugin fills it with what the
design's emails did.

What is left in the lib is generic: the rate math and the link rollup that the
campaign sender and the sequence runner both divide by, renamed for a send
(`SendStats`, `sendRate`, `sendLinkReport`). The package name still says
`email-campaigns`. That is a published name and is kept, and the map row above
now describes it as the shared library it is.

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
- `license`: `Apache-2.0`, for every package (the owner's call, 2026-09-20);
  the root `LICENSE` is copied into each built package when it is packed.
- `publishConfig.access`: `public` — a scoped package publishes restricted
  unless it says so — and `provenance: true`.
- `repository.directory`: the package's own directory, which is what links a
  registry page to its source in a monorepo.
- `sideEffects`: `false`, or the list of modules that register on import, each
  named with its extension left open (`./src/lib/server.*`). A lib is read as
  `.ts` source by this repo's apps and as emitted `.js` by a consumer; an entry
  naming either extension matches nothing for the other reader, whose bundler
  then takes the module for side-effect free and drops a bare import of it —
  measured in webpack and in vite. `check:lib-boundaries` refuses a closed
  extension and an entry that matches no module.
- `dependencies`: every package the lib's shipped source imports that is not
  a peer (AGL-3201). Inside this repo an import resolves through a tsconfig
  alias or the root `node_modules`, so a lib that declares nothing builds and
  tests green and would install from the registry unable to find what it
  imports. One of this repo's own libs is declared at the repo version, the
  only number it is published beside, and `release:prepare` moves those with
  the bump; anything else carries the root `package.json`'s range, and a
  types-only package goes by its `@types/` name. `npm run
  sync:lib-dependencies` writes them and `check:lib-boundaries` refuses a lib
  whose source imports something it does not declare. A lib never imports a
  transitive dependency of something else (`@popperjs/core` through MUI,
  `@firebase/firestore` through `firebase`): it cannot declare it honestly.

Build output is unchanged: the executors, entry files and `dist/` layout are
what they were.

## Proving a package installs

Nothing inside this repo can see whether a lib is installable: an import
resolves through a tsconfig alias or the root `node_modules`, and the apps
consume a lib's source, never what `nx build` emits. So the map is proved from
outside (AGL-3201), by the examples under `examples/consumers/`:

```sh
npm run proof:consumer -- logic-only besigner-ui                 # packs this tree's libs
npm run proof:consumer -- logic-only --registry                  # this tree's version, from npm
npm run proof:consumer -- besigner-ui --registry=1.0.0-beta.219  # any published version
```

Each story is an example app a developer can copy, with its own
`package.json`, README, `npm run build` and `npm run check`. The proof copies
it to an empty directory outside the workspace, points its `@aglyn/*`
dependencies at the version under test, installs with a plain `npm install`,
runs the example's own `build` and `check`, and opens the build in Chrome to
click through it. What a story adds is what the example cannot say about
itself: the packages its install must not bring, and the clicks. An example
whose `@aglyn/*` range does not admit the version under test is refused, so a
copy never installs something nobody proved.

| story | example | asks for | brings | must not need | holds |
| -- | -- | -- | -- | -- | -- |
| `logic-only` | [`examples/consumers/logic-only`](../examples/consumers/logic-only) | `@aglyn/aglyn`, `@aglyn/besigner` | `react`, `react-dom` | `next`, `firebase`, `firebase-admin`, `@mui/material`, `@aglyn/besigner-ui` | yes — twelve packages in the closure, none of them a UI library |
| `besigner-ui` | [`examples/consumers/besigner-ui`](../examples/consumers/besigner-ui) | `@aglyn/besigner-ui`, `@aglyn/besigner`, `@aglyn/aglyn`, `@aglyn/aglyn-node-renderer`, `@aglyn/shared-ui-theme` | `react`, `react-dom`, `next`, `firebase`, `@mui/*`, `@emotion/*` | `firebase-admin`, any `@aglyn/tenant-*`, any `@aglyn/plugins-*` | yes — 23 packages in the closure, and no console, tenant runtime or plugin among them. It holds WITH two peers an embeddable editor should not need, `next` and `firebase`; see below. |

**Packed or from the registry, and where each runs.** Packed is the default:
it builds every lib in the closure from this tree and `npm pack`s it, which is
the tarball `publish:packages` uploads. `consumer-proof.yml` runs it on the
promotion PR, the last point at which a broken package can be stopped — a
published version is final. `--registry` installs the exact version from npm,
siblings and all; `publish-packages.yml` runs it after every publish, waiting
out npm's read lag first. It sees what packing cannot, a package the release
failed to publish or a sibling pin the registry cannot satisfy, and it can
only report. Neither is a required check (RELEASING.md, "Four settings are
deliberate").

The first runs of the examples found four defects that no test or guard
inside the repo could see:

- `@aglyn/shared-data-enums` named `firebase` as a REQUIRED peer, so a plain
  install of the logic packages brought the whole Firebase SDK. Only its
  `firebase-auth` module uses it, and the core imports the package by subpath
  and never loads that module; the peer is optional now.
- Every lib that named `next` pinned it EXACTLY, at `16.3.3`. Once npm's
  `next` moved to 16.3.8, `npm install @aglyn/besigner-ui next` could not
  resolve: npm searched for eighteen minutes and failed. A peer is a
  caret range now, and `check:lib-boundaries` refuses an exact pin and a range
  that does not admit the version the workspace runs. `@mui/base` was pinned
  the same way, and a caret on it admits a `5.0.0-dev` build that peers on
  React 18; it was a peer of `@aglyn/shared-ui-jsx` for one helper that
  `@mui/utils` also exports, so the peer is gone instead.
- `@aglyn/shared-ui-jsx-forms` took two default exports from CommonJS files of
  `@data-driven-forms/common` by deep path. Read under Node's rules, as a
  `"type": "module"` package is, that default is the whole `exports` object,
  so the editor's inspector threw the moment an element was selected. Only a
  browser showed it.
- `@aglyn/shared-util-tools` shipped a direct `eval`, which every consumer's
  bundler warned about on every build. Nothing called the mode that used it.

What a build must do for this to hold, all of it invisible from inside: the
swc output is ESM with `"type": "module"`, so `.swcrc` sets `resolveFully` and
every emitted relative import names its file; a deep import of a package with
no `exports` map names the file too (`lodash-es/isEqual.js`); and a lib's
third-party ranges are the ones the workspace runs. Plain Node still cannot
load `mobx-utils/lib/*`, whose own files import each other without extensions
— that is `mobx-utils`' packaging, a bundler resolves it, and every consumer of
a React library has one.

Two more the proof found, both invisible from inside. The build compiles a
lib's `sourceRoot`, so `@aglyn/shared-data-mdi`'s generated icon set — which
sits beside `src/`, not in it — was typed and never emitted; its `sourceRoot`
is the project root, with the generator scripts and the retired 5.9.55 set
excluded, and the catalog JSON ships as an asset. And `.swcrc` said nothing
about JSX, so every component compiled to `React.createElement` in a file that
imports no `React` — this repo's apps and jest compile lib source with the
automatic runtime and never met it. Every `.swcrc` sets
`jsc.transform.react.runtime: "automatic"`.

The owner's call (2026-09-20) is that the icon package ships its generated set
for now; depending on the upstream icon package is a later option.

What still stands between `besigner-ui` and an editor that embeds anywhere:

1. **`next` is a peer for two `next/dynamic` calls** in the designer
   (`viewport-canvas`, `workspace-editor`). They carry SSR semantics the
   console's editor route relies on, so replacing them wants a signed-in editor
   to verify against.
2. **`firebase` is a peer because the working-draft store writes Firestore
   itself** (`drafts/besigner-server-draft.ts`). An embeddable editor takes a
   draft store from whoever embeds it; the contract belongs in
   `@aglyn/besigner` and the Firestore implementation beside the console.

## Publishing

`npm run publish:packages` (`tools/scripts/publish-packages.mjs`) is a DRY RUN
unless given `--publish`. It asks the registry which packages are missing at
the version the repo carries, builds those, checks every one and copies the
root `LICENSE` into it, and only then publishes — a published version cannot
be replaced, so a failure has to come before the first. A version already out
is skipped, which makes a second run safe and lets a half-finished one be
finished. A prerelease publishes under its own label (`beta`), never `latest`.

`.github/workflows/publish-packages.yml` runs it on the push to `production`,
and by hand as a dry run or for real. `@aglyn/cli` keeps its own version and
rides the same run.

### How the registry knows it is us

**Trusted publishing** (AGL-3201). GitHub issues the run one short-lived OIDC
token, npm checks it against the trusted publisher each package names — this
repository, `publish-packages.yml` — and takes the release. There is no
long-lived secret to expire, leak or rotate, and provenance comes with it: npm
generates the attestation itself, which is what lets anyone check that a
version on the registry was built from the commit it claims. It needs npm
11.5.1 or later, which the workflow asserts rather than assumes — an older npm
does not look for the OIDC token at all, falls through to the token, and
publishes green using the credential this exists to stop using.

Trust is configured **per package** — npm has no scope-level setting — and
there are 51:

```sh
npm run trust:packages            # read only: what each package trusts today
npm run trust:packages -- --set   # the owner configures the ones missing it
```

**Both** modes need the owner signed in, and npm challenges EVERY trust
operation with the account's second factor — `npm trust list` included, and
`npm login` alone does not satisfy it. ⚑ npm answers that challenge with a
BROWSER HANDSHAKE, so it must keep the terminal: a `npm trust` run with stdin
closed cannot wait for the approval and fails `EOTP` instead of asking, which
reads as "not signed in" to somebody who signed in a minute ago. The elevated token npm
issues then lapses quickly, so the script asks for an approval only when a
read actually needs one, at most once per run — and stops with a count if the
token lapses part way through the 51 rather than asking again. So the run reads and configures each
package in turn rather than reading all 51 first: the first package proves
whether one browser approval carries the rest, and if it does not, that is
known at package one instead of after fifty-one approvals with nothing
configured. It is safe to re-run; packages already configured are skipped.
`--set` changes the account's own security settings, which an agent may not
do at all. It needs npm 11.15.0 or later, which is when
`npm trust` arrived; the repo's current npm is older, so `npm install -g
npm@latest` comes first. It asks for
**both** `--allow-publish` and `--allow-stage-publish`: a configuration created
after 2026-09-03 permits staged publishing and nothing else unless publishing
is asked for explicitly, so without the first flag every package would be
configured, look configured, and refuse the release.

**There is no token any more.** All 51 packages were configured and verified
on 2026-09-21 — right repository, right workflow file, and `createPackage` on
every one — and `NPM_TOKEN` was removed from the workflow. The token it
replaced was granular with the 2FA bypass and expired 2026-12-19; npm removes
direct publishing with those in **January 2027**. A secret that does not exist
cannot expire, leak, or be rotated into a broken release.

### `latest`, until 1.0.0 exists

A prerelease normally publishes under its own label (`beta`) so it is not what
`npm install` hands somebody who asked for nothing in particular. That rule
assumes `latest` already points at a release worth having.

**It did not.** npm sets `latest` on a package's FIRST publish whatever `--tag`
says, so all 50 libs pinned it to `1.0.0-beta.143` — the one build whose
folder-subpath imports a consumer cannot resolve at all — and every later beta
went to `beta`, so `latest` never moved again.

So `distTagFor` asks the registry: **a prerelease takes `latest` when that
package has never published a non-prerelease**, and its own label once one
exists. Between "the default is a prerelease" and "the default does not work",
the first is the lesser harm, and it is only ever the newest prerelease. The
condition is per package and read fresh, so it corrects itself the day `1.0.0`
ships — nothing to remember, nothing to undo. `@aglyn/cli` carries its own
stable number and is unaffected.

⛔ **It cannot be done by moving the tag afterwards.** An OIDC token authorizes
`npm publish` and `npm stage publish` and nothing else, so a `npm dist-tag add`
step would need back the long-lived token trusted publishing exists to retire.
The tag is chosen at publish time because that is the only moment CI may
choose it.

### The second tag

`npm publish --tag` takes ONE tag, so a version always leaves another unset:
while no release exists the publish spends it on `latest` and `beta` is left
behind, and afterwards it runs the other way round. `publish-packages.yml`
closes that with a step of its own, and `dist-tags.yml` closes a gap on demand
— a version published before a rule changed, or a tag step that failed —
without a republish.

```sh
npm run dist-tags                     # read only: where every tag points today
npm run dist-tags -- --set            # move the ones behind
npm run dist-tags -- --probe          # may this runner move a tag at all?
npm run dist-tags -- --version 1.0.0  # a version other than the repo's
```

`tagsFor` asks `distTagFor` rather than repeating its rule, so the publish and
this can never disagree about which tag a version belongs on — and **`latest`
is never walked back onto a prerelease once a release exists.**

⛔ **"Not on the registry" is two different things.** A package that carries its
OWN version (`@aglyn/cli`) will never have the repo's, and that is a fact:
skipped. A package that carries the repo's version and does not have it is
either mid-publish or unpublished, and its tag is now wrong. **npm's read path
lags a publish by minutes** — this runs minutes after one — so the run waits
and re-reads rather than moving on, and fails loudly if the version never
appears. Reading the two as one is how the first run of this left `latest`
behind on two packages and reported success.

How long it waits is the run's budget, not each package's. The biggest
packages reach the package document six minutes or more after their publish,
and the CDN keeps that document for five minutes on top. A 75-second wait per
package left `beta` behind on two or three packages in each of beta.217,
beta.218 and beta.219, and each run still read green because the step is
`continue-on-error`. So it moves everything visible on the first pass, looks
again every 30 seconds at what is still missing, for up to 15 minutes, and
asks whether a version exists from that version's own document, which the CDN
does not cache.

⛔ **This is the one thing `NPM_TOKEN` still does.** An OIDC identity may not
set a dist-tag, so the publish step runs tokenless and this one carries the
secret. In `publish-packages.yml` it is `continue-on-error`: the default
install is already correct by then, so a missing or expired token leaves a
stale second tag and nothing worse. The token expires **2026-12-19**, and on
that day releases go out exactly as before.

`--probe` exists because a run where every tag already happens to be correct
writes nothing, and so cannot tell a runner that MAY write from one that may
not — the automation would look healthy until the first release that needed
it. It rewrites one existing tag to the value it already has: a real
authenticated write, a no-op in its effect, nothing to undo.

⛔ It used to write a throwaway tag and delete it, and that was wrong. **The
publish token may ADD a dist-tag and is refused `403` on DELETE**, so the probe
proved write access and then could not clean up after itself. A probe that
needs a second permission to undo its own first one is not a probe; it is a
second thing that can fail.

⛔ **`createPackage` is not the same as being configured**, and the check knows
the difference. A row created after 2026-09-03 carries `createStagedPackage`
alone unless publishing was asked for explicitly; it appears on every listing
and refuses the release — and a version that failed to publish cannot be
published again under the same number.

## Later

A follow-up project, not this document's commit:

- The licensing decision — which pieces are open source and under which
  license — is an owner decision tracked separately.
