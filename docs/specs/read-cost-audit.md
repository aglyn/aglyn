# Read-cost audit — every oversized Firestore window, and which ones are defects

Status: **audit, with the first tranche of fixes landed.** Written against `main`
at `6de53c796`. The classification covers every call site; the fixes cover the
ones where the window was also making the surface WRONG, not merely expensive.

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
   list renders a real footer in `collection-entries-page.component.tsx`, which
   contains no `limit(`; the `limit(200)` is in `content-scope.context.tsx`,
   which the same spec lists under `NOT_A_LIST`. Neither file was wrong on its
   own terms and the pair went unchecked.

## 4. Totals

| Shape | Count | Of which unordered |
| --- | --- | --- |
| Client listener on mount | 75 | 64 |
| Server route handler | 30 | 20 |
| Server module / tenant runtime | 44 | 38 |
| Client file, read off the listener path | 8 | 7 |
| **Total** | **157** | **129** |

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

Ranked. Nothing here is fixed.

1. **`limit()` with no `orderBy`, everywhere it survives.** 129 call sites at
   audit time. This is the arbitrary-sample defect and it is independent of the
   window; the §8 tables mark every one. The server-side ones matter less than
   the client ones only because they are usually feeding a job that consumes
   the whole result, but `run-event-workflows.ts` and `run-event-actions.ts`
   pick which workflows fire from an unordered `limit(100)` — a site past a
   hundred workflows fires a pseudo-random subset of them.
2. **The commerce aggregates still have a ceiling.** Time-bounding fixed the
   common case and disclosure made the uncommon case honest, but a store above
   the ceiling still reads a truncated figure. The durable fix is a server-side
   rollup or a Firestore aggregation query, not a client listener — the client
   filters (test-mode, refunds, status) are what currently prevent expressing
   it as one `sum()`.
3. **`besigner-versions.component.tsx`** holds three `limit(1000)` reads, the
   largest client windows in the repo.
4. **`contacts-console-page.tsx`** holds two `limit(1000)` reads.
5. **The shared `hosts/{hostId}/screens` read**, `limit(200)` and unordered, is
   duplicated across six editor pages plus `auth-screens-card`,
   `error-screens-card`, `content-scope` and `interaction-builder-dialog`. It
   is a routing map rather than a list, so the fix is one shared hook with a
   disclosed ceiling rather than paging. Left alone here because the besigner
   picker surfaces were being edited concurrently.
6. **`media-library.component.tsx`** reads `mediaFolders` at `limit(500)`
   unordered. Note for whoever takes it: `createdAt` is **not** safe to order on
   there — the site-import path (`apps/console/app/api/_lib/site-export.ts`
   allow-list, written through `hosts/import`) writes folder documents without
   it, so imported folders would vanish from the rail. Order on `documentId()`.

## 8. The full classification

Every call site above 50, by shape. "Ordering" is whether the enclosing query
names one; **none** is the arbitrary-sample defect described in §2.

### Client listeners on mount, window 200 or more

| Call site | Window | Ordering | Disposition |
| --- | --- | --- | --- |
| `apps/console/components/media/media-library.component.tsx`:830 | 500 | **none** |  |
| `libs/plugins/commerce/src/lib/components/console/commerce-analytics-card.component.tsx`:67 | 500 | **none** | **Fixed** — 30-day range on `createdAtMs`, ordered, ceiling 500 + probe, warned |
| `libs/plugins/commerce/src/lib/components/console/pos-page.component.tsx`:133 | 500 | ordered |  |
| `libs/plugins/commerce/src/lib/components/console/stock-movements-card.component.tsx`:131 | 500 | ordered |  |
| `apps/console/components/entity-picker-provider.component.tsx`:130 | 300 | **none** |  |
| `libs/plugins/commerce/src/lib/components/console/product-editor-dialog.component.tsx`:138 | 300 | **none** |  |
| `libs/plugins/commerce/src/lib/components/console/product-editor-dialog.component.tsx`:132 | 250 | **none** |  |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/components/[componentId]/versions/[versionId]/besigner/page.tsx`:201 | 200 | **none** |  |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/forms/[formId]/versions/[versionId]/besigner/page.tsx`:220 | 200 | **none** |  |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/layouts/[layoutId]/versions/[versionId]/besigner/page.tsx`:168 | 200 | **none** |  |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx`:646 | 200 | **none** |  |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx`:267 | 200 | **none** |  |
| `apps/console/app/(editor)/[orgSlug]/hosts/[host]/templates/[templateId]/besigner/page.tsx`:134 | 200 | **none** |  |
| `apps/console/components/auth-screens-card.component.tsx`:80 | 200 | **none** |  |
| `apps/console/components/content/content-scope.context.tsx`:276 | 200 | **none** |  |
| `apps/console/components/content/content-scope.context.tsx`:503 | 200 | **none** |  |
| `apps/console/components/entity-picker-provider.component.tsx`:142 | 200 | **none** |  |
| `apps/console/components/entity-picker-provider.component.tsx`:154 | 200 | **none** |  |
| `apps/console/components/entity-picker-provider.component.tsx`:192 | 200 | ordered |  |
| `apps/console/components/error-screens-card.component.tsx`:142 | 200 | **none** |  |
| `apps/console/components/interaction-builder-dialog.component.tsx`:371 | 200 | **none** |  |
| `apps/console/components/org-licences-panel.component.tsx`:169 | 200 | ordered |  |
| `apps/console/hooks/use-host-component-definitions.ts`:70 | 200 | **none** |  |
| `libs/plugins/commerce/src/lib/components/console/commerce-glance-card.component.tsx`:61 | 200 | **none** | **Fixed** — 30-day range on `createdAtMs`, ordered, ceiling 250 + probe, disclosed |
| `libs/plugins/commerce/src/lib/components/console/commerce-glance-card.component.tsx`:67 | 200 | **none** | **Fixed** — `collectionCeiling` 250 + probe, disclosed |
| `libs/plugins/commerce/src/lib/components/console/host-orders-card.component.tsx`:69 | 200 | **none** | **Fixed** — ordered on `createdAtMs` desc, 200 + probe, disclosed |
| `libs/plugins/commerce/src/lib/components/console/member-posts-card.component.tsx`:107 | 200 | ordered |  |
| `libs/plugins/commerce/src/lib/components/console/recovery-queue-card.component.tsx`:96 | 200 | **none** |  |
| `libs/plugins/commerce/src/lib/components/console/recovery-queue-card.component.tsx`:102 | 200 | **none** |  |
| `libs/plugins/data/src/lib/components/dataset-schema-dialog.component.tsx`:184 | 200 | **none** |  |
| `libs/plugins/email/src/lib/components/campaign-composer.tsx`:298 | 200 | **none** |  |
| `libs/plugins/marketplace/src/lib/components/listing-content.component.tsx`:566 | 200 | **none** |  |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:301 | 200 | **none** |  |

### Client listeners on mount, window 51-199

| Call site | Window | Ordering | Disposition |
| --- | --- | --- | --- |
| `apps/console/app/(app)/[orgSlug]/hosts/[host]/components/[componentId]/page.tsx`:118 | 100 | **none** |  |
| `apps/console/app/(app)/[orgSlug]/hosts/[host]/forms/[formId]/page.tsx`:141 | 100 | **none** |  |
| `apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/[layoutId]/page.tsx`:117 | 100 | **none** |  |
| `apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/[layoutId]/page.tsx`:129 | 100 | **none** |  |
| `apps/console/app/(app)/[orgSlug]/hosts/[host]/templates/[templateId]/page.tsx`:132 | 100 | **none** |  |
| `apps/console/app/(app)/[orgSlug]/plugins/page.tsx`:81 | 100 | **none** |  |
| `apps/console/app/(app)/admin/orgs/[orgId]/page.tsx`:260 | 100 | **none** |  |
| `apps/console/components/besigner-versions.component.tsx`:217 | 100 | **none** |  |
| `apps/console/components/binding-picker-provider.component.tsx`:47 | 100 | **none** |  |
| `apps/console/components/binding-picker-provider.component.tsx`:52 | 100 | **none** |  |
| `apps/console/components/interaction-builder-dialog.component.tsx`:360 | 100 | **none** |  |
| `apps/console/components/interactions-provider.component.tsx`:95 | 100 | **none** |  |
| `apps/console/components/notifications-menu.component.tsx`:135 | 100 | ordered |  |
| `apps/console/components/org-publish-panel.component.tsx`:156 | 100 | **none** |  |
| `apps/console/components/org-publish-panel.component.tsx`:165 | 100 | **none** |  |
| `apps/console/components/org-publish-panel.component.tsx`:175 | 100 | **none** |  |
| `apps/console/components/org-publish-panel.component.tsx`:185 | 100 | **none** |  |
| `apps/console/components/org-publish-panel.component.tsx`:203 | 100 | **none** |  |
| `apps/console/components/site-member-drawer.component.tsx`:205 | 100 | ordered |  |
| `apps/console/hooks/use-site-marketplace-plugins.ts`:69 | 100 | **none** |  |
| `apps/console/hooks/use-site-marketplace-plugins.ts`:77 | 100 | **none** |  |
| `libs/plugins/bookings/src/lib/components/bookings-console-page.tsx`:123 | 100 | **none** |  |
| `libs/plugins/bookings/src/lib/components/bookings-console-page.tsx`:132 | 100 | ordered |  |
| `libs/plugins/commerce/src/lib/components/console/host-orders-card.component.tsx`:74 | 100 | **none** | **Fixed** — `collectionCeiling` 100 + probe |
| `libs/plugins/commerce/src/lib/components/console/pos-page.component.tsx`:176 | 100 | **none** |  |
| `libs/plugins/data/src/lib/components/host-datasets-card.component.tsx`:214 | 100 | **none** |  |
| `libs/plugins/logic/src/lib/components/host-reference-health-card.component.tsx`:54 | 100 | **none** |  |
| `libs/plugins/logic/src/lib/components/host-reference-health-card.component.tsx`:91 | 100 | **none** |  |
| `libs/plugins/logic/src/lib/components/host-reference-health-card.component.tsx`:102 | 100 | **none** |  |
| `libs/plugins/logic/src/lib/components/host-variables-card.component.tsx`:246 | 100 | **none** |  |
| `libs/plugins/marketing/src/lib/components/host-experiments-card.component.tsx`:158 | 100 | ordered |  |
| `libs/plugins/marketplace/src/lib/components/listing-content.component.tsx`:552 | 100 | **none** |  |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:239 | 100 | ordered |  |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:260 | 100 | **none** |  |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:270 | 100 | **none** |  |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:315 | 100 | **none** |  |
| `libs/plugins/workflows/src/lib/components/host-actions-card.component.tsx`:280 | 100 | **none** |  |
| `libs/plugins/workflows/src/lib/components/host-actions-card.component.tsx`:304 | 100 | **none** |  |
| `libs/plugins/workflows/src/lib/components/host-webhooks-card.component.tsx`:92 | 100 | **none** |  |
| `libs/plugins/workflows/src/lib/components/host-workflows-card.component.tsx`:157 | 100 | **none** |  |
| `libs/plugins/workflows/src/lib/components/host-workflows-card.component.tsx`:163 | 100 | **none** |  |
| `libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx`:232 | 90 | ordered |  |

### Server route handlers

| Call site | Window | Ordering | Disposition |
| --- | --- | --- | --- |
| `apps/console/app/api/billing/report-usage/route.ts`:578 | 1000 | **none** |  |
| `apps/console/app/api/billing/usage-email/route.ts`:122 | 1000 | **none** |  |
| `apps/console/app/api/hosts/export/route.ts`:271 | 1000 | **none** |  |
| `apps/tenant/app/api/sitemap/route.ts`:196 | 1000 | **none** |  |
| `apps/console/app/api/admin/overview/route.ts`:82 | 500 | ordered |  |
| `apps/console/app/api/admin/overview/route.ts`:85 | 500 | ordered |  |
| `apps/console/app/api/media/folders/route.ts`:166 | 500 | **none** |  |
| `apps/console/app/api/media/folders/route.ts`:203 | 500 | **none** |  |
| `apps/tenant/app/api/sitemap/route.ts`:264 | 500 | **none** |  |
| `apps/tenant/app/api/sitemap/route.ts`:272 | 250 | **none** |  |
| `apps/console/app/api/hosts/where-used/route.ts`:265 | 201 | **none** |  |
| `apps/console/app/api/admin/lockdown/route.ts`:612 | 200 | **none** |  |
| `apps/console/app/api/admin/marketplace-reports/route.ts`:120 | 200 | ordered |  |
| `apps/console/app/api/admin/marketplace-reports/route.ts`:124 | 200 | ordered |  |
| `apps/console/app/api/admin/org-detail/route.ts`:154 | 200 | ordered |  |
| `apps/console/app/api/billing/collaborator-allocations/route.ts`:142 | 200 | **none** |  |
| `apps/console/app/api/billing/register-allocations/route.ts`:107 | 200 | **none** |  |
| `apps/console/app/api/hosts/export/route.ts`:187 | 200 | **none** |  |
| `apps/console/app/api/hosts/where-used/route.ts`:153 | 200 | **none** |  |
| `apps/console/app/api/support/forum/route.ts`:119 | 200 | ordered |  |
| `apps/console/app/api/support/tickets/route.ts`:147 | 200 | ordered |  |
| `apps/tenant/app/api/sitemap/route.ts`:315 | 200 | **none** |  |
| `apps/console/app/api/admin/plugin-reviews/route.ts`:547 | 100 | **none** |  |
| `apps/console/app/api/hosts/where-used/route.ts`:193 | 100 | **none** |  |
| `apps/console/app/api/hosts/where-used/route.ts`:318 | 100 | **none** |  |
| `apps/console/app/api/orgs/invites/route.ts`:360 | 100 | **none** |  |
| `apps/console/app/api/support/forum/route.ts`:143 | 100 | ordered |  |
| `apps/console/app/api/support/forum/route.ts`:144 | 100 | ordered |  |
| `apps/console/app/api/support/tickets/route.ts`:172 | 100 | ordered |  |
| `apps/console/app/api/support/tickets/route.ts`:173 | 100 | ordered |  |

### Server modules and tenant runtime

| Call site | Window | Ordering | Disposition |
| --- | --- | --- | --- |
| `libs/plugins/bookings/src/lib/server.ts`:210 | 500 | **none** |  |
| `libs/plugins/bookings/src/lib/server.ts`:474 | 500 | **none** |  |
| `libs/plugins/bookings/src/lib/server.ts`:786 | 500 | **none** |  |
| `libs/plugins/commerce/src/lib/server/catalog.ts`:195 | 500 | **none** |  |
| `libs/plugins/commerce/src/lib/server/catalog.ts`:196 | 500 | **none** |  |
| `libs/plugins/commerce/src/lib/server/feed.ts`:45 | 500 | **none** |  |
| `libs/plugins/commerce/src/lib/server/member-post.ts`:98 | 500 | ordered |  |
| `libs/plugins/commerce/src/lib/server/refund.ts`:74 | 500 | **none** |  |
| `libs/plugins/commerce/src/lib/server/reservation-availability.ts`:73 | 500 | ordered |  |
| `libs/plugins/commerce/src/lib/server/reserve.ts`:145 | 500 | ordered |  |
| `libs/tenant/data/admin/src/lib/server/email-delivery-log.ts`:1395 | 400 | **none** |  |
| `libs/plugins/commerce/src/lib/server/related.ts`:69 | 300 | **none** |  |
| `apps/console/app/(app)/manage/notifications/page.tsx`:260 | 200 | ordered |  |
| `apps/console/components/document-preview.component.tsx`:320 | 200 | **none** |  |
| `apps/tenant/utils/search-content.ts`:268 | 200 | **none** |  |
| `libs/plugins/commerce/src/lib/server/catalog.ts`:200 | 200 | **none** |  |
| `libs/plugins/commerce/src/lib/server/catalog.ts`:201 | 200 | **none** |  |
| `libs/plugins/commerce/src/lib/server/process-abandoned.ts`:80 | 200 | **none** |  |
| `libs/plugins/commerce/src/lib/server/process-restock.ts`:66 | 200 | **none** |  |
| `libs/plugins/marketing/src/lib/server/campaign-send.ts`:2527 | 200 | ordered |  |
| `libs/tenant/runtime/src/lib/get-components.ts`:51 | 200 | **none** |  |
| `libs/tenant/runtime/src/lib/template-screens.ts`:295 | 200 | **none** |  |
| `apps/tenant/utils/search-content.ts`:177 | 100 | **none** |  |
| `libs/plugins/bookings/src/lib/server.ts`:66 | 100 | **none** |  |
| `libs/plugins/commerce/src/lib/server/cart-checkout.ts`:356 | 100 | **none** |  |
| `libs/plugins/commerce/src/lib/server/checkout.ts`:315 | 100 | **none** |  |
| `libs/plugins/commerce/src/lib/server/draft-order.ts`:252 | 100 | **none** |  |
| `libs/plugins/commerce/src/lib/server/pos-order.ts`:356 | 100 | **none** |  |
| `libs/plugins/commerce/src/lib/server/related.ts`:50 | 100 | **none** |  |
| `libs/plugins/commerce/src/lib/server/reviews.ts`:65 | 100 | **none** |  |
| `libs/plugins/redirects/src/lib/server/resolve-redirect.ts`:59 | 100 | **none** |  |
| `libs/plugins/workflows/src/lib/server.ts`:205 | 100 | **none** |  |
| `libs/plugins/workflows/src/lib/server.ts`:206 | 100 | **none** |  |
| `libs/plugins/workflows/src/lib/server.ts`:207 | 100 | **none** |  |
| `libs/tenant/runtime/src/lib/get-variables.ts`:78 | 100 | **none** |  |
| `libs/tenant/runtime/src/lib/get-variables.ts`:115 | 100 | **none** |  |
| `libs/tenant/runtime/src/lib/get-variables.ts`:167 | 100 | **none** |  |
| `libs/tenant/runtime/src/lib/run-event-actions.ts`:119 | 100 | **none** |  |
| `libs/tenant/runtime/src/lib/run-event-actions.ts`:120 | 100 | **none** |  |
| `libs/tenant/runtime/src/lib/run-event-actions.ts`:121 | 100 | **none** |  |
| `libs/tenant/runtime/src/lib/run-event-workflows.ts`:62 | 100 | **none** |  |
| `libs/tenant/runtime/src/lib/run-event-workflows.ts`:95 | 100 | **none** |  |
| `libs/tenant/runtime/src/lib/run-event-workflows.ts`:96 | 100 | **none** |  |
| `libs/tenant/runtime/src/lib/template-screens.ts`:307 | 100 | **none** |  |

### Client files, read off the listener path

| Call site | Window | Ordering | Disposition |
| --- | --- | --- | --- |
| `apps/console/components/besigner-versions.component.tsx`:277 | 1000 | **none** |  |
| `apps/console/components/besigner-versions.component.tsx`:297 | 1000 | **none** |  |
| `apps/console/components/besigner-versions.component.tsx`:305 | 1000 | **none** |  |
| `libs/plugins/contacts/src/lib/components/contacts-console-page.tsx`:209 | 1000 | ordered |  |
| `libs/plugins/contacts/src/lib/components/contacts-console-page.tsx`:663 | 1000 | **none** |  |
| `libs/plugins/data/src/lib/components/host-datasets-card.component.tsx`:676 | 200 | **none** |  |
| `apps/console/app/(app)/[orgSlug]/plugins/page.tsx`:116 | 100 | **none** |  |
| `libs/plugins/workflows/src/lib/components/host-workflows-card.component.tsx`:543 | 100 | **none** |  |
