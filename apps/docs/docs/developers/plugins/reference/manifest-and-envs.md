---
sidebar_position: 3
title: Manifests, trust lifecycle & environment
description: The plugin manifest schema, the marketplace listing/version documents, the trust state machine, and every PLUGIN_* environment variable.
---

# Manifests, trust lifecycle & environment

## Plugin manifest (published with every version)

```jsonc
{
  "id": "my-plugin",          // stable kebab-case id; never rename
  "name": "My plugin",        // ≤80 chars
  "version": "1.0.0",         // semver; every publish is a new version
  "entry": "plugin.bundle.mjs", // relative bundle path (no absolute URLs)
  "hostAbi": 1,               // host ABI generation (AGL-429); mismatches never load
  "description": "…",         // ≤500 chars
  "capabilities": {
    "network": ["https://api.example.com"], // sandbox CSP connect-src allowlist
    "props": ["title"],       // host props the bridge forwards
    "events": ["submitted"],  // events the host will accept
    "size": { "height": 240 } // declared frame size
  },
  "contributes": {            // what register() adds, and where
    "site": {
      "components": ["myBanner"], // canvas elements it registers
      "features": []              // runtimes it mounts on every page
    },
    "console": {
      "slots": ["hostActivity"],  // widget slots and panels it fills
      "routes": [],               // site-level console routes it serves
      "orgRoutes": [],            // organization-level routes
      "shell": false              // a nav tab or provider on every page
    }
  },
  "restrictParent": [],       // besigner lineal rules
  "restrictChildren": [],
  "config": {                 // settings the console renders a form for
    "fields": [
      { "key": "pointsPerDollar", "label": "Points per dollar",
        "type": "number", "min": 1 },
      { "key": "tier", "label": "Tier", "type": "select",
        "options": [{ "value": "basic", "label": "Basic" }] }
    ],
    "defaults": { "pointsPerDollar": 5, "tier": "basic" }
  }
}
```

Validation is server-side (`validatePluginManifest`) — invalid manifests
never publish. `capabilities` are enforced by the sandbox tier: the plugin
origin stamps a CSP from `network`, the bridge drops undeclared props and
events.

### `contributes` — where the plugin loads

A plugin loads only where something uses it. Installing one loads nothing:
the platform reads `contributes` to decide which published pages and which
console pages fetch your bundle, and it never runs your code to find out.

| Key | What it declares | Where the plugin then loads |
| --- | --- | --- |
| `site.components` | The canvas component ids `register()` registers | A published page whose node tree places one of them, and the Besigner for every site that runs the plugin |
| `site.features` | The `runtimeId` of each site runtime it mounts | Every page of a site that has the plugin switched on, and the Besigner for that site |
| `console.slots` | The widget slots it fills, including the panels the shell draws as slots (`consoleDock`, `besignerInspector`) | A console page that renders one of those slots |
| `console.routes` / `console.orgRoutes` | The console routes its pages serve (`/my-plugin`) | The pages under those routes |
| `console.shell` | It adds a nav tab, a provider or a staff page, which the shell draws on every page | Every page of the workspace |

The Besigner loads a plugin that declares either `site` key for every site
that runs it, whether or not the page open places one of its elements. That
way its elements appear in the Elements panel and draw on the canvas. The
site's list is the workspace's installs plus the site's own, the same list its
published pages load from.

A marketplace plugin's site component ids are `<identity>.<role>`, where the
identity is `<publisher handle>.<manifest id>`: `acme.quote.calculator` for
the `quote` plugin of the publisher `acme`. A publish that declares a
component outside its namespace is refused. See the
[realm bundles guide](../guides/realm-bundles.md#identity-and-namespace).

One more `site` key declares no load point. `site.functionBindings` names the
elements that run one of the site's
[functions](../../../building-sites/bindings/overview.md) in the
visitor's browser, each mapped to the prop that holds the function's name:

```json
"contributes": {
  "site": {
    "components": ["acme.quote.calculator", "acme.quote.input"],
    "functionBindings": { "acme.quote.calculator": "functionName" }
  }
}
```

When a page is composed, an element listed there gets the named function's
definition and the site variables that function reads. Every other element
gets neither, so a function's rules and prices never reach an element that
did not ask for them. Each key must also appear in `site.components`, and the
value must be a plain prop name. A marketplace declaration cannot rebind a
platform element.

The declaration is the whole contract, so it has to be complete:

- **The verifier compares it with your bundle.** `verify-plugin-bundle.mjs`
  and the publish API read what `register()` registers (a widget's `slot`, a
  nav item's `href`, a runtime's `runtimeId`, a component's `$id`) and refuse
  a registration the declaration omits: a slot you forget to declare is a
  slot whose pages never load your plugin.
- **A new version must declare.** A bundle whose `register()` registers
  anything and whose manifest has no `contributes` fails publishing, with the
  declaration the verifier read printed for you to paste. Write the values
  out (a string, or `CONSOLE_WIDGET_SLOTS.hostActivity`): a registration
  built at runtime cannot be read, and the verifier asks you to confirm it.
- **`{}` declares nothing at all.** Such a plugin loads nowhere, which suits a
  sandbox-only plugin whose `register()` registers nothing.

Versions published before `contributes` existed carry none, and keep working
under one default: **a published page loads such a plugin only where its
element is placed** (a node whose `pluginId` is the plugin's manifest id or
listing id), and **the console loads it with the shell**, as it always did.
The console default is broad because only running `register()` could reveal a
nav tab or a provider; publish a new version with `contributes` to narrow it.

A sandboxed element is a different thing: the platform's plugin element
renders your `render()` entry in an iframe wherever an author places it, and
the frame fetches your bundle, never the page, so it needs no `contributes`
entry.

### `config` — settings without writing a settings page {#config--settings-without-writing-a-settings-screen}

A first-party plugin registers its settings schema by calling
`registerPluginConfigSchema` at module scope. Your bundle cannot: it runs
sandboxed on its own origin and never executes in the console process, so
there is no moment at which that call could happen. Declaring `config` in the
manifest is how you get the same thing.

The console reads it from the **pinned** manifest on the install, so the fields
a workspace sees are the fields the version it installed declared. Your plugin
reads the resolved values with `usePluginConfig(orgId, pluginId)` on the client
or `getPluginConfig(orgId, pluginId)` on the server — the same two calls a
first-party plugin uses — and gets the same two-level behavior for free: the
workspace answers once, and any one site can override a single field and keep
inheriting the rest.

Field `type` is one of `string`, `number`, `boolean` or `select`; a `select`
needs `options`, and a `number` may set `min`/`max`. Anything else is dropped
rather than rendered, at most 50 fields are read, and every default is coerced
to its declared type — so a manifest cannot put a control the console does not
have in front of a customer, and a mistyped default cannot become the value
every site inherits.

## Listing & version documents

- `marketplaceListings/{listingId}` — public: `displayName`, `description`,
  `categories[]` (fixed taxonomy), `logoUrl`, `screenshots[]`, `readme`
  (markdown), `homepageUrl`, `repositoryUrl`, `license`, `priceUsd`,
  `latestVersion`, `installCount` (cumulative installs ever),
  `activeInstalls` (installs live right now — the detail page shows both,
  e.g. `41 installs · 12 active`), `reviewStatus`.
- `marketplaceListings/{id}/pluginVersions/{version}` — **server-only**:
  `sha256`, `objectPath`, `manifest`, `changelog`, `trust?`, `signature?`.
  The buyer-safe subset (version/changelog/trust/hostAbi/date) is exposed
  by `GET /api/marketplace/listing-versions`.
- Installs pin `{version, sha256}` at `hosts/{hostId}/installs/{listingId}`
  (host tier) or `orgs/{orgId}/installs/{listingId}` (org tier). Artifacts
  are immutable content-addressed objects:
  `artifacts/{listingId}/{version}/{sha256}.bundle`.

## Review & trust lifecycle

```
publish ──▶ submitted ──▶ in_review ──▶ listed ──▶ verified
                              │
                              └──▶ rejected (reason → publisher notified)
```

- `listed`/`verified` (or legacy/absent) plugin listings appear in browse;
  everything else is owner-and-staff-only. Verified adds the ✅ badge.
- **Realm trust is separate and orthogonal**: a super-staff signature over
  a version's sha256 (`POST /api/marketplace/admin/trust`) sets
  `trust: 'realm'`, letting that version load into the app realm. The
  `revocations/{listingId}` kill switch beats everything.

## Environment variables

| Variable | Runtime | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PLUGIN_ORIGIN` | client + server | Dedicated plugin origin: serves `/load` (sandbox) and `/artifacts/...` (realm fetches) |
| `PLUGIN_ARTIFACTS_BASE` | server | Optional server-side artifacts base override |
| `PLUGIN_ARTIFACTS_BUCKET` | console server | Isolated bucket the publish flow writes to |
| `NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY` | client | Ed25519 public key (base64 raw); when set, client realm loads require valid signatures |
| `PLUGIN_TRUST_PUBLIC_KEY` | server | Same key, server loaders (mandatory there) |
| `PLUGIN_TRUST_PRIVATE_KEY` | console server only | Signing key (base64 PKCS8 DER) for the staff sign-plugin route |
| `PLUGIN_REMOTE_SERVER` | server | `enabled` turns on remote server bundles (default off everywhere) |
| `PLUGIN_REMOTE_SERVER_BUNDLES` | server | Per-deploy `listingId@version` allowlist |
| `PLUGIN_JOBS_SECRET` | tenant server | Shared secret the scheduler sends to `/api/plugins/run-jobs` |
| `NEXT_PUBLIC_PLUGIN_DEV_BUNDLES` | client, dev only | Unverified localhost bundle loading for the authoring loop; dead code in production builds |
| `PLUGIN_DEV_MANIFESTS` | server, dev only | Comma-separated manifest file paths for the dev loop's bundles. Compose reads their `functionBindings` from disk, because a dev bundle has no install to carry them; never read in production builds |

## `plugins.config.json` (first-party contributors)

The single source mapping plugin ids to packages, register entry points
per surface (`site`, `console`, `staff`, `tenantApi`, `consoleApi`, the
declaration surfaces `declarations`, `serverDeclarations` and
`consoleServerDeclarations`, `subprocessors`, `tenantEmails` and
`videoEmbedProviders`), `apiPrefixes`, and `activityMutationPaths` — the plugin's
modules that create, transfer or destroy a durable customer object, which
`check-activity-coverage.mjs` holds to writing an activity entry.

An entry may also name `modules`: the subpath a surface registers from, when
that surface's code must not ride with the package root's. The loaders read a
loaded module's register function by name, so a bundler keeps everything the
module exports; a plugin with both a site and a console surface therefore
gives the site surface its own module (`"modules": { "site": "site" }` loads
`@aglyn/plugins-forms/site`), and a published page that uses the plugin
fetches the canvas half without the console registrar.

Every entry also carries `contributes`, the same declaration a marketplace
manifest carries (above), and it is required: the generator refuses a plugin
without a valid one, and `apps/console/specs/plugin-contributions-declared.spec.ts`
runs every registrar and fails when what it registers differs from what the
entry declares.
`node tools/scripts/generate-plugin-manifests.mjs` turns it into the four
generated loader manifests, the three declarations manifests, the
subprocessors manifest and the titles manifest — the only files allowed to reference
`@aglyn/plugins-*` outside `libs/plugins` (an nx boundary rule enforces
this), and every reference is an `import()` so the apps never depend on a
plugin statically.

A **declarations** entry (`@aglyn/plugins-x/declarations`, client and
server) is a light module that registers what core must know before any
surface of the plugin has loaded — billing and access keys, activity
actions, a config schema — and a **serverDeclarations** entry
(`/declarations.server`, server only) adds platform-event subscriptions.
A **consoleServerDeclarations** entry (`/declarations.console-server`) is the
same for the console's server alone: the tenant runtime never loads or
bundles it, so it is where a registration belongs that opens something only
the console holds — an eraser that revokes a provider grant with a key the
console keeps. The apps run them once per process: at boot from
`instrumentation.ts`, and with the console's plugin loader module, whose
plugins gate holds the first paint on them. Anything heavy stays behind a
lazy import inside a handler.

A **subprocessors** entry names a function in
`@aglyn/plugins-x/subprocessors` that returns the third parties the plugin's
code reaches — each a host with the entity, region, purpose, publication
date, reason and data received the published subprocessor list carries. The
generator calls it when it runs and writes the answer into
`apps/console/constants/plugins.subprocessors.generated.ts` as data, with no
import of the plugin, because the console's subprocessor inventory is read
synchronously. `foldPluginSubprocessors` folds that manifest into the
inventory and refuses a host declared twice, by the inventory or by another
plugin. Regenerate after changing a declaration; `--check` refuses a stale
manifest.

The inventory keys on every host the code names, so the function may answer
an object instead of a list: `{ subprocessors, hosts, uses }`. `hosts` are
the hosts the plugin's code names that are not published recipients, each
`not-a-subprocessor` (a request is made, and nothing personal reaches the
host, or the customer chose it) or `no-request` (nothing of ours requests
it), with the reason and what the host receives. `uses` are hosts the
inventory or another plugin already declares that the plugin's code reaches
as well: the host keeps its one declaration, and the plugin's reason and
data are appended to that entry. A use of a host nothing declares is
refused — declare the host instead.

A **tenantEmails** entry names a function in `@aglyn/plugins-x/tenant-emails`
that returns the emails a site sends its own customers through the plugin —
each with its key (the site's template document id), name, description,
plugin, and whether the site owner designs it in the email besigner, authors
it elsewhere, or cannot change it yet, with the default subject, merge tokens
and built-in copy a designable one needs. The generator compiles the answer
into the email lib's `TENANT_EMAILS` as data, because the send path reads it
without loading any plugin. A key declared twice, an entry that names another
plugin, or an `external` entry with no `authoredIn` is refused. Regenerate
after changing an entry; `--check` refuses a stale catalog.

A **starterTemplates** entry names a function in
`@aglyn/plugins-x/starter-templates` that returns the starter sites a plugin
offers — starters built around its own elements, such as a shop around a
product grid and a cart — each with its id, name, description, category and
pages, built with the kit in `@aglyn/aglyn/app-utils/starter-template-nodes`.
The generator compiles them into core's `STARTER_TEMPLATES`, after the
platform's own, because the template gallery, the seed route and the examples
a model is shown read the list without loading any plugin. A starter id
declared twice, a starter with no pages or two pages under one key, or a page
placing an element of another plugin than its own or mui is refused. The ids,
the page keys and the node ids are persisted in every site that used the
starter, so they are never renamed. Regenerate after changing a starter;
`--check` refuses a stale list.

The **titles manifest** (`apps/console/constants/plugins.titles.generated.ts`)
is read from a plugin's source rather than from an entry: each console nav
item's `label` and `href` in its `plugin.ts`, and the `*-console-sections.ts`
list its `sections` names. The console's plugin layouts title a browser tab
from it — the surface's label, then the open section's — because they are
server components and cannot load the console registry. A surface or section
named two different ways is refused. Regenerate after renaming a nav item or
a section; `--check` refuses a stale manifest.

A **videoEmbedProviders** entry names a function in
`@aglyn/plugins-x/video-embed-providers` that returns the video hosts whose
own player the plugin's Video element frames: the domains a host's links live
on, the path patterns that carry the media id, the one origin the player is
framed from, its path and the query it reads. The generator calls it,
validates the answer and compiles it into core's
`first-party-plugins.generated.ts`, because its readers — the published
page, its `VideoObject` and the tenant middleware's `frame-src` — load no
plugin code. Core's `video-embed-provider.ts` resolves a link from the
compiled list alone and rebuilds every player address from the media id, so
a frame is only ever on a declared origin. Regenerate after changing a
declaration; `--check` refuses a stale copy.

A **staff** entry names the registrar the console's staff area loads,
usually the same function as `console`. The org routes load each
workspace's enabled plugins and a staff page names no workspace, so the
staff area loads exactly the plugins with a `staff` entry, before a staff
page renders: the [staff zones](./injection-zones.md#staff-zones) read their
widgets, and the staff strip and the generic staff route read their
`staffPages`.
 The scaffolder (`tools/scripts/create-plugin.mjs`)
maintains it for you, the plugin's `catalog` row included: its label,
description, release flag and what a published site loses when it is switched
off. The generator compiles every row into the core's switchboard catalog, so
a new plugin edits no core file. The manual follow-ups are that row's
description and the release flag (registry + Remote Config template).
