/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Which host subcollections the media usage scan reads (AGL-1867).
 *
 * ## Why this exists, and why it is shaped the way it is
 *
 * `scanMediaReferences` answers "what uses this asset" immediately before an
 * author deletes it, and every way it can be wrong points at "unused". AGL-1413
 * closed the screen/layout/component/host-field half. AGL-1867 closed emails.
 * What was left was plugin-owned content: a commerce product carries `imageUrl`
 * and `mediaUrls`, so a product photo used nowhere else reported as unused, and
 * the panel said so with a straight face.
 *
 * An earlier pass at this issue concluded the gap could not be closed by hand,
 * because closing it looked like classifying fifty-odd collection names as
 * media-bearing or not — "a large list of guesses dressed as decisions, and the
 * first stale entry is where the next hole hides". That reasoning was right
 * about the hazard and wrong about the shape of the fix. The classification it
 * feared is only necessary if the default is NOT to scan. So the default here
 * is inverted:
 *
 * **Every host subcollection is scanned unless it is named below with a
 * reason it is not.**
 *
 * That turns the open question from "does this carry media?" — which needs a
 * judgement about a schema nobody wrote down — into "is scanning this wasteful
 * or wrong?", which is answerable from the collection's own volume and who
 * writes it. It also puts the failure on the safe side: a collection nobody has
 * thought about is READ, so a plugin shipping a new media-bearing collection is
 * covered the day it lands rather than the day somebody remembers it.
 *
 * ## What keeps the list from rotting
 *
 * `host-content-media-coverage.spec.ts` sweeps `apps/**` and `libs/**` for host
 * subcollection names — the same derived sweep
 * `host-subcollection-write-deny-coverage.spec.ts` uses, for the same reason —
 * and asserts {@link PLUGIN_CONTENT_COLLECTIONS} is EXACTLY that sweep minus
 * {@link CORE_CONTENT_COLLECTIONS} minus {@link MEDIA_SCAN_EXCLUDED}. A new
 * collection fails the build with a one-line decision to make, and the default
 * answer — add it to the scanned list — is also the safe one.
 *
 * ## The plugin boundary was NOT crossed to do this
 *
 * Worth stating, because "read plugin data into a first-party corpus" sounds
 * like it should be. It is not, and the reason is that "plugin" means two
 * disjoint things:
 *
 *  - a SANDBOXED marketplace plugin runs in an iframe on a separate origin and
 *    has no Firestore access at all — `plugin-bridge.ts` is the whole protocol
 *    and its guest verbs are `ready`, `resize`, `event`, `fetch-request` and
 *    `error`, with `parseGuestMessage` rejecting anything else. It owns no
 *    documents, so there is nothing here to reach into.
 *  - a FIRST-PARTY feature plugin under `libs/plugins/*` is compiled into the
 *    apps and writes ORDINARY host subcollections with the ordinary SDKs. Those
 *    documents already sit under the same `hosts/{hostId}` rules as a screen,
 *    are already read by first-party console pages, and are already covered by
 *    the same scope check the scan runs before it reads anything.
 *
 * So the corpus grows to include documents the caller could already read
 * through the console, under an authorization decision that has not changed.
 * Nothing in the sandbox boundary is bypassed, because no sandboxed guest owns
 * any of this.
 */

/**
 * Host subcollections the media scan reads through its own dedicated machinery.
 *
 * Not "excluded" — covered, by a pass that knows their shape. Screens, layouts,
 * components and email templates each hang a node tree off
 * `…/versions/{versionId}` and get the published-version and history passes;
 * `collections` is walked one level deeper, into `…/entries`.
 */
export const CORE_CONTENT_COLLECTIONS = [
  'screens',
  'layouts',
  'components',
  'emailTemplates',
  'collections',
] as const

/**
 * Host subcollections deliberately NOT read by the media scan, and why.
 *
 * Every entry has to answer one of two questions: what would scanning it cost,
 * or what would scanning it get wrong. "It probably has no images in it" is not
 * an accepted reason — that is the guess this file is arranged to avoid making.
 */
export const MEDIA_SCAN_EXCLUDED: Record<string, string> = {
  // ── Scanning these would be WRONG, not merely expensive ────────────────
  media:
    'The library itself. The asset under audit IS a document in here, and its ' +
    'own record holds its own url, cdnPath and storage path — every needle ' +
    'the scan carries. Reading this collection would report every asset as ' +
    'referencing itself, which turns a deletion-safety control into noise ' +
    'that nobody reads.',
  mediaFolders:
    'Folder records: a name, a parent pointer and a scope. A folder never ' +
    'holds an asset reference, and it is not a dependent either — deleting a ' +
    'file does not break the folder it sat in.',

  // ── Machine-written telemetry: unbounded, and no author picks into it ──
  analytics:
    'Per-day traffic rollups written by the tenant collector. One document ' +
    'per day per site forever, no author-editable field, and no surface that ' +
    'can pick an asset into one.',
  screenAnalytics:
    'Per-screen traffic history behind the Pro+ panel, written by the same ' +
    'collector on the same unbounded per-day cadence.',
  counters:
    'Quota and usage counters, server-owned (AGL-1367) and denied to client ' +
    'writes outright. Numbers, not content.',
  activity:
    'The site activity feed — an append-only audit log the console writes a ' +
    'row into on every change. Unbounded by design, and a row that quotes an ' +
    'asset id is a record that somebody touched it, not a place it is used.',

  // ── Transaction and ledger rows: unbounded, and a SNAPSHOT is not a use ─
  orders:
    'Completed orders. Line items COPY a product\'s `imageUrl` at purchase ' +
    'time, so these would match — and matching would be the wrong answer: an ' +
    'order is an immutable record of what was sold, deleting the asset ' +
    'changes nothing about it, and no author can edit one. A busy store also ' +
    'holds more of these than the whole read budget.',
  carts:
    'Live and abandoned carts, with the same copied line-item image and the ' +
    'same reasoning, at higher volume — one document per shopper session.',
  checkouts:
    'In-flight checkout sessions. Transient buyer state carrying the same ' +
    'line-item snapshot as `carts`.',
  formSubmissions:
    'Visitor form submissions. Unbounded, PII-heavy, and a file attached to ' +
    'one is the visitor\'s upload — not a library asset an author picked, and ' +
    'not something deleting a library asset would break.',
  leads:
    'Captured leads, on the same footing as `formSubmissions`: visitor-' +
    'submitted, unbounded, and never a place an author places an asset.',
  bookings:
    'Booking records — a customer, a time and a service pointer. The service ' +
    'holds the imagery and IS scanned; a booking is the transaction against ' +
    'it.',
  reservations:
    'POS and booking holds. Short-lived transaction rows pointing at a ' +
    'resource that is itself scanned.',
  stockHolds:
    'Inventory holds taken during checkout. Machine-written, short-lived, ' +
    'and a quantity rather than content.',
  subscriptions:
    'Site membership subscriptions: a plan pointer, a status and Stripe ' +
    'ids. Server-written from the billing webhook.',
  registers:
    'POS register allocations — a count against the register add-on, read by ' +
    'billing (AGL-1775). No content field at all.',
  giftCards:
    'Gift card balances and redemption history. Money, not content.',
  licenseKeys:
    'Digital-product license keys issued at fulfilment: a code, an order ' +
    'pointer and a revocation flag.',
  inventoryAdjustments:
    'The append-only stock adjustment ledger (AGL-2269). One row per manual ' +
    'stock edit and per cancellation release, unbounded over a store\'s life.',
  inventoryReconciliation:
    'Reconciliation runs comparing counted stock against recorded stock. ' +
    'Machine-written totals.',
  restockAlerts:
    'Back-in-stock requests: an email address and a product pointer, written ' +
    'by visitors.',
  suppressions:
    'Unsubscribes, bounces and spam complaints. Email addresses and a ' +
    'reason.',
  stripeTaxRates:
    'Cached Stripe tax rate ids, written by the tax sync. Vendor ids.',
  members:
    'The ORG-facing member roster mirrored onto the site, server-owned ' +
    '(AGL-1367). A member\'s photo is their own account photo, uploaded ' +
    'through /api/account/photo and stored outside any site\'s library, so it ' +
    'is not an asset this scan can be asked about.',
}

/**
 * Host subcollections the media scan reads generically.
 *
 * Generically: no per-collection field list and no per-collection decoder.
 * Each document is flattened by `documentHaystack` — which decodes `nodes` and
 * `elements` through `decodeStoredNodes` first, so a plugin that adopts the
 * compressed storage form is covered without touching this file — and the
 * matching field's dotted path is recovered by walking the document. A field
 * list here would be the same staleness trap `referencingFieldPath` was written
 * to avoid one level down.
 *
 * MUST equal the repo-wide host subcollection sweep minus
 * {@link CORE_CONTENT_COLLECTIONS} minus {@link MEDIA_SCAN_EXCLUDED}. The guard
 * spec asserts exactly that, in both directions, so this list can neither miss
 * a new collection nor keep naming a deleted one.
 */
export const PLUGIN_CONTENT_COLLECTIONS = [
  'actions',
  'authors',
  'campaigns',
  'coupons',
  'discounts',
  'events',
  'experiments',
  'functions',
  'installs',
  'locations',
  'memberPosts',
  'overlays',
  'productCategories',
  'products',
  'redirects',
  'resources',
  'reviews',
  'services',
  'settings',
  'siteMembers',
  'suppliers',
  'templates',
  'variables',
  'webhooks',
  'workflows',
] as const

export type PluginContentCollection =
  (typeof PLUGIN_CONTENT_COLLECTIONS)[number]

/**
 * Console page slug a plugin-content reference row deep-links to.
 *
 * Optional on purpose, and deliberately not required for a collection to be
 * scanned. A row with no destination still renders — as text rather than a
 * link — and that is strictly better than the row not existing, which is the
 * bug this issue is about. Requiring a slug would have made the deep link a
 * precondition for coverage and quietly re-created the hole for every
 * collection nobody had got round to routing.
 *
 * Keyed by collection, valued with the `[pluginSlug]` segment of
 * `Route.HOST_PLUGIN`.
 */
export const PLUGIN_CONTENT_ROUTE_SLUG: Partial<
  Record<PluginContentCollection, string>
> = {
  products: 'products',
  productCategories: 'products',
  suppliers: 'products',
  locations: 'products',
  coupons: 'products',
  discounts: 'products',
  reviews: 'products',
  memberPosts: 'products',
  events: 'events',
  services: 'bookings',
  resources: 'bookings',
  redirects: 'redirects',
  campaigns: 'marketing',
  experiments: 'marketing',
  workflows: 'workflows',
  webhooks: 'workflows',
  functions: 'logic',
  variables: 'logic',
  actions: 'logic',
}

/**
 * What to call one of these in a reference row.
 *
 * Derived from the collection name rather than declared, so a newly scanned
 * collection gets a readable label without a second list to keep in step —
 * `productCategories` reads as "Product category". Singularised with the two
 * rules English spells consistently enough to be worth automating; anything
 * else keeps its name, which is a cosmetic miss rather than a coverage one.
 */
export function hostContentCollectionLabel(collection: string): string {
  const singular = /ies$/.test(collection)
    ? collection.replace(/ies$/, 'y')
    : /(ss|s)$/.test(collection)
      ? collection.replace(/s$/, '')
      : collection
  const spaced = singular.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
