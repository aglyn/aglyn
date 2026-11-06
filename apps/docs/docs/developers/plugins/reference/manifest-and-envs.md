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
    "size": { "height": 240 }, // declared frame size
    "imageHosts": ["images.example.com"] // hosts your elements show images from; see "connections"
  },
  "connections": [ /* see "connections" below */ ],
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

### `connections` — an OAuth connection the platform runs for you {#connections}

Your bundle runs sandboxed in the visitor's browser and never on Aglyn's
servers, so it cannot hold an OAuth grant. A **declared connection** is how a
plugin gets one anyway: you describe the provider, the hosts and the picker as
data, and the platform runs the connect and holds the grant. Your code never
sees a token.

```jsonc
"connections": [
  {
    "id": "reviews",                 // lowercase, digits, dashes; never rename
    "provider": "google",            // a label for people and logs
    "label": "Google Business Profile",
    "description": "Show your Google reviews.",
    "authorizationUrl": "https://accounts.example.com/o/oauth2/v2/auth",
    "tokenUrl": "https://oauth2.example.com/token",
    "revocationUrl": "https://oauth2.example.com/revoke", // optional
    "scopes": ["https://www.example.com/auth/business.manage"],
    "authParams": { "access_type": "offline", "prompt": "consent" },
    "tokenAuthMethod": "body",       // or "basic"
    "apiHosts": ["mybusiness.example.com", "*.example.net"],
    "resources": [                   // what the site owner picks, in order
      {
        "id": "accounts", "label": "Account",
        "request": {
          "method": "GET",
          "url": "https://mybusiness.example.com/v1/accounts",
          "itemsPath": "accounts",
          "pagination": { "cursorPath": "nextPageToken", "cursorParam": "pageToken", "maxPages": 5 }
        },
        "idPath": "name", "labelPath": "accountName"
      },
      {
        "id": "locations", "label": "Location",
        "request": {
          "method": "GET",
          "url": "https://info.example.net/v1/{{resource.accounts}}/locations",
          "query": { "readMask": "name,title" },
          "itemsPath": "locations"
        },
        "idPath": "name", "labelPath": "title", "maxItems": 50
      }
    ],
    "sync": {                        // run by the platform; see below
      "intervalHours": 6,            // at least 1
      "requests": [
        {
          "id": "reviews", "method": "GET",
          "url": "https://mybusiness.example.com/v4/{{resource.accounts}}/{{resource.locations}}/reviews",
          "itemsPath": "reviews"
        }
      ],
      "record": {                    // typed, bounded record fields
        "fields": {
          "averageRating": { "request": "reviews", "type": "number", "path": "averageRating" }
        },
        "items": {
          "request": "reviews", "maxItems": 20,
          "fields": {
            "reviewer": { "type": "string", "path": "reviewer.displayName", "maxLength": 100 },
            "rating": { "type": "number", "path": "starRating",
                        "map": { "ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5 } },
            "createdAt": { "type": "datetime", "path": "createTime" }
          }
        }
      }
    }
  }
]
```

How it runs:

1. **You set your OAuth app once per listing.** Your workspace enters the
   client id and secret for each declared connection on the listing; a member
   needs **Set a listing's connection credentials**. They are stored sealed and
   are never shown again: the form only ever says *set* or *not set*.
   Register the callback `https://<console>/api/plugin-connections/connect/callback`
   as a redirect URI on your OAuth app.
2. **A site owner connects.** On a plan that includes connections (Starter,
   Pro and Custom), a member holding **Manage a site's plugin connections**
   connects the site. The platform sends them to your `authorizationUrl` with
   your client id, its own redirect, your `scopes` and a signed, single-use
   state, then exchanges the code at your `tokenUrl`. The tokens are stored
   sealed, on the site.
3. **They pick what to connect.** Each of `resources` is listed in order with
   the site's token, and a later one may name an earlier choice as
   `{{resource.<id>}}`. Choosing again clears the choices after it. A
   provider that refuses the grant marks the connection *reconnect required*
   until the owner connects again.

4. **The platform syncs it.** Once every resource is chosen, the platform
   runs your `sync` for the site, then again every `intervalHours`, and
   writes what it read into the site's **record** (below). A member with
   the site's connections permission can also press **Sync now** on the
   connection's card, on the site's page for your plugin under **Site Admin →
   Plugins**, to run it at once.

#### How the sync runs {#connection-sync}

- **When.** The console checks for due connections every 15 minutes and
  runs a sync once `intervalHours` have passed since the last one that
  succeeded, so a 6-hour interval runs about every 6 hours. A few connections
  run at a time and the rest wait for the next check, oldest first. **Sync
  now** runs it at once; it is refused within a minute of the last sync.
- **With what.** The declaration of the version the site has installed and
  the site's own token, refreshed when it is about to expire and once more if
  your API answers 401 or 403. Each request in `requests` that the `record`
  reads is filled from the site's choices and checked against `apiHosts`
  again before it is sent; a request the record never reads is not sent.
- **How much.** Pages are followed through `pagination` up to `maxPages`, and
  stop once the record has `items.maxItems` entries. Every answer is read up
  to 2 MB, each attempt times out after 30 seconds (a 429 or 5xx is retried
  twice), a redirect is refused rather than followed, and no new page is
  started once a sync has run for a minute.
- **The record.** The answers are mapped into exactly the fields you declare:
  summary `fields` from the first page of the request they name, and one
  entry per item for `items`. Nothing you did not declare is copied. A
  `string` is cut to its `maxLength`; a `url` is kept only when it is `https`,
  carries no credentials and fits its `maxLength` whole; a `datetime` becomes
  epoch milliseconds; a value a `map` does not list is dropped. A declared
  field with no usable value is `null`, so every entry has the same keys. The
  record is replaced whole on every sync, and trailing items are dropped if it
  would pass 512 KB. It is stored with the site on the server and is never
  readable by a browser.
- **When it fails.** If your provider refuses the grant (`invalid_grant`, or a
  401 that a fresh token does not cure), the connection becomes *reconnect
  required* and is not synced again until the site owner connects again. Any
  other failure is shown on the card with your provider's message and tried
  again after 15 minutes, then 30, then an hour, doubling up to your
  `intervalHours`. The last good record stays in place either way.
- **When it pauses.** A workspace whose plan does not include connections,
  and a version the marketplace revoked, keep their connection and their last
  record but are not synced.
- **When it goes.** Uninstalling the plugin, or moving the site to a version
  that no longer declares the connection, revokes the grant at your
  `revocationUrl` and deletes the connection and its record. So does
  disconnecting it.

The validator checks every rule in the table below (the requests, the
interval and the `record` fields), and a manifest that breaks one is refused.

A connection runs under the declaration of the version the site has
**installed**, never the listing's newest, and a revoked version's
connections stop with it. Disconnecting revokes the grant at your
`revocationUrl` when you declare one; deleting a site does the same.

The rules, all enforced by `validatePluginManifest` at publish and by
`verify-plugin-bundle.mjs` locally (a manifest that breaks one is refused
whole):

| Field | Rule |
| --- | --- |
| `authorizationUrl`, `tokenUrl`, `revocationUrl` | `https`, a public host (no IP address, no `localhost`), no credentials, port, query or fragment. Put extra parameters in `authParams`. |
| `authParams` | At most 10 short strings. `client_id`, `client_secret`, `redirect_uri`, `response_type`, `state`, `scope`, `code`, `code_challenge`, `code_challenge_method` and `nonce` are the platform's and are refused. |
| `scopes` | 1 to 20, no spaces or commas. |
| `apiHosts` | 1 to 10. An exact lowercase public hostname, or `*.` followed by one (`*.example.com`), which covers exactly **one** label: `a.example.com`, not `a.b.example.com` and not `example.com`. `*.com`, `*.*.example.com` and `*api.example.com` are refused. |
| `request.url` | `https`, on one of `apiHosts`, with its host written out literally: `{{resource.<id>}}` may appear in the path, the query and a POST `body`, never in the host. It is checked against `apiHosts` again after it is filled in, and a choice that could leave the path (`..`, `?`, `#`, `%`, `//`) is never put in a URL. |
| Placeholders | Only `{{resource.<id>}}`, naming a resource declared **before** the request (or any resource, in `sync`). |
| `pagination.maxPages` | 1 to 10. |
| `resources` | At most 3; `maxItems` 1 to 200 (100 when absent). |
| `sync.intervalHours` | A whole number from 1 to 168. |
| `sync.requests` | 1 to 3. |
| `record` | `fields`, `items` or both; at most 20 fields each; `items.maxItems` 1 to 100. A field's `type` is `string`, `number`, `boolean`, `datetime` or `url`. A `string` field needs a `maxLength` up to 5,000 and a `url` field one up to 2,048. `map` has at most 32 entries of short strings, numbers or booleans. |
| The whole block | At most 4 connections, 32,000 characters serialized. |

Your bundle must never call a connection's hosts itself: the verifier refuses
a bundle that calls an `apiHosts`, `tokenUrl` or `authorizationUrl` host, and a
manifest that lists one under `capabilities.network`.

#### Showing the record in a site element {#connection-record}

A signed plugin's site element reads its connection's record with
`usePluginConnectionRecord`, from the host's `@aglyn/aglyn` surface:

```js
import { createElement as h } from 'react'
import { usePluginConnectionRecord } from '@aglyn/aglyn'

function ReviewsBadge() {
  const record = usePluginConnectionRecord('reviews') // a connection id from YOUR manifest
  if (!record) return null
  const { averageRating, totalReviewCount } = record.fields
  return h('p', null, `${averageRating} stars from ${totalReviewCount} reviews`)
}
```

- **The record arrives with the page.** The platform reads it on the server
  and renders your element into the page's HTML, so visitors and search
  engines see the rating in the first response. Your element never fetches it.
- **It is your own listing's record, always.** The hook takes a connection id
  and nothing else. Which listing it reads is the listing your element belongs
  to, so one plugin's element can never read another plugin's record.
- **Its shape is your `record` declaration.** `record.fields` holds the
  declared summary fields, `record.items` the declared list (at most its
  `maxItems`), and `record.syncedAtMs` when it was written. Keys you did not
  declare are never present. A `datetime` value is epoch milliseconds.
- **`null` means there is nothing to show yet**: the site has not connected,
  no record has been written, or the workspace's plan does not include
  connections. Decide what your element draws then; drawing nothing is
  usually right.

In the editor, the console reads the same record from
`GET /api/plugin-connections/record?hostId=&listingId=&connectionId=`, which
answers `{ record }` (or `{ record: null }`) to a member holding **Manage a
site's plugin connections**.

#### Record values as site variables {#connection-variables}

Each declared **summary** field (`record.fields`) is also a site variable on
every site that installs your plugin, so a page can print it anywhere with a
`{{var:…}}` token, inside any element:

```text
{{var:<listingId>__<connectionId>-<field>}}     e.g. {{var:Kq3vR7mXa2Lp9sT4bNw1__reviews-averageRating}}
```

- The id is your listing's id, two underscores, the connection id, a hyphen,
  and the field name. It can never be the same as a site's own variable or
  another plugin's field.
- An id longer than 64 characters has no variable, so keep connection ids and
  summary field names short.
- `number`, `boolean` and `datetime` fields become number, true/false and date
  variables; `string` and `url` fields become text. A field the record does not
  hold prints nothing, like any unknown variable.
- `items` never become variables: a list has no single value to print.

#### Image hosts {#image-hosts}

`capabilities.imageHosts` names the hosts your elements show images from, such
as a reviewer's profile photo. On every site that installs your signed plugin,
the platform adds each one to the page's `img-src` policy as an `https://`
source; every other site's policy is unchanged. The rules:

- At most 5 hosts.
- An exact lowercase public hostname (`lh3.example.com`), or `*.` and a domain
  (`*.example.com`), which covers exactly one label.
- No scheme, port or path. `data:`, `http:` and IP addresses are refused.

A manifest that breaks a rule is refused at publish and by
`verify-plugin-bundle.mjs`.

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

The rest of this section is the reviewer's side of that lifecycle — the staff review
queue and a submission's review page — so a publisher can see what their submission is
checked against.

### The review queue {#review-queue}

**Awaiting review** lists the plugin submissions waiting on a staff verdict; open one
to read its listing, manifest and verifier findings, then act on it. Search finds a
plugin by the start of a word of its name, and the status menu narrows the queue.

### Verification requests {#verification-requests}

**Verification requested** lists publishers who asked to be
[verified](../publishing/publisher-handbook.md#asking-to-be-verified) — a claim about
who they are, separate from reviewing any one version. Their plugins stay listed and
installable while the request waits.

### Listed plugins {#listed-plugins}

**Listed plugins** lists the plugin listings that are already installable, the step
that makes a version reachable from Browse. It is also where staff grant or revoke
realm trust for a listed version.

### A submission's status {#submission-status}

**Status** says where the version under review stands — submitted, listed, verified or
rejected — and, when the listing was taken down or unpublished by its publisher, says
so with the reason on file.

### The listing under review {#review-overview}

**Overview** shows the listing as a customer will see it — name, description, media and
links, all supplied by the publisher — and flags what is missing, such as no license or
no README.

### The review checklist {#review-checklist}

The **Review checklist** is what a reviewer works through for one version, and it is
re-earned per version: a new release starts with none of it ticked. It sits under the
publisher's own attestation for those bytes, and approval waits on every required item.

### Review verdict {#review-verdict}

**Review verdict** moves a submission through the lifecycle: approve the version, or
reject it with a reason the publisher is sent. Approving makes these bytes the version
new installs receive; existing installs are pinned and do not move.

### Versions under review {#review-versions}

**Versions** lists every version the publisher has submitted, because review lives on
the version and each one is judged on its own. Each row shows its state — **Latest**,
**Stopped**, or **Rejected but still running** — with **Stop this version** and, for
super-staff, granting or revoking realm trust.

### Taking a listing down {#take-down}

**Take down**, in the review page's danger zone, de-lists a plugin and writes the kill
switch: every workspace that installed it stops loading it on the next render, and new
installs are refused. Rejecting a version is not that — it stops new installs and
leaves existing ones running. **Restore listing** clears both.

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
| `PLUGIN_CONNECTIONS_TOKEN_KEY` | console server only | 32 random bytes, base64 (`NEW,OLD` to rotate): seals every publisher's OAuth app credentials and every site's connection tokens. Unset, no [declared connection](#connections) can be connected |
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
framed from, its path and the query it reads. A link shape a path pattern
cannot describe goes in `mediaIdLinks`: one that names the id in a query
parameter (`param`), or one read on only some of the host's domains
(`domains`). A query value may repeat the id as `{id}`. The generator calls it,
validates the answer and compiles it into core's
`video-embed-providers.generated.ts`, because its readers — the published
page, its `VideoObject` and the tenant middleware's `frame-src` — load no
plugin code. It is a file of its own, not the plugin catalog, so a published
page with no video downloads none of it. Core's `video-embed-provider.ts` resolves a link from the
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
