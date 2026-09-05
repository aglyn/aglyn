# Plugin boundary audit — what is still in the wrong place, and what a move would cost

Status: **audit only. No production code changed.** Read against `main` at
`198a8fef0`. Nothing here is decided; every entry ends with the argument
against it, because several of these are things that genuinely belong where
they are.

> ⛔ **No Linear issue was opened or referenced while writing this.** Every
> `AGL-` id below is quoted from a code comment as provenance for a file. None
> is asserted as a description of an issue, and none was invented.

> 🧭 **Forms is the calibration case, not an entry.** The owner has already
> decided that forms becomes `libs/plugins/forms`, and a move is being
> scheduled separately. It appears here only in §2, where its cost model is
> the one every other candidate is measured against.

> 🔀 **Concurrent work.** Six branches are live across email, forms, revenue
> and sending domains. `git log` at the time of reading shows the recent
> commits landing in `libs/plugins/email` and `libs/plugins/marketing` only.
> None of the files cited below is being rewritten by them; where a live
> branch touches an area, it is called out in the entry.

---

## Verdict up front

**Two canvas elements are sitting in the generic library while the plugin that
owns their behavior already exists.** They are not proposals for new plugins.
They are elements that missed the boat on a move that has already happened
twice.

1. **`functionWidget` belongs in `libs/plugins/logic`.** The logic plugin's own
   docblock says it has no canvas element. It has one. The element is in
   `mui`.
2. **`product` belongs in `libs/plugins/commerce`.** It POSTs to
   `/api/commerce/checkout`, a route the commerce plugin owns and that 404s
   when commerce is switched off — while the element itself ships in the
   always-on bundle and is offered on every site.

Everything else on the list is either a systematic residue (§3.3, models left
in core when their console surfaces became plugins) or a genuine judgment call
where core is defensible.

**And a correction that applies to all of them, forms included.** The cost of
moving an element between bundles is not zero just because component ids are
bare strings. `pluginId` is persisted on every node *alongside* `componentId`,
and since the render-narrowing work landed it is read at request time to decide
which bundles load before first paint. §2 works this through. It does not make
any of these moves wrong; it changes what "cheap" means and adds a step that
the two completed precedents never had to take.

---

## 1. The criteria, as the repo states them

Each of these is quoted rather than asserted, because the whole audit rests on
them.

**The direction.** `apps/console/constants/host-nav-tabs.ts` is now, in its
static-tab section, largely a record of departures:

```
// Inbox (nav + page) now comes from the inbox plugin's ConsoleExtension,
// served by the generic route (AGL-395).
...
// Logic, Automation (nav + page) now come from their plugins'
// ConsoleExtensions, served by the generic route (AGL-395).
```

What remains as a hardcoded tab: Dashboard, Screens, Layouts, Components,
Templates, Media, Content, Users, Analytics, Setup, Admin. That list matches
the host route directory exactly — `apps/console/app/(app)/[orgSlug]/hosts/
[host]/` contains `admin`, `analytics`, `components`, `content`, `forms`,
`layouts`, `media`, `screens`, `setup`, `templates`, `users`, and the generic
`[...pluginSlug]`. **`forms` is the only feature-shaped app route left**, which
is the same conclusion the owner already reached.

**The mui rule.** `libs/aglyn/src/lib/plugin-manager/feature-plugins.ts:18-22`:

> Each feature ships as one lib under `libs/plugins/{feature}` … that owns both
> halves and **never merges into `plugins-mui` (which stays pure
> component/theme definitions)**.

**The console-only test.** `libs/plugins/inbox/src/lib/plugin.ts:32-34`:

> Console-only — form submissions, site members/leads, orders, and campaigns
> live in Firestore and **have no canvas element, so there is no UI bundle**.

A capability with *both* a canvas element and a console surface is therefore
the `commerce` shape and wants a lib of its own. This is the test that
`functionWidget` fails.

**The precedent, recorded in the bundle it left.**
`libs/plugins/mui/src/lib/plugin.ts:116-117`:

```
// booking moved to @aglyn/plugins-bookings (AGL-395).
// event-list moved to @aglyn/plugins-events-calendar (AGL-313).
```

Two elements have already made exactly this journey, and the mui bundle keeps
a comment where each one used to sit — the same convention `host-nav-tabs.ts`
uses. `product`, `functionWidget` and `searchBox` are still in the list at
lines 130, 131 and 134.

**The layering constraint that decides where a MODEL may live.**
`eslint.config.mjs:242-250`:

> Feature plugins (AGL-409). They carry ONLY `aglyn:addons` (not the generic
> `scope:lib`/`scope:aglyn`), so as a dependency TARGET no core scope's
> allowlist reaches them — **core libs cannot import a plugin, keeping the app
> runnable with any plugin absent.**

This is the single most useful rule in the audit, and it settles several
entries on its own. A model that core needs cannot move into a plugin, full
stop. It is not a preference; the lint rule refuses it.

---

## 2. What a move actually costs

This section exists because "does anything persisted have to change?" has three
different answers depending on which of three persisted things you look at, and
only the first is the one usually checked.

### 2a. Component ids — no cost

Component ids are bare strings and are never namespaced by bundle:
`'functionWidget'`, `'product'`, `'searchBox'`, `'booking'`, `'form'`. Every
element file carries the same comment:

```
// Component ids are persisted in screen documents; never rename.
```

Resolution at render is by component id **alone** —
`libs/aglyn-node-renderer/src/lib/components/leaf.tsx:91` calls
`Aglyn.components.getFactory(node?.componentId)` with no plugin scoping. So an
element that changes bundles resolves from any registered bundle, and no saved
node document has to be rewritten.

The precedent confirms it empirically. `3ef14121d` ("extract booking into its
own plugin") touched **three lines** of `libs/plugins/mui/src/lib/plugin.ts`
and shipped no backfill. Its message: "component id `'booking'` preserved, mui
stops registering it".

### 2b. The node's `pluginId` — a real cost, and newer than both precedents

`pluginId` is persisted next to `componentId` on every node.
`libs/plugins/mui/README.md:13-14` states it plainly:

> Component ids are persisted in screen documents (`componentId` +
> `pluginId: 'mui'` on every node)

It gets there by being copied off the preset when the element is placed —
`libs/besigner/core/src/lib/dnd-manager/dnd-manager.ts:160`
(`pluginId: preset.data?.pluginId`) and
`libs/besigner/feature/designer/src/lib/hooks/use-add-element-drawer-callback.ts:80`.

For most of this codebase's life that field was inert. It is not any more.
`libs/tenant/runtime/src/lib/required-site-plugins.ts` decides which bundles
must be registered *before first render*, and it says of its first criterion:

> **Its components are on the page.** Without it registered the canvas has no
> component to render for those nodes — the blank-site failure (AGL-52). **Read
> straight off each node's `pluginId`.**

The loop is `if (node?.pluginId) needed.add(node.pluginId)`. So a node saved
before an element moved still names the old bundle, and the new one is not in
the blocking set. The consequence is bounded but real:
`apps/tenant/app/[host]/[[...slug]]/catch-all-client.tsx:111-112` loads the
rest of the enabled set straight after hydration and ticks a re-render, so the
element appears **late** rather than never — a visible pop-in on a published
page, on exactly the pages that already contain the element.

**The ordering matters and nobody has revisited it.** `booking` left mui on
`3ef14121d` (2026-07-11). `requiredSitePlugins` landed on `6d4ac5e73`
(2026-08-06), three and a half weeks later. The two completed element moves
were free when they were made and acquired this cost afterward. Any node placed
before July carrying `componentId: 'booking'` and `pluginId: 'mui'` is in that
state today. **I could not verify this against production data** — it is a
mechanism-level inference from the two code paths above, and it is the first
thing to check before scheduling any further element move.

The mitigation is cheap and already invented (§2d).

### 2c. `org.enabledPlugins` — the cost that decides whether a move is safe

Moving an element out of `mui` moves it out of the only bundle marked
`alwaysOn: true` (`libs/aglyn/src/lib/plugin-manager/enabled-plugins.ts:148`)
and behind a per-workspace switchboard and a release flag. Every other
first-party plugin carries a `releaseFlag`, and the field's own docblock says:

> A flagged-off plugin is subtracted from every workspace's effective set —
> console loader, published sites, and API dispatch.

`org.enabledPlugins` is persisted. So for each candidate the question is not
"does a document change shape" but "**is there a workspace for which this
element renders today and would stop**". For `logic` and `commerce` both flags
are `defaultEnabled: true` and `resolveEnabledPlugins` treats an absent field
as the full first-party set, so the exposure is limited to workspaces that have
explicitly switched the plugin off — a set the owner can count before deciding.

### 2d. The mitigation the repo already built

`libs/aglyn/src/lib/app-utils/enabled-plugins-context.ts:59-77` documents this
exact problem and its answer, for the Members blocks:

> The Members blocks … are registered by the COMMERCE bundle, so `pluginId`
> alone said "commerce is on, offer them" on sites whose `/signin`, `/signup`
> and `/recover` return 404. An author drops a sign-in block on a page,
> publishes it, and finds out from a visitor.
>
> Attribution by category rather than by re-registering the components under
> the `accounts` id: **re-registering moves where they LOAD from and would
> change what sites already using those blocks serve.** This map is read-time
> only — it decides what the picker OFFERS, never what a page that already
> contains one renders.

`CATEGORY_REQUIRED_CAPABILITY` currently maps one category
(`ComponentCategory.MEMBERS` → `accounts`). It is the cheapest available fix
for the correctness half of §3.2 without paying §2b or §2c at all, and it is
the reason that entry offers two options rather than one.

---

## 3. Candidates, ranked by value

### 3.1 — `functionWidget` → `libs/plugins/logic` · **confidence: high**

**A plugin that documents itself as having no canvas element has one.**

| piece | where it lives today |
| --- | --- |
| model | `libs/aglyn/src/lib/app-utils/functions.ts` (328 lines: the operation model plus a safe expression evaluator) and `variables.ts` |
| console surface | `libs/plugins/logic/src/lib/components/host-functions-card.component.tsx`, `host-variables-card.component.tsx`, `logic-console-page.tsx` |
| second console surface | `apps/console/components/besigner-functions-button.component.tsx` — the ƒx app-bar button, rendering the plugin's cards through the `besignerFunctions` widget slot, mounted by all five besigner pages |
| canvas element | `libs/plugins/mui/src/lib/components/function-widget.tsx` (id `functionWidget`), registered in `MUI_BUNDLE` at `libs/plugins/mui/src/lib/plugin.ts:130` |
| storage | `hosts/{hostId}/functions/{id}`, quota `functionsPerHost`, in the site export/import manifests |
| compose hook | `Aglyn.attachFunctionDefinitions` at `libs/tenant/runtime/src/lib/compose-screen-nodes.ts:477` |

**The criterion it meets, quoted.** `libs/plugins/logic/src/lib/plugin.ts:29-32`:

> Logic feature plugin (AGL-395). Console-only — variables and no-code
> functions resolve at render through the tenant compose pipeline, **not a
> canvas element of their own, so there is no UI bundle.**

Against `libs/plugins/mui/src/lib/components/function-widget.tsx:47-48`:

> renders an input per function parameter and **runs the host function
> client-side** through the shared safe evaluator on click — a no-code
> calculator/logic block

Both cannot be true. The element even names the plugin's own compose hook in
its prop documentation (`function-widget.tsx:39`: "Injected at tenant compose
time (attachFunctionDefinitions)"). This is the `commerce` shape — canvas
element plus console surface — and it is the case the inbox docblock's test was
written to catch.

**Persisted data.** *No document rewrite.* Component id `functionWidget` is a
bare string; §2a applies unchanged. `hosts/{hostId}/functions` is matched by
the generic host subcollection rule at
`cloud/firebase-firestore.rules:2000` and is named in the exclusion lists at
`:2291-2296` by **collection name, not by owning plugin** — moving the element
touches no rule. What does apply is §2b (nodes already carrying
`pluginId: 'mui'` render a beat late until re-saved) and §2c (`release_logic`
is `defaultEnabled: true`, so only workspaces that explicitly disabled Logic
are exposed).

**Split across more than two homes: yes — four.** Model in core, console page
in the plugin, console *button* in the app, canvas element in mui.

**Recommendation.** Move `function-widget.tsx` into `libs/plugins/logic`, give
`logic` a `site` register entry in `plugins.config.json` (it currently has only
`console`), and correct the docblock. Leave `functions.ts` and `variables.ts`
in core — see the counter-argument.

**The argument against.** The *model* must not follow the element.
`compose-screen-nodes.ts` in `libs/tenant/runtime` calls
`attachFunctionDefinitions`, and `libs/tenant/runtime/project.json` tags it
`scope:aglyn`, whose constraint is `onlyDependOnLibsWithTags: ['scope:aglyn',
'scope:shared']`. A plugin is `aglyn:addons`. **The tenant runtime cannot import
the logic plugin.** So this move splits Logic *further* in one sense — the
evaluator stays in core forever — and someone could reasonably argue that a
capability whose evaluator is a permanent core resident is a core capability
with a console page, which is precisely the caveat the brief warns about. The
counter to that counter is that the *element* is not the evaluator: it is a
thin widget that calls it, exactly as `product-detail` is a thin widget that
calls `/api/commerce/checkout`. Element and contract can live apart; the
element is what is misfiled.

---

### 3.2 — `product` → `libs/plugins/commerce` · **confidence: high**

**An always-on element that depends on a switchable plugin's server.**

| piece | where it lives today |
| --- | --- |
| canvas element | `libs/plugins/mui/src/lib/components/product.tsx`, id `product`, `category: ComponentCategory.COMMERCE`, registered at `libs/plugins/mui/src/lib/plugin.ts:131` |
| its server | `/api/commerce/checkout` — `product.tsx:87` — dispatched under the `commerce` api prefix declared in `plugins.config.json` |
| storage it reads | `hosts/{hostId}/products`, per `product.tsx:39` |
| its siblings | `product-detail`, `product-grid`, `product-reviews`, `related-products`, all in `libs/plugins/commerce/src/lib/components/` |

**The criterion it meets, quoted.** The mui rule (`plugins-mui` "stays pure
component/theme definitions") and its own docblock, `product.tsx:52-54`:

> **Commerce Starter** product block (AGL-90): displays from its own props, but
> Buy posts `{hostId, productId}` to the tenant's `/api/commerce/checkout`

An element that names another bundle's API prefix in its own docblock is not a
component/theme definition.

**And it is not only untidy — it reproduces a hazard the repo has already
fixed once.** `apps/tenant/app/api/[...pluginApi]/route.ts:108` gates dispatch
on `resolveHostEnabledPlugins`; the route's docblock says a prefix whose plugin
"the host's org has switched OFF (`org.enabledPlugins`, AGL-416) 404 exactly".
Meanwhile `product` ships in the always-on bundle, so it is offered in the
element picker on a site with Commerce disabled, and its Buy button posts to a
404. That is the same sentence written about the Members blocks in
`enabled-plugins-context.ts`: "An author drops a sign-in block on a page,
publishes it, and finds out from a visitor."

**Persisted data.** *No document rewrite* (§2a). §2b applies. §2c is the one to
weigh: `release_commerce_v2` is the gate, and any workspace with Commerce off
that has a live `product` node would lose it on a bundle move — which is
arguably the correct outcome, since that node's Buy button is already broken
for them, but it is a behavior change on published pages and must be named as
one.

**Split across more than two homes: yes — three.** Element in mui, server in
commerce, storage under a collection commerce owns.

**Recommendation, in two parts, because they are separable.**

- *Cheap and safe now:* extend `CATEGORY_REQUIRED_CAPABILITY` with
  `ComponentCategory.COMMERCE → 'commerce'`. That is read-time only, changes
  nothing about what an existing page renders, and stops the picker offering
  the block on sites whose checkout 404s. It pays none of §2b or §2c.
- *The tidy-up:* move `product.tsx` into `libs/plugins/commerce` beside its
  four siblings.

**The argument against the second part.** `product` may simply be dead weight.
It is the "Commerce Starter" block from an early issue; `product-detail` in
commerce is the mature element, with variants, reviews, wishlist, related
products and the Payment Element. Moving a superseded element into commerce
buys a tidier tree and nothing else, and the honest alternative is to decide
whether `product` should be *retired* — hidden from the picker, kept
registered so existing pages render — rather than relocated. That decision
should come first, because it makes the move moot.

---

### 3.3 — Feature models left in core when their console surfaces became plugins · **confidence: medium (as an observation), low (as a move)**

**The strongest structural signal in the repo, and mostly not actionable.**

Six existing plugins are console shells whose domain models stayed in
`libs/aglyn/src/lib/app-utils/`:

| plugin | model still in core |
| --- | --- |
| `contacts` | `contacts.ts` — `HostContact`, `contactMatchesSegment`, `checkContactQuota`, `CONTACT_SOURCE_LABELS`, all imported from `@aglyn/aglyn` by `crm-console-page.tsx` |
| `workflows` | `workflows.ts`, `actions.ts`, `webhook-delivery.ts`, `run-history-shape.spec.ts` — `HostWorkflow`, `runWorkflow`, `HOST_EVENT_TYPES` imported by `host-workflows-card.component.tsx` |
| `data` | `datasets.ts`, `dataset-models.ts`, `dataset-query.ts`, `dataset-record-view.ts`, `dataset-csv.ts` — while the plugin holds only `model/dataset-io.ts` |
| `logic` | `functions.ts`, `variables.ts` |
| `email` / `marketing` | `email-topics.ts`, `dynamic-list-rule.ts`, `campaign-attribution.ts`, `campaign-forwarding.ts`, `marketing-consent.ts` |
| `marketplace` | `marketplace-listing-visibility.ts`, `-merge`, `-overrides`, `-provenance`, `-theme`, `-update-state`, `-verification`, `publisher-agreement.ts`, `publisher-attestation.ts` — nine modules |

Every one of these is a capability living in three or more homes. By the
brief's own heuristic that is the loudest signal on the list.

**And for most of them it is the correct arrangement, for a reason the repo
states.** Per `eslint.config.mjs:242-250`, core libs cannot import a plugin,
"keeping the app runnable with any plugin absent". So the test is not "does
this model describe a plugin's domain" but "**does anything outside plugins
still need it**". Where the answer is yes the model has to stay, and the
residue is load-bearing rather than leftover. Confirmed instances:

- `functions.ts` / `variables.ts` — `libs/tenant/runtime` calls
  `attachFunctionDefinitions` and is tagged `scope:aglyn`. Cannot move.
- `datasets.ts` — `expandRepeatables` runs in the tenant compose path
  (`compose-screen-nodes.ts:442`), and the form element binds `datasetId`.
  Cannot move.
- `contacts.ts` — `libs/aglyn/src/server.ts:40` already records a deliberate
  decision about it: its normalizer "stays in `app-utils/contacts`, which has
  no Node builtin and may stay there."

**Recommendation.** Do not schedule this as a move. Schedule it as a **one-time
classification**: for each module, does a non-plugin caller still exist? The
ones with none are the only real candidates, and they can be moved one at a
time with no user-visible effect at all — no element, no route, no document.
The ones with a core caller should get a one-line comment saying so, which
turns an apparent inconsistency into a documented boundary and stops the next
audit from re-deriving all of this.

**The argument against doing even that.** It is a large, low-value sweep whose
best outcome is a tidier import graph, and the classification is only valid
until the next feature adds a core caller. `email` and `marketing` are under
active development on live branches right now, so their column of that table
is a moving target.

---

### 3.4 — Site visitor accounts on the Users page · **confidence: medium**

**Half of a "core primitive" page belongs to a plugin.**

`apps/console/app/(app)/[orgSlug]/hosts/[host]/users/page.tsx` renders exactly
two cards:

- `SiteAccountsCard` — reads `hosts/{hostId}/siteMembers`
  (`site-accounts-card.component.tsx:102`). Its docblock: "the visitor accounts
  created through the **storefront sign-up** (AGL-109)". Rows open a drawer
  with "orders, subscriptions, the lifetime purchase total, and
  suspend/reactivate".
- `HostMembersCard` — console collaborators. A platform concern.

The writers for `siteMembers` are in the commerce plugin
(`libs/plugins/commerce/src/lib/server/membership-register.ts` and siblings),
and the gate for the `/signin`, `/signup`, `/recover` pages is the `accounts`
plugin id. So the reader is an app route, the writer is a plugin, and the
capability switch is a third id.

**Persisted data.** No document change of any kind — this is a console page
composition question. `siteMembers` stays where it is; the only thing that
would move is which lib the card file lives in.

**Split across more than two homes: yes — three**, and unusually, the split is
*within a single page*.

**Recommendation.** Low priority, but worth naming: `SiteAccountsCard` and
`SiteMemberDrawer` are commerce/accounts surfaces and could move into the
commerce plugin, contributed back to the Users page through a console widget
slot — the mechanism `inbox` already uses for its dashboard glance card.

**The argument against.** Users is on the "stayed in the app" list on purpose;
its own docblock cites the issue that gave it a section (AGL-350). A site owner
thinks of "the people who signed up on my site" as a property of the site, not
of the store, and splitting the page by which lib writes the document would be
organizing the console around our module graph rather than around the reader.
This one is genuinely arguable and I would not move it without the owner
saying the boundary bothers him.

---

### 3.5 — Site search · **confidence: low**

| piece | where it lives today |
| --- | --- |
| canvas element | `libs/plugins/mui/src/lib/components/search-box.tsx`, id `searchBox`, `category: FORMS`, mui bundle line 134 |
| second element | `Collection.CollectionSearch` in `libs/plugins/mui/src/lib/components/collection.tsx` |
| tenant page | `apps/tenant/app/[host]/search/page.tsx` + `search-results.component.tsx` |
| server logic | `apps/tenant/utils/search-content.ts` (309 lines) and `search-facets.ts` |
| console surface | **none** |
| storage | **none of its own** — it queries screens, collection entries and dataset records live, cached per query |

**Why it is on the list.** The element hardcodes a site route: `<form
action="/search" method="get">`. That is a feature contract, not a component
definition, and `search-box.tsx:37-39` is candid about it — "the console has no
`/search` route to submit to; navigation there is a no-op form post the editor
never triggers." An element whose behavior is "post to a page another app
serves" is doing more than presenting.

**Why it is ranked low.** It fails the inbox test in the other direction: there
is **no console surface at all**. Nothing about search is configurable, so
there is no console half for a plugin to own. And its server half reaches
across screens, collections *and* datasets — three capabilities — which makes
it a consumer of everything rather than an owner of anything.

**Persisted data.** No storage of its own, so nothing to migrate beyond §2b/§2c
for the element.

**Recommendation.** Leave it. Revisit only if search acquires configuration —
a per-site index, tunable facets, synonyms — at which point it gains a console
half and becomes the `commerce` shape overnight.

**The argument for moving it anyway:** the `/search` route in `apps/tenant` is
one of only three non-API page routes the tenant serves, and a plugin can
already own a site path (`registerSitePageResolver`, used by
`libs/plugins/commerce/src/lib/server.ts:232`). So the mechanism exists; only
the motivation is missing.

---

### 3.6 — Multilingual / `languageSwitcher` · **confidence: low**

| piece | where it lives today |
| --- | --- |
| canvas element | `libs/plugins/mui/src/lib/components/language-switcher.tsx`, id `languageSwitcher`, `category: NAVIGATION`, mui bundle line 118 |
| console surface | `apps/console/components/languages-card.component.tsx`, in Setup |
| storage | `host.languages` (a field on the host doc, `platform.types.ts:424`) and `screen.localeVariants` |
| contract | `Aglyn.ScreenLinkContext`, `screen-link-context.ts`, `screen-route.ts` — the routing map |
| entitlement | `multilingual`, Business tier |

**Why it is on the list.** It has both halves — a canvas element and a console
card — plus an entitlement, which is the shape of a paid feature.

**Why it is ranked low.** Its data is not a subcollection but two *fields on
the screen-routing model*, and the element resolves entirely out of
`ScreenLinkContext`. Screens are on the "stayed in the app" list. A translation
of a screen is a screen; a plugin that owned it would own a variant of a core
primitive.

**Persisted data.** Element move is §2a/§2b as usual. The model cannot move at
all: `host.languages` and `screen.localeVariants` are read by the tenant
routing map, and by §1's layering rule the tenant cannot import a plugin.

**Recommendation.** Leave it. Note only that if the element ever moves for
tidiness, the Business-tier gate is enforced by the entitlement and not by the
bundle, so a bundle move would add a second, redundant gate.

---

## 4. Deliberately ruled out

The ruled-out list is the more useful half of this document, because each of
these looks like a candidate until you check.

**Screens, Layouts, Components, Templates, Media, Content, Analytics.** The
site-building primitives, and the explicit remainder in `host-nav-tabs.ts`. Not
re-examined beyond confirming each still has a static tab and an app route.

**`custom-html`, `videoEmbed`, `socialLinks`, `markdown` / `tableOfContents`,
`pagination`, `image-list`, `nav-menu`, `drawer`, `tabs`, `accordion`,
`card`, `themeModeSwitcher`.** Generic authoring elements. No storage of their
own, no console surface, no server contract. `custom-html` carries a
sanitization policy rather than a feature.

**`Collection.*` elements in mui** (entries, entry body, related, share, entry
meta, categories, search). These render Content, which stayed in the app on
purpose. Their ids come from core constants (`COLLECTION_ENTRIES_COMPONENT_ID`
and siblings) and are matched by id in the tenant compose path
(`compose-screen-nodes.ts:96-125`), which is core code that could not import a
plugin holding them.

**The marketplace `plugin` element** (`libs/plugins/mui/src/lib/components/
plugin.tsx`, id `Aglyn.PLUGIN_COMPONENT_ID`). Looks misfiled next to a
`marketplace` plugin, but it is the sandbox *host* for third-party plugins.
Putting the thing that renders installed plugins behind the marketplace
switch would mean disabling the marketplace console silently blanks every
already-installed plugin on a published site. Always-on is correct.

**Consent banner, advertising tags, visitor consent.**
(`visitor-consent.ts`, `platform-visitor-consent.ts`, `advertising-tags.ts`,
`platform-advertising-tags.ts`, `consent-banner-ui.tsx`, `/api/consent/region`,
the Setup → Tracking section.) This is the brief's own caveat made concrete: a
cross-cutting contract the tenant runtime resolves at request time, on every
page, before anything else runs. It has a console page, and it is still core.

**SEO / `search-indexing.ts`.** Reads as site search from the filename; it is
not. It is the single answer to "may a crawler index this?", shared by four
render surfaces that must never disagree — server `generateMetadata`, its
client twin, `robots.txt`, `sitemap.xml`. A plugin cannot own a rule that four
core surfaces have to agree on.

**Notifications** (`notifications.ts`, `users/{uid}/notifications`). Every
plugin *writes* into it — `content.order`, `content.booking`,
`marketplace.review`, `support.ticketReply`. A taxonomy every plugin emits into
is core by construction.

**DMCA / abuse reports / repeat infringer / counter-notice.** Has storage
(`orgs/{orgId}/dmcaStrikes`), tenant intake routes (`/api/report-abuse`,
`/api/counter-notice`) and console pages — but the console pages are under
`apps/console/app/(app)/admin/`, the staff surface. Plugins here attach to a
host or org nav tab and are switchable per workspace. A platform-operator
surface is neither.

**Site backup / export / import.** Console surface in the host Admin section,
server in `apps/console/app/api/hosts/{export,import}`. It enumerates *every*
collection including each plugin's own; it is the thing that has to know about
all of them, so it cannot be one of them.

**Redirects, bookings, events-calendar, contacts, data, email, inbox, logic,
marketing, marketplace, workflows.** Already plugins. Their model residue is
§3.3, not a boundary question.

**`accounts`.** Declared in `FIRST_PARTY_PLUGINS` with no lib and no entry in
`plugins.config.json` — a capability id whose components and handlers ship
inside `commerce`. Looks like a gap; is a documented decision, with
`requires: ['commerce']` and the category-attribution mechanism of §2d built
around it. Worth knowing about; not worth changing.

---

## 5. What to do first

1. **Verify §2b against production data** before scheduling any element move,
   including forms. One query: are there saved nodes with
   `componentId: 'booking'` and `pluginId: 'mui'`? If yes, the two completed
   moves already carry the late-render cost and the fix belongs with them, not
   with the next move.
2. **§3.2, part one** — the `COMMERCE → commerce` category mapping. It is a
   one-line addition to an existing map, it pays none of §2's costs, and it
   closes a live picker/server mismatch.
3. **§3.1** — `functionWidget` into `logic`, with the docblock corrected. This
   is the audit's top recommendation.
4. **§3.2, part two** — decide whether `product` is retired or relocated, in
   that order.
5. **§3.3** — classify, comment, and only then move what has no core caller.
