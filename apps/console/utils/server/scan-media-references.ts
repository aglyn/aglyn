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

import {
  CORE_CONTENT_COLLECTIONS,
  decodeStoredNodes,
  PLUGIN_CONTENT_COLLECTIONS,
} from '@aglyn/aglyn/server'
import { TENANT_EMAILS } from '@aglyn/shared-util-email'

/**
 * Where an asset is used (AGL-176/AGL-845/AGL-1413).
 *
 * Lifted out of `/api/media/references` because the route had grown into the
 * whole scan, and because the scan's real problem is not any one line in it —
 * it is that its CORPUS was a guess. It read the live version of screens and
 * layouts plus collection entries, and nothing else, which left three whole
 * classes of live reference invisible: reusable components, media held in
 * document FIELDS rather than in a node tree (`logoUrl`, `seo.favicon`,
 * `seo.image`), and every version that is not the published one.
 *
 * Measured in the production org `jWmGooWE3L`: a full programmatic scan found
 * 47 of 206 assets referenced, and the panel's answer was a strict subset of
 * that. Two assets that are on the live site — `favicon.png` and
 * `besigner-canvas-mockup.png` — reported as used NOWHERE.
 *
 * ## Why the direction of the error is the whole issue
 *
 * This scan is the control an author consults immediately before deleting.
 * Every way it can be wrong points the same way — toward "unused" — because
 * missing a document, failing to decode one, or matching the wrong prefix all
 * produce the same output as genuinely finding nothing. There is no failure
 * mode that invents a reference. So the two rules this module is built around:
 *
 * 1. **Never walk a node map without {@link decodeStoredNodes}.** `nodes` has
 *    three storage forms and the compressed one is the majority (AGL-1223);
 *    `JSON.stringify` of a raw Buffer yields `{"type":"Buffer","data":[…]}`,
 *    a haystack containing none of the document's strings, so every needle
 *    misses silently.
 * 2. **An incomplete scan must be able to SAY it is incomplete.** A bounded
 *    scan that reports `[]` is indistinguishable from an exhaustive one that
 *    reports `[]`, and the difference is whether the author is about to
 *    destroy something. See {@link MediaScanCoverage}.
 * 3. **A failed read is charged to coverage, never to the result.** A
 *    `catch` that returns an empty page is rule 2 defeated at the last step:
 *    the scan reports `[]` and reports it as complete. Every read in here
 *    either succeeds or downgrades the coverage flag.
 *
 * AGL-1867 closed the last two holes in the corpus: a site's transactional
 * email templates, and the documents owned by the first-party feature plugins
 * — products, events, services and the rest. Which collections those are is
 * declared in `PLUGIN_CONTENT_COLLECTIONS` and held equal to a repo-wide
 * sweep by `host-content-media-coverage.spec.ts`, so the corpus is derived
 * from the codebase rather than remembered.
 */

export type MediaReferenceKind =
  | 'screen'
  | 'layout'
  | 'entry'
  | 'component'
  | 'site'
  /** A site's own transactional email template (AGL-1867). */
  | 'email'
  /**
   * A document owned by a first-party feature plugin — a product, an event, a
   * bookable service (AGL-1867). `collectionId` carries which one.
   */
  | 'plugin'

/** One place an asset is referenced from. */
export interface MediaReference {
  kind: MediaReferenceKind
  id: string
  name: string
  /** Host that holds the referencing doc — org assets can span sites. */
  hostId: string
  /** Subdomain = the `[host]` route segment used to build the deep link. */
  hostSubdomain: string
  /** Version scanned (screens/layouts/components) — the deep-link target. */
  versionId?: string
  /**
   * Collection holding the row.
   *
   * For an `entry`, the content collection it lives in — the deep link opens
   * that collection. For a `plugin` row it is the host subcollection name
   * (`products`, `events`, …), which is both the label the client renders and
   * the key it routes off (AGL-1867).
   */
  collectionId?: string
  /**
   * Whether the matching version is the PUBLISHED one.
   *
   * `false` means a visitor does not see this reference today, but a rollback
   * or the next publish would — which is a real dependent and a bad surprise,
   * not a reason to hide the row. Absent for kinds that have no version.
   */
  live?: boolean
  /**
   * Dotted path of the field that carried the reference, for matches on a
   * document's own fields rather than inside a node tree. `seo.favicon` is
   * the answer the author needs; "the host document" is not.
   */
  field?: string
}

/**
 * How much of the corpus the scan actually read.
 *
 * Three values rather than a boolean, because the two ways this scan can be
 * incomplete are not equally serious and the UI owes the author different
 * sentences for them:
 *
 * * `full` — every host, document, version and entry in scope was read.
 * * `published` — everything a VISITOR can currently see was read; some
 *   non-published version history was not. "Nothing published uses this" is a
 *   true and useful statement here, and it is the common case for any site
 *   with deep history.
 * * `partial` — the live corpus itself was truncated. Nothing may be presented
 *   as unused; the only honest answer is that we could not determine it.
 */
export type MediaScanCoverage = 'full' | 'published' | 'partial'

export interface MediaReferenceScan {
  references: MediaReference[]
  /** `coverage === 'full'`, named for the callers that only need the bit. */
  complete: boolean
  coverage: MediaScanCoverage
}

/** A site to scan, with its already-read document. */
export interface MediaScanHost {
  ref: FirebaseFirestore.DocumentReference
  id: string
  subdomain: string
  /**
   * The host document itself. Passed in rather than re-read because the
   * caller has already paid for it — the org branch gets it from the
   * `where('orgId','==')` query and the host branch from the scope read — so
   * covering `logoUrl` and `seo.favicon`, the field that made `favicon.png`
   * report as unused, costs ZERO additional reads.
   */
  data?: Record<string, unknown>
}

export interface MediaScanOptions {
  hosts: MediaScanHost[]
  /**
   * The org document, for an org-library scan. `logoUrl` on it is a reference
   * site like any other, and an org asset is exactly what it holds.
   */
  org?: { id: string; data?: Record<string, unknown> } | null
  /** True when the caller could not list every host it wanted to scan. */
  hostsTruncated?: boolean
  /** Whether a serialized document mentions the asset in any of its forms. */
  isReferenced: (haystack: string) => boolean
}

/**
 * Sites per scan. An org library is shared across an org's sites, and the
 * scan visits all of them; past this the answer costs more than it is worth
 * and the coverage flag says so rather than the list quietly shortening.
 */
export const HOSTS_PER_SCAN = 25

/**
 * The host subcollections Pass 1 walks, and the row kind each produces.
 *
 * `emailTemplates` joined them for AGL-1867. It fits the existing machinery
 * exactly — a parent document holding a `versionId`, with the node tree on
 * `…/versions/{versionId}` — so it inherits the version passes, the read
 * budget and the coverage flag rather than needing a pass of its own. It is
 * also the cheapest member by a wide margin: the catalog is code-defined and
 * fixed (`TENANT_EMAILS`), and a template document only exists once somebody
 * has pressed Design, so most sites have none at all.
 *
 * Derived from `CORE_CONTENT_COLLECTIONS` rather than written out again, so
 * that the guard which keeps the whole corpus equal to a repo-wide sweep is
 * reasoning about the same four names this loop reads. `collections` is the
 * fifth core member and is walked one level deeper, into `…/entries`, below.
 *
 * Everything else is `PLUGIN_CONTENT_COLLECTIONS`, read by Pass 2b.
 */
const SCANNED_HOST_COLLECTIONS = CORE_CONTENT_COLLECTIONS.filter(
  (name) => name !== 'collections',
) as ReadonlyArray<'screens' | 'layouts' | 'components' | 'emailTemplates'>

const HOST_COLLECTION_KIND: Record<
  (typeof SCANNED_HOST_COLLECTIONS)[number] & string,
  Extract<MediaReferenceKind, 'screen' | 'layout' | 'component' | 'email'>
> = {
  screens: 'screen',
  layouts: 'layout',
  components: 'component',
  emailTemplates: 'email',
}

/** Screens, layouts, components or email templates read per site. */
const DOCS_PER_COLLECTION = 200

/**
 * Versions read per screen/layout/component.
 *
 * The cost of covering history is bounded PER DOCUMENT rather than paid
 * globally, which matters because it is not the average that hurts: a site
 * where every screen has one or two versions pays one or two reads for it —
 * the same as the previous live-only read — while a single screen with 400
 * versions cannot eat the whole budget on its own.
 *
 * The published version is scanned REGARDLESS of this cap (see
 * `scanVersionedDocument`): truncating history is acceptable, and truncating
 * what visitors currently see is the bug this module exists to fix.
 */
const VERSIONS_PER_DOCUMENT = 3

/** Content collections per site, and entries per collection. */
const COLLECTIONS_PER_HOST = 50
const ENTRIES_PER_COLLECTION = 500

/**
 * Documents read per plugin-owned collection, per site (AGL-1867).
 *
 * Matches `DOCS_PER_COLLECTION`, and for the same reason: past this the answer
 * costs more than it is worth, and the honest response to a catalog of 500
 * products is `partial` coverage — "we could not check everywhere" — not a
 * quietly shortened list that reads as a clean bill of health.
 */
const PLUGIN_DOCS_PER_COLLECTION = 200

/**
 * Plugin collections queried concurrently per site.
 *
 * There are twenty-five of them and most are empty on most sites, so issuing
 * them one at a time would put twenty-five sequential round-trips behind a
 * button that already blocks a delete confirmation. This is the granularity at
 * which the budget can still stop the pass.
 */
const PLUGIN_COLLECTION_CHUNK = 8

/**
 * Documents one scan may read.
 *
 * This runs on a user's click AND inside the delete confirmation, so the
 * naive version — every version of every document of every site in the org —
 * is an unbounded per-org scan on an interactive path. The budget is what
 * turns "unbounded" into "bounded and honest": work stops when it is spent
 * and the answer downgrades to `partial`, rather than the request running for
 * ten seconds or the answer silently covering a prefix.
 */
const READ_BUDGET = 1500

/**
 * Parents whose versions are fetched concurrently before the budget is
 * re-checked. Concurrency is what makes the scan fast enough to sit behind a
 * button; this is the granularity at which it can still be stopped, so the
 * overshoot past the budget is bounded by `CHUNK × (VERSIONS_PER_DOCUMENT+1)`
 * rather than by the size of the collection.
 */
const PARENT_CHUNK = 25

/**
 * Reads spent, and whether the budget ran out.
 *
 * Approximate by construction — a query is committed before its result size
 * is known — but bounded, which is the property that matters. Firestore bills
 * a minimum of one read for an empty query, so this under-counts slightly on
 * documents with no versions; it is a ceiling on work, not an invoice.
 */
class ReadBudget {
  spent = 0
  exhausted = false

  /** Whether there is room to issue another query. */
  get open(): boolean {
    if (this.spent >= READ_BUDGET) this.exhausted = true
    return !this.exhausted
  }

  charge(documents: number): void {
    this.spent += Math.max(1, documents)
  }
}

/**
 * A document flattened to text the needles run against, with any node tree
 * DECODED first.
 *
 * `nodes` is the compressed field; `elements` is the legacy alias a
 * pre-migration document's tree still lives under (AGL-1391), and it is
 * decoded for the same reason — a reader that handles one and not the other
 * reports half the corpus as empty.
 */
export function documentHaystack(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const document = data as Record<string, unknown>
  const decoded: Record<string, unknown> = { ...document }
  for (const key of ['nodes', 'elements']) {
    if (key in document) decoded[key] = decodeStoredNodes(document[key]) ?? {}
  }
  try {
    return JSON.stringify(decoded) ?? ''
  } catch {
    // A cyclic or unserializable document must not read as "no references".
    return ''
  }
}

/** Depth guard for the field walk; host documents are shallow. */
const FIELD_WALK_MAX_DEPTH = 6

/**
 * Dotted path of the first STRING field holding the reference.
 *
 * Walked generically rather than checked against a declared list of
 * media-bearing fields (`logoUrl`, `seo.favicon`, …). A list is exactly the
 * thing that goes stale: the next field a picker learns to write would be
 * absent from it, and the scan would answer "unused" for whatever lands
 * there — the failure this module exists to stop, reintroduced by omission.
 * The walk cannot go stale, and the path it returns is a better label than
 * anything a list could have carried.
 */
export function referencingFieldPath(
  value: unknown,
  isReferenced: (haystack: string) => boolean,
  path = '',
  depth = 0,
): string | undefined {
  if (typeof value === 'string') {
    return isReferenced(value) ? path : undefined
  }
  if (depth >= FIELD_WALK_MAX_DEPTH || !value || typeof value !== 'object') {
    return undefined
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const found = referencingFieldPath(
      child,
      isReferenced,
      path ? `${path}.${key}` : key,
      depth + 1,
    )
    if (found) return found
  }
  return undefined
}

/**
 * What to call a screen, layout or component in the list.
 *
 * `displayName` FIRST. Screens and layouts have never stored a `name`, and
 * this scan read exactly that field — so every row the panel showed was a raw
 * document id, which is the one thing a "where is this used" list must not
 * be. `where-used` had the same bug and fixed it the same way.
 */
const displayNameOf = (snapshot: FirebaseFirestore.DocumentSnapshot): string =>
  String(snapshot.get('displayName') ?? snapshot.get('name') ?? snapshot.id)

/**
 * Catalog name for an email template id (AGL-1867).
 *
 * An email template document is keyed by its catalog key and carries no
 * `displayName`, so `displayNameOf` would land on the raw id — `abandoned-cart`
 * where the console everywhere else says "Abandoned cart". The catalog is
 * code-defined and fixed, so this is a lookup rather than a read. A key with
 * no catalog entry falls back to the id rather than being hidden: a template
 * for an email the catalog has since dropped still references the asset.
 */
const emailTemplateName = (key: string): string =>
  TENANT_EMAILS.find((entry) => entry.key === key)?.name ?? key

/**
 * What to call a plugin-owned document in the list (AGL-1867).
 *
 * Twenty-five collections written by thirteen plugins do not agree on a name
 * field, and nothing declares which one they use — so this tries the four the
 * repo actually uses, in the order a person would want them. `title` leads
 * because that is what commerce products, events and member posts carry;
 * `displayName` follows for the besigner-adjacent ones.
 *
 * The fallback is the document id, never a skipped row. A product whose title
 * failed to read still uses the asset, and "this thing you cannot name uses
 * it" is a far better answer than silence in the one panel where silence means
 * "go ahead and delete".
 */
const pluginRowNameOf = (
  snapshot: FirebaseFirestore.DocumentSnapshot,
): string => {
  for (const field of ['title', 'name', 'displayName', 'label']) {
    const value = snapshot.get(field)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return snapshot.id
}

/** The name a reference row shows, by kind. */
const rowNameOf = (
  kind: MediaReferenceKind,
  snapshot: FirebaseFirestore.DocumentSnapshot,
): string =>
  kind === 'email' ? emailTemplateName(snapshot.id) : displayNameOf(snapshot)

/** Slice an array into fixed-size chunks so a batch can be interrupted. */
function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

/**
 * Every place one asset is referenced, across the sites the caller may see.
 *
 * The order of work is the order of value: the documents already in hand cost
 * nothing, the published surfaces come next, and version history last — so
 * when the budget runs out it runs out on the tier whose absence is least
 * dangerous, and the coverage flag records which tier that was.
 */
export async function scanMediaReferences(
  options: MediaScanOptions,
): Promise<MediaReferenceScan> {
  const { hosts, org, isReferenced } = options
  const references: MediaReference[] = []
  const budget = new ReadBudget()
  /** Non-published version history was truncated somewhere. */
  let historyTruncated = false
  /** Something a visitor can currently see went unread. */
  let liveTruncated = Boolean(options.hostsTruncated)

  // ── Documents already in hand ──────────────────────────────────────────
  // Zero reads. This is where `favicon.png` lives: `seo.favicon` on the host
  // document, a field the scan never looked at because it only ever walked
  // node trees.
  if (org?.data) {
    const field = referencingFieldPath(org.data, isReferenced)
    if (field) {
      references.push({
        kind: 'site',
        id: org.id,
        name: 'Organization settings',
        hostId: '',
        hostSubdomain: '',
        field,
      })
    }
  }
  for (const host of hosts) {
    const field = host.data
      ? referencingFieldPath(host.data, isReferenced)
      : undefined
    if (field) {
      references.push({
        kind: 'site',
        id: host.id,
        name: String(host.data?.['displayName'] ?? host.subdomain ?? host.id),
        hostId: host.id,
        hostSubdomain: host.subdomain,
        field,
      })
    }
  }

  /** A screen/layout/component/email template still owing version reads. */
  interface PendingParent {
    host: MediaScanHost
    parent: FirebaseFirestore.QueryDocumentSnapshot
    kind: Extract<
      MediaReferenceKind,
      'screen' | 'layout' | 'component' | 'email'
    >
    liveVersionId?: string
    /** Already reported, so no version of it needs reading. */
    settled: boolean
  }
  const pending: PendingParent[] = []

  const pushVersionMatch = (
    item: PendingParent,
    versionId: string,
    live: boolean,
  ) => {
    item.settled = true
    references.push({
      kind: item.kind,
      id: item.parent.id,
      name: rowNameOf(item.kind, item.parent),
      hostId: item.host.id,
      hostSubdomain: item.host.subdomain,
      versionId,
      live,
    })
  }

  // ── Pass 1: the documents, and the entries ─────────────────────────────
  for (const host of hosts.slice(0, HOSTS_PER_SCAN)) {
    for (const collectionName of SCANNED_HOST_COLLECTIONS) {
      if (!budget.open) {
        liveTruncated = true
        break
      }
      // One over the cap, so exceeding it is DETECTED rather than assumed
      // away — the same idiom as `readUsageCandidates`, and cheaper than a
      // count() as well as exact.
      const page = await host.ref
        .collection(collectionName)
        .limit(DOCS_PER_COLLECTION + 1)
        .get()
      budget.charge(page.size)
      if (page.size > DOCS_PER_COLLECTION) liveTruncated = true
      const kind = HOST_COLLECTION_KIND[collectionName]

      for (const parent of page.docs.slice(0, DOCS_PER_COLLECTION)) {
        if (parent.get('deletedAt')) continue
        const liveVersionId = parent.get('versionId')
          ? String(parent.get('versionId'))
          : undefined
        const item: PendingParent = {
          host,
          parent,
          kind,
          liveVersionId,
          settled: false,
        }
        // The document's OWN fields, free — the collection query already
        // paid for them. A screen carries its social card here (AGL-1337)
        // and a component definition carries its published node tree here,
        // stored plainly so the tenant runtime can read it without decoding.
        // That tree renders on every page of the site and was never on this
        // scan's map, which is why `besigner-canvas-mockup.png` reported as
        // used nowhere while two components drew it.
        if (isReferenced(documentHaystack(parent.data()))) {
          item.settled = true
          references.push({
            kind,
            id: parent.id,
            name: rowNameOf(kind, parent),
            hostId: host.id,
            hostSubdomain: host.subdomain,
            ...(liveVersionId ? { versionId: liveVersionId, live: true } : {}),
            ...(kind === 'component'
              ? {}
              : {
                  field:
                    referencingFieldPath(parent.data(), isReferenced) ??
                    undefined,
                }),
          })
        }
        pending.push(item)
      }
    }

    // Content-collection entries (AGL-833): blog and other collections
    // reference media via `coverImage`/`body`, not screen/layout nodes.
    if (!budget.open) {
      liveTruncated = true
      continue
    }
    const collections = await host.ref
      .collection('collections')
      .limit(COLLECTIONS_PER_HOST + 1)
      .get()
    budget.charge(collections.size)
    if (collections.size > COLLECTIONS_PER_HOST) liveTruncated = true
    for (const collection of collections.docs.slice(0, COLLECTIONS_PER_HOST)) {
      if (!budget.open) {
        liveTruncated = true
        break
      }
      const entries = await collection.ref
        .collection('entries')
        .limit(ENTRIES_PER_COLLECTION + 1)
        .get()
      budget.charge(entries.size)
      if (entries.size > ENTRIES_PER_COLLECTION) liveTruncated = true
      for (const entry of entries.docs.slice(0, ENTRIES_PER_COLLECTION)) {
        if (entry.get('deletedAt')) continue
        if (!isReferenced(documentHaystack(entry.data()))) continue
        references.push({
          kind: 'entry',
          id: entry.id,
          name: String(entry.get('title') ?? entry.id),
          hostId: host.id,
          hostSubdomain: host.subdomain,
          collectionId: collection.id,
        })
      }
    }
  }

  // ── Pass 2: the PUBLISHED version of every document ────────────────────
  // Read by id, one per document, before any history — the ordering IS the
  // coverage guarantee. Interleaving the two would let one screen's four
  // hundred drafts consume the budget that another screen's live version
  // needed, and the answer would then be `partial` for a site whose live
  // corpus was perfectly affordable to read.
  for (const chunk of chunked(
    pending.filter((item) => !item.settled && item.liveVersionId),
    PARENT_CHUNK,
  )) {
    if (!budget.open) {
      liveTruncated = true
      break
    }
    await Promise.all(
      chunk.map(async (item) => {
        const version = await item.parent.ref
          .collection('versions')
          .doc(item.liveVersionId)
          .get()
        budget.charge(1)
        if (!version.exists) return
        if (isReferenced(documentHaystack(version.data()))) {
          pushVersionMatch(item, version.id, true)
        }
      }),
    )
  }

  // ── Pass 2b: plugin-owned content (AGL-1867) ───────────────────────────
  // The other half of this issue. A product, an event, a bookable service, a
  // members-only post: ordinary host subcollections written by the
  // first-party feature plugins under `libs/plugins/*`, holding assets an
  // author picked out of exactly this library. A commerce product carries
  // `imageUrl` and `mediaUrls`, so a product photo used nowhere else came
  // back as an empty list — and the panel's job is to be believed.
  //
  // WHICH collections is not decided here; see `PLUGIN_CONTENT_COLLECTIONS`,
  // whose whole design is that a name nobody has thought about is SCANNED and
  // a name outside the corpus had to be written down with a reason, with a
  // build guard holding the list equal to a repo-wide sweep. Nothing about
  // plugin schemas is known here: each document is flattened by
  // `documentHaystack` — decoding `nodes`/`elements` on the way, so a plugin
  // that adopts the compressed form is covered without a code change — and
  // the matching field's dotted path is recovered by the same generic walk
  // the host document gets.
  //
  // Placed after the published-version pass and before history on purpose.
  // Plugin content is LIVE — a visitor sees the product page today — so it
  // belongs on the live tier, and running out of budget here downgrades the
  // answer to `partial`. It goes second within that tier because Pass 2 is
  // one read per document and this is one query per collection per site.
  for (const host of hosts.slice(0, HOSTS_PER_SCAN)) {
    for (const group of chunked(
      [...PLUGIN_CONTENT_COLLECTIONS],
      PLUGIN_COLLECTION_CHUNK,
    )) {
      if (!budget.open) {
        liveTruncated = true
        break
      }
      await Promise.all(
        group.map(async (collectionName) => {
          let page: FirebaseFirestore.QuerySnapshot
          try {
            page = await host.ref
              .collection(collectionName)
              .limit(PLUGIN_DOCS_PER_COLLECTION + 1)
              .get()
          } catch (error) {
            // A FAILED READ IS NOT AN EMPTY ONE.
            //
            // The single most dangerous line in this module would be a
            // `.catch(() => null)` here: a missing index, a rules change, a
            // transient Firestore error would all fold into "this collection
            // holds no references", which is the exact shape of the bug the
            // whole file exists to prevent — an author shown a confident
            // "nothing uses it" that was really an error. So the failure is
            // logged and charged to COVERAGE instead, which forces the panel
            // and the delete confirmation onto their `unknown` sentences.
            console.error(
              'media reference scan could not read plugin collection',
              { hostId: host.id, collection: collectionName },
              error,
            )
            liveTruncated = true
            return
          }
          budget.charge(page.size)
          if (page.size > PLUGIN_DOCS_PER_COLLECTION) liveTruncated = true
          for (const document of page.docs.slice(
            0,
            PLUGIN_DOCS_PER_COLLECTION,
          )) {
            if (document.get('deletedAt')) continue
            if (!isReferenced(documentHaystack(document.data()))) continue
            references.push({
              kind: 'plugin',
              id: document.id,
              name: pluginRowNameOf(document),
              hostId: host.id,
              hostSubdomain: host.subdomain,
              // The collection IS the label — the client turns
              // `productCategories` into "Product category" and routes the
              // row off the same value.
              collectionId: collectionName,
              field:
                referencingFieldPath(document.data(), isReferenced) ??
                undefined,
            })
          }
        }),
      )
    }
  }

  // ── Pass 3: version history, with whatever budget is left ──────────────
  // Running out here downgrades the answer to `published`, not to `partial`:
  // everything a visitor can see has already been read, and "nothing
  // published uses this" is both true and the sentence an author needs.
  for (const chunk of chunked(
    pending.filter((item) => !item.settled),
    PARENT_CHUNK,
  )) {
    if (!budget.open) {
      historyTruncated = true
      break
    }
    await Promise.all(
      chunk.map(async (item) => {
        const page = await item.parent.ref
          .collection('versions')
          .limit(VERSIONS_PER_DOCUMENT + 1)
          .get()
        budget.charge(page.size)
        if (page.size > VERSIONS_PER_DOCUMENT) historyTruncated = true
        for (const version of page.docs.slice(0, VERSIONS_PER_DOCUMENT)) {
          // The published one was read in pass 2 and did not match.
          if (version.id === item.liveVersionId) continue
          if (!isReferenced(documentHaystack(version.data()))) continue
          pushVersionMatch(item, version.id, false)
          // One row per document: an author deciding whether to delete needs
          // to know THAT this screen holds the asset, not that seven of its
          // drafts do.
          return
        }
      }),
    )
  }

  if (hosts.length > HOSTS_PER_SCAN) liveTruncated = true

  const coverage: MediaScanCoverage = liveTruncated
    ? 'partial'
    : historyTruncated
      ? 'published'
      : 'full'

  return { references, coverage, complete: coverage === 'full' }
}

export default scanMediaReferences
