# Read-cost audit — every oversized Firestore window, and which ones are defects

Status: **audit, with 29 of the 157 call sites fixed.** Written against `main`
at `6de53c796`. The classification covers every call site; the fixes cover the
ones where the window was also making the surface WRONG, not merely expensive.
§7 is what is left, ranked.

> ⛔ **No Linear issue was opened or referenced while writing this.** Where an
> `AGL-` id appears below it is quoted from an existing code comment as
> provenance for a file, never asserted as a description of an issue. This
> document records work; it does not file it.

## 1. Why a blanket edit would have been worse than the problem

The prompt for this audit was a `limit(200)` on a picker and a fair question:
how is reading two hundred documents an optimized read when the largest table
page in the console is ten? Taken literally that is 157 numbers to lower, and
lowering all of them mechanically would have broken more than it fixed — a
`limit` on an aggregate is not the same object as a `limit` on a list, and
shrinking the first makes a dashboard quietly lie about revenue.

So the axis this document sorts on is not the size of the number. It is **who
pays, how often, and what goes wrong when the window bites**:

- A **client listener opened on mount** costs its whole window on every page
  view, for every user, forever. This is the expensive shape.
- A **server batch with a cursor** is bounded work done once. Its window is a
  batch size, not a page size, and it is usually correct as written.
- An **aggregate** — revenue, a count, a low-stock scan — cannot be paged at
  all, because a sum over page one is not a sum. Its window has to be bounded
  by something meaningful (a date range) and its truncation has to be
  disclosed, because a figure that is short and says nothing cannot be told
  from one that is right.
- A **list** can be paged, and should be.

## 2. The defect that is worse than a large number

`limit(N)` with **no `orderBy`** is answered by Firestore in **document-id
order**. Every collection in this repo is keyed by a generated id, so an
unordered cap does not return "the first N" — it returns a pseudo-random N.

The rows past it are not merely unrendered. They are **unreachable**: nothing
shows them and no control asks for more. And a client-side `.sort()` over that
sample is what makes it invisible — the rows on screen run in a believable
order, they are simply the wrong rows, and the ones missing leave no gap to
notice.

That defect is independent of the window size. A `limit(50)` with no ordering
is more wrong than a `limit(500)` with ordering. **64 of the 75 client
listeners** in this audit carried no ordering; 129 of all 157 call sites did
not.

## 3. What already existed, and should be reached for first

This repo has already answered this question once, and the answer is
`libs/tenant/feature/instance/src/lib/hooks/host-collection-queries.ts`:

- `collectionPage(ref, pageLimit)` — `orderBy(documentId())` plus the limit, for
  a paged list.
- `collectionCeiling(ref, ceiling)` — the same ordering, asking for `ceiling + 1`.
- `ceilingedWindow(read, ceiling)` — `{ rows, truncated }`, dropping the probe.

Ordering on `documentId()` is the load-bearing decision. `orderBy` matches only
documents that **have** the field, so ordering on one any writer omits does not
mis-order a list, it **hides rows from it**. A document's name cannot be absent,
so the walk is total. `usePagedCollection` + `ListPagination` is the paged
idiom on top of it, and `TABLE_PAGE_SIZE_OPTIONS` is `[10, 25, 50]`.

Two seams let call sites escape the guard that already exists for this
(`apps/console/specs/table-footer-consistency.spec.ts`):

1. **The guard only inspects files that render a footer.** A card with no
   pagination control is never asked what its cap is a cap on — which is
   exactly the population this audit found.
2. **A footer and its query can live in different files.** The content entries
   list rendered a real footer in `collection-entries-page.component.tsx`,
   which contains no `limit(`, while the `limit(200)` sat in
   `content-scope.context.tsx`, which the same spec lists under `NOT_A_LIST`.
   Neither file was wrong on its own terms and the pair went unchecked. That
   read is fixed (§5) and the page-size assertion now names the provider that
   owns the window, but the seam itself is still open for the next pair.

## 4. Totals

| Shape | At audit | Unordered | After this pass | Unordered |
| --- | --- | --- | --- | --- |
| Client listener on mount | 75 | 64 | 49 | 38 |
| Server route handler | 30 | 20 | 30 | 20 |
| Server module / tenant runtime | 44 | 38 | 44 | 38 |
| Client file, read off the listener path | 8 | 7 | 8 | 8 |
| **Total** | **157** | **129** | **131** | **104** |

29 call sites across 13 files were changed. The client-listener count falls by
26 because several reads left the mount path entirely — a picker read behind
its editor is no longer a listener the page pays for.

Counted as non-comment `limit(<integer>)` occurrences above 50, outside specs
and e2e. The original count of 274 includes prose in doc comments describing
past shapes, and `limit(<named constant>)` call sites; the named-constant set is
listed in §8 and is mostly server-side batch sizing.

> **Method note for whoever runs this again.** This repo's `grep` is
> ugrep-backed and honors `.gitignore`. The regex word boundary `\b` **silently
> returns zero matches** — `git grep -nE '\blimit\([0-9]+\)'` reports nothing at
> all, which reads exactly like a clean repo. Use `git grep -nE 'limit\([0-9]+\)'`.

## 5. What was fixed

Each of these was a live listener whose window was making the surface report
something untrue, not just costing more than it needed to.

### The commerce money surfaces

Three cards computed money from `hosts/{hostId}/orders` capped with no
ordering, then sorted the sample newest-first in the browser. Any store past
the cap has been shown revenue, order count and average order value derived
from an arbitrary subset of its orders.

| Surface | Before | After |
| --- | --- | --- |
| `commerce-glance-card` orders | `limit(200)`, unordered | 30-day range on `createdAtMs`, ordered desc, ceiling 250 + probe, truncation disclosed |
| `commerce-glance-card` products | `limit(200)`, unordered | `collectionCeiling` 250 + probe, disclosed |
| `commerce-analytics-card` orders | `limit(500)`, unordered | 30-day range on `createdAtMs`, ordered desc, ceiling 500 + probe, truncation warned |
| `host-orders-card` orders | `limit(200)`, unordered | ordered on `createdAtMs` desc, 200 + probe, truncation disclosed |
| `host-orders-card` products | `limit(100)`, unordered | `collectionCeiling` 100 + probe |

The two dashboard cards are now bounded by **time** rather than by count, which
is what they always claimed to report. A store reads the orders it took in the
last thirty days instead of a fixed slab of all-time rows that may not overlap
the reported period at all — so the typical read is far smaller **and** the
figure is exact, where before it was neither.

`createdAtMs` rather than `createdAt` is load-bearing. It is the field every
order writer in the plugin stamps — cart, buy-now, draft, POS cash, POS card,
subscription cycle — and the one `reconcile-stock` already walks the collection
by. `createdAt` is not interchangeable: the orders collection group is indexed
on `createdAtMs` alone, and `apps/console/app/api/admin/revenue/route.ts`
documents that the other field hard-fails with `FAILED_PRECONDITION` in
production. A range on a field a document lacks drops that document rather than
mis-placing it. **No new index is required** — range and order share a field,
and the `orders.createdAtMs` field override is already declared.

`host-orders-card` is deliberately **not** paged. Five filters and Export CSV
all run over what was read, so paging would narrow every one of them to the
current page while leaving them looking collection-wide. It is bounded and
disclosed instead.

Its date filter also now reads `createdAtMs`. Reading `createdAt` there made a
row missing that field register as epoch zero, which both the 7- and 30-day
options excluded outright.

### The product editor, which the catalog page paid for

`ProductEditorDialog` is rendered unconditionally by the products hub and told
whether it is open through a prop, so its body ran on every render of the
catalog page. Three picker listeners subscribed there whether or not anyone
opened the editor.

| Read | Before | After |
| --- | --- | --- |
| `productCategories` | `limit(250)`, unordered, on mount | `collectionCeiling` 250 + probe, **only while open** |
| `products` | `limit(300)`, unordered, on mount | `collectionCeiling` 300 + probe, **only while open** |
| `suppliers` | `limit(50)`, unordered, on mount | `collectionCeiling` 50 + probe, **only while open** |

Six hundred documents on every visit to the catalog, none of which reached the
screen, now nothing until the editor is opened. `useFirestoreCollection`
already takes `null` to mean "do not subscribe", so the gate needed no new
mechanism.

A rendering assertion cannot see this — a closed dialog draws nothing either
way — so the spec meters the Firestore boundary and records each subscription
as path, ceiling and ordering.

### The recovery queue, whose counts are the point of the card

`recovery-queue-card` counted both queue depths from a `limit(200)` with no
ordering, so each chip was a count over a pseudo-random slice.

| Read | Before | After |
| --- | --- | --- |
| `checkouts` | `limit(200)`, unordered | `collectionCeiling` 200 + probe, disclosed |
| `restockAlerts` | `limit(200)`, unordered | `collectionCeiling` 200 + probe, disclosed |

An undercount is the specific failure this card exists to catch. It is the
place a merchant notices a background job has stopped, because a queue that is
always empty and a queue that is never drained look identical from outside —
and a chip reporting a shorter queue than `scanAbandonedCheckouts` will find
reads as the job keeping up.

Neither read can be paged, since a tally over page one is not a tally.

### The content entries list, and the entry it could not open

`content-scope.context.tsx` capped the entries collection at 200 with no
ordering, and `collection-entries-page.component.tsx` paged that array in the
browser — the "big read sliced small" shape, where the rows past the read are
billed on every mount and reachable by nothing.

| Read | Before | After |
| --- | --- | --- |
| `collections/{id}/entries` | `limit(200)`, unordered, client-paged | `usePagedCollection` + `collectionPage`, `TABLE_PAGE_SIZE_DEFAULT` + probe, widening one page per Next |
| the open entry | resolved by scanning that array | keyed read of its own document |
| the slug collision check | scanned that array | keyed `where('slug','==',…)`, probing one past the entry being edited |

Two defects beyond the cost:

- **A pasted link to an entry outside the window opened on nothing.** The
  editor resolved the open entry with `entries.find(...)`, so an existing,
  published entry reported itself as absent from its own collection. Worth
  recording precisely: the blank-buffer *overwrite* was checked and is **not**
  reachable — the seeding effect returns early when the entry is missing, so
  no Save control renders. The harm was an uneditable entry, not a destructive
  write.
- **The slug check could admit a duplicate.** It scanned the same truncated
  array, so an author could save an address already held by an off-window
  entry — and the tenant resolves a slug by taking the first match, which
  makes one of the two permanently unreachable. Over a page of ten that would
  have gone from rare to routine, which is why the keyed query was part of the
  same change rather than deferred.

Ordering on `createdAt` was not available here either: `IMPORTABLE_FIELDS`
carries no `createdAt` for entries and `cleanDoc` stamps `updatedAt` only, so
it would have hidden every imported entry rather than mis-sorting it.

Two figures deliberately now read one page rather than up to 200, and say so:
the collection-delete denial's entry count and the Authors tab's
"entries using this byline" hint. The delete **gate** is unaffected — a
non-empty collection always has rows on page 0 — and the route counts for
real.

### The workflows, logic and marketplace consoles

Twenty-six listeners across three plugin consoles capped a collection with no
ordering. All now ask through the shared builders, and the picker reads move
behind the editor that uses them.

| Surface | Mount cost before | After |
| --- | --- | --- |
| `host-actions-card` | 370 documents across six pickers | **0** — all six gated on the editor, ordered at 101 |
| `host-workflows-card` | 200 across two pickers | **0** — gated, ordered at 101 |
| `host-webhooks-card` | 120 | **21** — webhooks ordered at a ceiling of 20, picker gated |
| `host-variables-card` | 100 | **0** — gated, ordered at 101 |
| `host-reference-health-card` | 13 unordered windows of 100 | 13 ordered windows of 101, truncation disclosed |
| `marketplace-browse` | five unordered windows | ordered at 101, install state stated as a floor |
| `listing-content` | four unordered windows | ordered and probed, disclosed above Buy |

Two details worth keeping:

- **The gated reads latch on first open rather than tracking the dialog.**
  Keying them on the open dialog tears the listeners down on Cancel and buys
  the same windows again on the next Edit, so an operator working through ten
  records would pay ten times — worse than reading once on mount. There is an
  assertion for this.
- **`host-reference-health-card` computes a verdict from its windows**, so a
  ceiling that bites reports live wiring as broken. Its success line changed
  from "Every automation, workflow, and variable reference resolves" to "Every
  reference the audit read resolves", which is the claim the read can support.

Two `limit(20)` reads in `listing-content` were found in passing and fixed: the
page takes the *first* live row from each, and document-id order made "the
first" arbitrary. They are below this audit's threshold of 50 and are the
clearest evidence that the window size was never the right filter.

## 6. Ruled out, with reasons

These are large windows that are **not** defects. Listed rather than skipped: an
exemption nobody wrote down is indistinguishable from one nobody noticed.

- **Cursored server batch jobs.** `libs/plugins/commerce/src/lib/server/`
  sweeps, `process-abandoned.ts`, `process-restock.ts` and the backfill scripts
  page with a cursor and run once on a schedule. Their window is a batch size,
  and lowering it makes the job slower without making it cheaper — the same
  documents are read either way.
- **The tenant render path, because it is cached.** `get-components.ts` (200),
  `get-variables.ts` (100) and `template-screens.ts` (200/100) look like the
  highest-frequency reads in the system — they run on public site requests —
  but each is wrapped in the render cache behind `PUBLISHED_SITE_DATA_TTL_SECONDS`
  and busted by the console's revalidate route. The cost is amortized across
  every visitor between publishes, not paid per view. They are correct as
  written. `run-event-workflows.ts` and `run-event-actions.ts` are **not**
  cached, but they run per tenant event rather than per page view and read a
  per-site taxonomy; see §7 for the ordering caveat that still applies.
- **One-shot admin and staff tooling.** `apps/console/app/api/admin/*` routes
  are staff-only, run on demand, and several already order. A larger window
  there is a person waiting a moment longer, not a per-user recurring bill.
- **Fixed taxonomies.** `pos-page` locations and registers (25 each) are bounded
  by a plan cap enforced elsewhere; the window is above the ceiling the product
  allows, so it cannot bite.
- **`host-coupons-card`.** Already documented in the footer spec's
  `UNORDERED_BY_DESIGN`: a coupon's document id **is** its code, so document-id
  order is the alphabetical order the list wants.

## 7. What remains

Ranked, and accurate as of this pass. Nothing here is fixed.

1. **104 call sites still cap a query they have not ordered.** This is the
   arbitrary-sample defect and it is independent of the window; the §8 tables
   mark every one. The most consequential are not the biggest:
   `run-event-workflows.ts` and `run-event-actions.ts` pick which workflows and
   actions fire from an unordered `limit(100)`, so a site past a hundred fires
   a pseudo-random subset of them. Those two are also the only tenant-runtime
   reads with no render cache in front.
2. **The shared `hosts/{hostId}/screens` read**, `limit(200)` and unordered,
   duplicated across six editor pages plus `auth-screens-card`,
   `error-screens-card`, `content-scope` and `interaction-builder-dialog`. It
   is a routing map rather than a list, so the fix is one shared hook with a
   disclosed ceiling rather than paging — `use-host-component-definitions.ts`
   is the precedent, and it carries the same defect at 200. Left alone here
   because the besigner picker surfaces were being edited concurrently.
3. **`media-library.component.tsx`** reads `mediaFolders` at `limit(500)`
   unordered — the largest remaining client window. Note for whoever takes it:
   `createdAt` is **not** safe to order on. The site-import path writes folder
   documents through an allow-list that omits it, so imported folders would
   vanish from the rail. Order on `documentId()`.
4. **`besigner-versions.component.tsx`** holds three `limit(1000)` reads and
   **`contacts-console-page.tsx`** two more — the largest windows in the repo,
   though both sit off the listener path.
5. **The commerce aggregates still have a ceiling.** Time-bounding fixed the
   common case and disclosure made the uncommon case honest, but a store above
   the ceiling still reads a truncated figure. The durable fix is a server-side
   rollup or a Firestore aggregation query; the client-side filters (test-mode,
   refunds, status) are what currently prevent expressing it as one `sum()`.
6. **The guard seam is still open.** `table-footer-consistency` only inspects
   files that render a footer, so a card with no pagination control is never
   asked what its cap is a cap on — which is how this whole population
   accumulated. A guard that asked the question of every file building a
   Firestore query would have caught all 157.

## 8. The full classification

Every call site above 50, by shape. "Ordering" is whether the enclosing query
names one; **none** is the arbitrary-sample defect described in §2.

### Client listeners on mount, window 200 or more

| Call site | Window | Ordering | Disposition |
| --- | --- | --- | --- |
| `apps/console/components/media/media-library.component.tsx`:830 | 500 | **none** | unordered |
| `libs/plugins/commerce/src/lib/components/console/commerce-analytics-card.component.tsx`:67 | 500 | **none** | **Fixed** — ordered + ceiling probe, warned; bounded to the 30 days reported |
| `libs/plugins/commerce/src/lib/components/console/pos-page.component.tsx`:133 | 500 | ordered |  |
| `libs/plugins/commerce/src/lib/components/console/stock-movements-card.component.tsx`:131 | 500 | ordered |  |
| `apps/console/components/entity-picker-provider.component.tsx`:130 | 300 | **none** | unordered |
| `libs/plugins/commerce/src/lib/components/console/product-editor-dialog.component.tsx`:138 | 300 | **none** | **Fixed** — gated on `open` + ordered ceiling probe |
| `libs/plugins/commerce/src/lib/components/console/product-editor-dialog.component.tsx`:132 | 250 | **none** | **Fixed** — gated on `open` + ordered ceiling probe |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/components/[componentId]/versions/[versionId]/besigner/page.tsx`:201 | 200 | **none** | unordered |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/forms/[formId]/versions/[versionId]/besigner/page.tsx`:220 | 200 | **none** | unordered |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/layouts/[layoutId]/versions/[versionId]/besigner/page.tsx`:168 | 200 | **none** | unordered |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx`:646 | 200 | **none** | unordered |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx`:267 | 200 | **none** | unordered |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/templates/[templateId]/besigner/page.tsx`:134 | 200 | **none** | unordered |
| `apps/console/components/auth-screens-card.component.tsx`:80 | 200 | **none** | unordered |
| `apps/console/components/content/content-scope.context.tsx`:276 | 200 | **none** | **Fixed** — entries paged at 10 + probe; open entry and slug check now keyed reads |
| `apps/console/components/content/content-scope.context.tsx`:503 | 200 | **none** | **Fixed** — entries paged at 10 + probe; open entry and slug check now keyed reads |
| `apps/console/components/entity-picker-provider.component.tsx`:142 | 200 | **none** | unordered |
| `apps/console/components/entity-picker-provider.component.tsx`:154 | 200 | **none** | unordered |
| `apps/console/components/entity-picker-provider.component.tsx`:192 | 200 | ordered |  |
| `apps/console/components/error-screens-card.component.tsx`:142 | 200 | **none** | unordered |
| `apps/console/components/interaction-builder-dialog.component.tsx`:371 | 200 | **none** | unordered |
| `apps/console/components/org-licences-panel.component.tsx`:169 | 200 | ordered |  |
| `apps/console/hooks/use-host-component-definitions.ts`:70 | 200 | **none** | unordered |
| `libs/plugins/commerce/src/lib/components/console/commerce-glance-card.component.tsx`:61 | 200 | **none** | **Fixed** — ordered + ceiling probe, disclosed; orders bounded to the 30 days reported |
| `libs/plugins/commerce/src/lib/components/console/commerce-glance-card.component.tsx`:67 | 200 | **none** | **Fixed** — ordered + ceiling probe, disclosed; orders bounded to the 30 days reported |
| `libs/plugins/commerce/src/lib/components/console/host-orders-card.component.tsx`:69 | 200 | **none** | **Fixed** — ordered on `createdAtMs` desc + probe, disclosed |
| `libs/plugins/commerce/src/lib/components/console/member-posts-card.component.tsx`:107 | 200 | ordered |  |
| `libs/plugins/commerce/src/lib/components/console/recovery-queue-card.component.tsx`:96 | 200 | **none** | **Fixed** — ordered ceiling + probe, disclosed |
| `libs/plugins/commerce/src/lib/components/console/recovery-queue-card.component.tsx`:102 | 200 | **none** | **Fixed** — ordered ceiling + probe, disclosed |
| `libs/plugins/data/src/lib/components/dataset-schema-dialog.component.tsx`:184 | 200 | **none** | unordered |
| `libs/plugins/email/src/lib/components/campaign-composer.tsx`:298 | 200 | **none** | unordered |
| `libs/plugins/marketplace/src/lib/components/listing-content.component.tsx`:566 | 200 | **none** | **Fixed** — ordered ceiling + probe, disclosed above Buy |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:301 | 200 | **none** | **Fixed** — ordered ceiling + probe; install-state chips stated as a floor |

### Client listeners on mount, window 51-199

| Call site | Window | Ordering | Disposition |
| --- | --- | --- | --- |
| `apps/console/app/(app)/[orgSlug]/hosts/[host]/components/[componentId]/page.tsx`:118 | 100 | **none** | unordered |
| `apps/console/app/(app)/[orgSlug]/hosts/[host]/forms/[formId]/page.tsx`:141 | 100 | **none** | unordered |
| `apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/[layoutId]/page.tsx`:117 | 100 | **none** | unordered |
| `apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/[layoutId]/page.tsx`:129 | 100 | **none** | unordered |
| `apps/console/app/(app)/[orgSlug]/hosts/[host]/templates/[templateId]/page.tsx`:132 | 100 | **none** | unordered |
| `apps/console/app/(app)/[orgSlug]/plugins/page.tsx`:81 | 100 | **none** | unordered |
| `apps/console/app/(app)/admin/orgs/[orgId]/page.tsx`:260 | 100 | **none** | unordered |
| `apps/console/components/besigner-versions.component.tsx`:217 | 100 | **none** | unordered |
| `apps/console/components/binding-picker-provider.component.tsx`:47 | 100 | **none** | unordered |
| `apps/console/components/binding-picker-provider.component.tsx`:52 | 100 | **none** | unordered |
| `apps/console/components/interaction-builder-dialog.component.tsx`:360 | 100 | **none** | unordered |
| `apps/console/components/interactions-provider.component.tsx`:95 | 100 | **none** | unordered |
| `apps/console/components/notifications-menu.component.tsx`:135 | 100 | ordered |  |
| `apps/console/components/org-publish-panel.component.tsx`:156 | 100 | **none** | unordered |
| `apps/console/components/org-publish-panel.component.tsx`:165 | 100 | **none** | unordered |
| `apps/console/components/org-publish-panel.component.tsx`:175 | 100 | **none** | unordered |
| `apps/console/components/org-publish-panel.component.tsx`:185 | 100 | **none** | unordered |
| `apps/console/components/org-publish-panel.component.tsx`:203 | 100 | **none** | unordered |
| `apps/console/components/site-member-drawer.component.tsx`:205 | 100 | ordered |  |
| `apps/console/hooks/use-site-marketplace-plugins.ts`:69 | 100 | **none** | unordered |
| `apps/console/hooks/use-site-marketplace-plugins.ts`:77 | 100 | **none** | unordered |
| `libs/plugins/bookings/src/lib/components/bookings-console-page.tsx`:123 | 100 | **none** | unordered |
| `libs/plugins/bookings/src/lib/components/bookings-console-page.tsx`:132 | 100 | ordered |  |
| `libs/plugins/commerce/src/lib/components/console/host-orders-card.component.tsx`:74 | 100 | **none** | **Fixed** — ordered on `createdAtMs` desc + probe, disclosed |
| `libs/plugins/commerce/src/lib/components/console/pos-page.component.tsx`:176 | 100 | **none** | unordered |
| `libs/plugins/data/src/lib/components/host-datasets-card.component.tsx`:214 | 100 | **none** | unordered |
| `libs/plugins/logic/src/lib/components/host-reference-health-card.component.tsx`:54 | 100 | **none** | **Fixed** — thirteen listeners ordered + probed; verdict now says what it read |
| `libs/plugins/logic/src/lib/components/host-reference-health-card.component.tsx`:91 | 100 | **none** | **Fixed** — thirteen listeners ordered + probed; verdict now says what it read |
| `libs/plugins/logic/src/lib/components/host-reference-health-card.component.tsx`:102 | 100 | **none** | **Fixed** — thirteen listeners ordered + probed; verdict now says what it read |
| `libs/plugins/logic/src/lib/components/host-variables-card.component.tsx`:246 | 100 | **none** | **Fixed** — picker gated on the editor + ordered |
| `libs/plugins/marketing/src/lib/components/host-experiments-card.component.tsx`:158 | 100 | ordered |  |
| `libs/plugins/marketplace/src/lib/components/listing-content.component.tsx`:552 | 100 | **none** | **Fixed** — ordered ceiling + probe, disclosed above Buy |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:239 | 100 | ordered | **Fixed** — ordered ceiling + probe; install-state chips stated as a floor |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:260 | 100 | **none** | **Fixed** — ordered ceiling + probe; install-state chips stated as a floor |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:270 | 100 | **none** | **Fixed** — ordered ceiling + probe; install-state chips stated as a floor |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:315 | 100 | **none** | **Fixed** — ordered ceiling + probe; install-state chips stated as a floor |
| `libs/plugins/workflows/src/lib/components/host-actions-card.component.tsx`:280 | 100 | **none** | **Fixed** — six picker reads gated on the editor + ordered; mount 370 docs to 0 |
| `libs/plugins/workflows/src/lib/components/host-actions-card.component.tsx`:304 | 100 | **none** | **Fixed** — six picker reads gated on the editor + ordered; mount 370 docs to 0 |
| `libs/plugins/workflows/src/lib/components/host-webhooks-card.component.tsx`:92 | 100 | **none** | **Fixed** — ordered ceiling 20 + probe; picker gated; mount 120 to 21 |
| `libs/plugins/workflows/src/lib/components/host-workflows-card.component.tsx`:157 | 100 | **none** | **Fixed** — picker reads gated on the editor + ordered; mount 200 docs to 0 |
| `libs/plugins/workflows/src/lib/components/host-workflows-card.component.tsx`:163 | 100 | **none** | **Fixed** — picker reads gated on the editor + ordered; mount 200 docs to 0 |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:232 | 90 | ordered | **Fixed** — ordered ceiling + probe; install-state chips stated as a floor |

### Server route handlers

| Call site | Window | Ordering | Disposition |
| --- | --- | --- | --- |
| `apps/console/app/api/billing/report-usage/route.ts`:578 | 1000 | **none** | unordered |
| `apps/console/app/api/billing/usage-email/route.ts`:122 | 1000 | **none** | unordered |
| `apps/console/app/api/hosts/export/route.ts`:271 | 1000 | **none** | unordered |
| `apps/tenant/app/api/sitemap/route.ts`:196 | 1000 | **none** | unordered |
| `apps/console/app/api/admin/overview/route.ts`:82 | 500 | ordered |  |
| `apps/console/app/api/admin/overview/route.ts`:85 | 500 | ordered |  |
| `apps/console/app/api/media/folders/route.ts`:166 | 500 | **none** | unordered |
| `apps/console/app/api/media/folders/route.ts`:203 | 500 | **none** | unordered |
| `apps/tenant/app/api/sitemap/route.ts`:264 | 500 | **none** | unordered |
| `apps/tenant/app/api/sitemap/route.ts`:272 | 250 | **none** | unordered |
| `apps/console/app/api/hosts/where-used/route.ts`:265 | 201 | **none** | unordered |
| `apps/console/app/api/admin/lockdown/route.ts`:612 | 200 | **none** | unordered |
| `apps/console/app/api/admin/marketplace-reports/route.ts`:120 | 200 | ordered |  |
| `apps/console/app/api/admin/marketplace-reports/route.ts`:124 | 200 | ordered |  |
| `apps/console/app/api/admin/org-detail/route.ts`:154 | 200 | ordered |  |
| `apps/console/app/api/billing/collaborator-allocations/route.ts`:142 | 200 | **none** | unordered |
| `apps/console/app/api/billing/register-allocations/route.ts`:107 | 200 | **none** | unordered |
| `apps/console/app/api/hosts/export/route.ts`:187 | 200 | **none** | unordered |
| `apps/console/app/api/hosts/where-used/route.ts`:153 | 200 | **none** | unordered |
| `apps/console/app/api/support/forum/route.ts`:119 | 200 | ordered |  |
| `apps/console/app/api/support/tickets/route.ts`:147 | 200 | ordered |  |
| `apps/tenant/app/api/sitemap/route.ts`:315 | 200 | **none** | unordered |
| `apps/console/app/api/admin/plugin-reviews/route.ts`:547 | 100 | **none** | unordered |
| `apps/console/app/api/hosts/where-used/route.ts`:193 | 100 | **none** | unordered |
| `apps/console/app/api/hosts/where-used/route.ts`:318 | 100 | **none** | unordered |
| `apps/console/app/api/orgs/invites/route.ts`:360 | 100 | **none** | unordered |
| `apps/console/app/api/support/forum/route.ts`:143 | 100 | ordered |  |
| `apps/console/app/api/support/forum/route.ts`:144 | 100 | ordered |  |
| `apps/console/app/api/support/tickets/route.ts`:172 | 100 | ordered |  |
| `apps/console/app/api/support/tickets/route.ts`:173 | 100 | ordered |  |

### Server modules and tenant runtime

| Call site | Window | Ordering | Disposition |
| --- | --- | --- | --- |
| `libs/plugins/bookings/src/lib/server.ts`:210 | 500 | **none** | unordered |
| `libs/plugins/bookings/src/lib/server.ts`:474 | 500 | **none** | unordered |
| `libs/plugins/bookings/src/lib/server.ts`:786 | 500 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/catalog.ts`:195 | 500 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/catalog.ts`:196 | 500 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/feed.ts`:45 | 500 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/member-post.ts`:98 | 500 | ordered |  |
| `libs/plugins/commerce/src/lib/server/refund.ts`:74 | 500 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/reservation-availability.ts`:73 | 500 | ordered |  |
| `libs/plugins/commerce/src/lib/server/reserve.ts`:145 | 500 | ordered |  |
| `libs/tenant/data/admin/src/lib/server/email-delivery-log.ts`:1395 | 400 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/related.ts`:69 | 300 | **none** | unordered |
| `apps/console/app/(app)/manage/notifications/page.tsx`:260 | 200 | ordered |  |
| `apps/console/components/document-preview.component.tsx`:320 | 200 | **none** | unordered |
| `apps/tenant/utils/search-content.ts`:268 | 200 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/catalog.ts`:200 | 200 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/catalog.ts`:201 | 200 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/process-abandoned.ts`:80 | 200 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/process-restock.ts`:66 | 200 | **none** | unordered |
| `libs/plugins/marketing/src/lib/server/campaign-send.ts`:2527 | 200 | ordered |  |
| `libs/tenant/runtime/src/lib/get-components.ts`:51 | 200 | **none** | unordered |
| `libs/tenant/runtime/src/lib/template-screens.ts`:295 | 200 | **none** | unordered |
| `apps/tenant/utils/search-content.ts`:177 | 100 | **none** | unordered |
| `libs/plugins/bookings/src/lib/server.ts`:66 | 100 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/cart-checkout.ts`:356 | 100 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/checkout.ts`:315 | 100 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/draft-order.ts`:252 | 100 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/pos-order.ts`:356 | 100 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/related.ts`:50 | 100 | **none** | unordered |
| `libs/plugins/commerce/src/lib/server/reviews.ts`:65 | 100 | **none** | unordered |
| `libs/plugins/redirects/src/lib/server/resolve-redirect.ts`:59 | 100 | **none** | unordered |
| `libs/plugins/workflows/src/lib/server.ts`:205 | 100 | **none** | unordered |
| `libs/plugins/workflows/src/lib/server.ts`:206 | 100 | **none** | unordered |
| `libs/plugins/workflows/src/lib/server.ts`:207 | 100 | **none** | unordered |
| `libs/tenant/runtime/src/lib/get-variables.ts`:78 | 100 | **none** | unordered |
| `libs/tenant/runtime/src/lib/get-variables.ts`:115 | 100 | **none** | unordered |
| `libs/tenant/runtime/src/lib/get-variables.ts`:167 | 100 | **none** | unordered |
| `libs/tenant/runtime/src/lib/run-event-actions.ts`:119 | 100 | **none** | unordered |
| `libs/tenant/runtime/src/lib/run-event-actions.ts`:120 | 100 | **none** | unordered |
| `libs/tenant/runtime/src/lib/run-event-actions.ts`:121 | 100 | **none** | unordered |
| `libs/tenant/runtime/src/lib/run-event-workflows.ts`:62 | 100 | **none** | unordered |
| `libs/tenant/runtime/src/lib/run-event-workflows.ts`:95 | 100 | **none** | unordered |
| `libs/tenant/runtime/src/lib/run-event-workflows.ts`:96 | 100 | **none** | unordered |
| `libs/tenant/runtime/src/lib/template-screens.ts`:307 | 100 | **none** | unordered |

### Client files, read off the listener path

| Call site | Window | Ordering | Disposition |
| --- | --- | --- | --- |
| `apps/console/components/besigner-versions.component.tsx`:277 | 1000 | **none** | unordered |
| `apps/console/components/besigner-versions.component.tsx`:297 | 1000 | **none** | unordered |
| `apps/console/components/besigner-versions.component.tsx`:305 | 1000 | **none** | unordered |
| `libs/plugins/contacts/src/lib/components/contacts-console-page.tsx`:209 | 1000 | ordered |  |
| `libs/plugins/contacts/src/lib/components/contacts-console-page.tsx`:663 | 1000 | **none** | unordered |
| `libs/plugins/data/src/lib/components/host-datasets-card.component.tsx`:676 | 200 | **none** | unordered |
| `apps/console/app/(app)/[orgSlug]/plugins/page.tsx`:116 | 100 | **none** | unordered |
| `libs/plugins/workflows/src/lib/components/host-workflows-card.component.tsx`:543 | 100 | **none** | **Fixed** — picker reads gated on the editor + ordered; mount 200 docs to 0 |
