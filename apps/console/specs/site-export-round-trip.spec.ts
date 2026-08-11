/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
 *
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
 * AGL-1382: /api/hosts/import stores an ALLOW-list, the last of the three.
 *
 * The route used to persist every subcollection document from an uploaded
 * bundle through `cleanDoc()`, a DENY-list: six structural keys destructured
 * away and everything else written with `merge: false`. The same file already
 * copied host settings through `EXPORTABLE_HOST_FIELDS`, so one file held both
 * disciplines and the subcollection half was the one that failed open.
 *
 * This suite drives BOTH directions against one fake Firestore, because the
 * round trip is the only honest source of truth for the permitted set. The
 * export emits `{ $id, ...doc.data() }` — the whole document — so the list is
 * not "what a create sends" but "what a live document can carry", which is
 * strictly wider: creates go through `RESOURCES[*].fields` while updates stay
 * client-direct, and a document accretes fields for its whole life.
 *
 * Three assertions, in the order they matter:
 *
 * 1. **The positive control.** Seed a fully-populated document of every shape,
 *    export it, JSON round-trip the bundle, import it, and require every field
 *    back. A too-narrow list drops authoring input SILENTLY and `merge: false`
 *    ERASES it on a restore into the source host — the opposite failure, and
 *    the worse one.
 * 2. **The bug, as an assertion.** Put unexpected keys on every bundle document
 *    and require that none is stored. Against the deny-list this failed for
 *    every collection here.
 * 3. **Coverage.** Every field on the allow-list is exercised by a seed, so a
 *    key nobody can defend cannot sit on the list unnoticed (AGL-1384).
 */

const mockVerifyIdToken = jest.fn()

const mockServerTimestamp = Symbol('serverTimestamp')

type Doc = Record<string, unknown>

/**
 * An in-memory Firestore keyed by collection PATH, so a write can be asserted
 * against the exact path it landed on — `hosts/host-1/screens` and
 * `orgs/org-1/datasets/dataset-1/records` are different collections here for
 * the same reason they are in production.
 */
const store = new Map<string, Map<string, Doc>>()
const writes: Array<{ path: string; data: Doc; merge: boolean }> = []

const seed = (collectionPath: string, id: string, data: Doc) => {
  if (!store.has(collectionPath)) store.set(collectionPath, new Map())
  store.get(collectionPath).set(id, data)
}

const storedAt = (path: string) =>
  writes.find((entry) => entry.path === path)?.data

/** A dotted field path, as `where('publishSchedule.publishAt', …)` names it. */
const fieldPath = (data: Doc, path: string): unknown =>
  path.split('.').reduce<any>((value, key) => value?.[key], data)

/**
 * One `where` clause, with FIRESTORE's comparison semantics rather than
 * JavaScript's — which is the entire point of modelling the query at all
 * (AGL-1392).
 *
 * Firestore orders values by TYPE FIRST and only then by value, and maps sort
 * strictly after timestamps. So a range bound of `<= <a Timestamp>` can never
 * be satisfied by a field holding a MAP, however timestamp-shaped that map
 * looks: `{_seconds, _nanoseconds}` is not a near-miss, it is a different type
 * and the document is simply not in the result set.
 *
 * A model that compared with `<=` in JavaScript would return the degraded
 * document and this suite would be green against the bug — the same way
 * `toEqual` is, since a `Timestamp`'s own enumerable keys are EXACTLY
 * `_seconds` and `_nanoseconds`. Hence the premise guard below.
 */
const matchesFilter = (data: Doc, filter: [string, string, unknown]) => {
  const [path, op, bound] = filter
  const value = fieldPath(data, path)
  if (op === '==') return value === bound
  if (op === '<=') {
    if (!(value instanceof Timestamp)) return false
    const boundMs =
      bound instanceof Timestamp ? bound.toMillis() : (bound as Date).getTime()
    return value.toMillis() <= boundMs
  }
  throw new Error(`unmodelled operator '${op}'`)
}

function collectionRef(path: string, filters: Array<[string, string, unknown]> = []): any {
  const ref: any = {
    path,
    limit: () => ref,
    where: (field: string, op: string, value: unknown) =>
      collectionRef(path, [...filters, [field, op, value]]),
    select: () => ref,
    get: async () => ({
      docs: [...(store.get(path) ?? new Map()).entries()]
        .filter(([, data]) =>
          filters.every((filter) => matchesFilter(data ?? {}, filter)),
        )
        .map(([id, data]) => snapshotOf(path, id, data)),
    }),
    doc: (id: string) => docRef(path, id),
    add: async () => undefined,
  }
  return ref
}

const snapshotOf = (path: string, id: string, data: Doc | undefined) => ({
  id,
  exists: data !== undefined,
  ref: docRef(path, id),
  data: () => data,
  get: (field: string) => (data ?? {})[field],
})

function docRef(collectionPath: string, id: string): any {
  return {
    id,
    path: `${collectionPath}/${id}`,
    get: async () =>
      snapshotOf(collectionPath, id, (store.get(collectionPath) ?? new Map()).get(id)),
    collection: (name: string) => collectionRef(`${collectionPath}/${id}/${name}`),
  }
}

const mockFirestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => ({
    set: (ref: any, data: Doc, options?: { merge?: boolean }) => {
      writes.push({ path: ref.path, data, merge: Boolean(options?.merge) })
    },
    commit: async () => undefined,
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockFirestore,
    }),
    firestore: { FieldValue: { serverTimestamp: () => mockServerTimestamp } },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'enterprise' } }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  // The host-scope narrowing has its own suite; here it must not hide rows.
  scopedToHost: (ref: any) => ref,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL entitlement gate, collection-kind inference, dataset validation,
  // scope tokens, name key and binding-token rewrite. Stubbing any of them
  // would let this suite pass against a route enforcing nothing.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/dataset-models'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/name-search'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/binding-tokens'),
  // The REAL decode too (AGL-1391). Stubbing it would let the export ship an
  // opaque Buffer envelope and this suite would still be green — which is
  // exactly how the feature shipped broken.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  // `compress` too — the seed below must be packed by the same encoder the
  // besigner writes with, and re-exporting it here keeps the spec off a
  // relative deep import into another project (@nx/enforce-module-boundaries).
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/compress'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    body:
      request.method === 'GET' ? undefined : await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { GET as EXPORT_GET } from '../app/api/hosts/export/route'
import { POST as IMPORT_POST } from '../app/api/hosts/import/route'
import { IMPORTABLE_FIELDS } from '../app/api/_lib/site-export'
// Through the mocked specifier, which re-exports the REAL implementation above.
import { compress } from '@aglyn/aglyn/server'
// The REAL Admin `Timestamp`, not a stand-in: what a document's timestamp
// fields actually hold when `doc.data()` hands them back, and the class the
// restored value has to BE for a range query to see it (AGL-1392).
import { Timestamp } from 'firebase-admin/firestore'

/**
 * A fully-populated document of every shape the bundle carries, keyed by the
 * collection path it lives on. Every field here was read off a real write path
 * (create route, client-direct update, or marketplace install) — narrowing the
 * allow-list past any of them loses site content on restore with no error.
 */
/**
 * The node map a besigner save actually produces — the COMPRESSED storage form
 * (AGL-1391). `nodes` lives in two forms and only one of them is a map: the
 * tenant editor hooks write `Bytes.fromUint8Array(compress(rest.nodes))`, so
 * the compressed form is the majority of live screens and layouts.
 */
const BESIGNER_NODES = {
  root: { $id: 'root', componentId: 'container', nodes: ['heading', 'body'] },
  heading: {
    $id: 'heading',
    componentId: 'typography',
    nodes: [],
    props: { children: 'Welcome' },
  },
  body: {
    $id: 'body',
    componentId: 'typography',
    nodes: [],
    props: { children: 'Copy that has to survive a backup.' },
  },
}

/**
 * What firebase-admin hands back for a `Bytes` field: a Node `Buffer` carved
 * out of the shared allocation pool, so `byteOffset` is non-zero and
 * `buffer.byteLength` is the whole pool rather than the field.
 *
 * Carved from a dedicated slab rather than `Buffer.from`, which lands at
 * whatever offset the rest of the process left behind — the premise guard
 * below would then pass or fail by luck (same reasoning as
 * `stored-nodes.spec.ts`).
 */
const pooledNodes = () => {
  const bytes = compress(BESIGNER_NODES)
  const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
  const packed = pool.subarray(64, 64 + bytes.byteLength)
  packed.set(bytes)
  return packed
}

/**
 * The timestamp values a live document actually holds (AGL-1392).
 *
 * `doc.data()` hands back Admin `Timestamp` INSTANCES, and the suite used to
 * seed `{_seconds, _nanoseconds}` plain maps — which is the shape the bug
 * PRODUCES, so the round trip looked lossless because the seed was already
 * broken. Same mistake, and the same fix, as the plain-map `nodes` seed that
 * hid AGL-1391.
 *
 * `PUBLISHED_AT` carries sub-millisecond nanoseconds on purpose: an ISO-8601
 * wire form would truncate them silently, so this is the seed that makes the
 * "why not ISO" answer a fact rather than an opinion.
 *
 * `PUBLISH_AT` is deliberately in the PAST, so a pending schedule carrying it
 * is DUE and the scheduled-publish sweep must return the restored document.
 */
const PUBLISHED_AT = new Timestamp(1767323045, 123456789)
const PUBLISH_AT = new Timestamp(1767323045, 0)
const INSTALLED_AT = new Timestamp(1767300000, 0)

/**
 * `restored` names the value a field is expected to hold AFTER the round trip
 * when it differs from what was seeded. Only the compressed `nodes` needs it:
 * the bundle is meant to carry a readable map, so the restored document holds
 * the decoded tree rather than the bytes it was stored as.
 *
 * `dropped` names a field a live document legitimately carries that a restore
 * must deliberately NOT write — seeded because the export does emit it, and
 * asserted absent because restoring it would leave a dangling reference
 * (AGL-1392).
 */
const SEEDS: Array<{
  collection: string
  path: string
  id: string
  doc: Doc
  restored?: Doc
  dropped?: string[]
}> = [
  {
    collection: 'screens',
    path: 'hosts/host-1/screens',
    id: 'screen-1',
    doc: {
      displayName: 'Pricing',
      description: 'Plans and add-ons',
      slug: '/pricing',
      // Re-derived on import from displayName; seeded consistently so the
      // round trip is exact rather than merely close.
      nameLower: 'pricing',
      seo: { title: 'Pricing', description: 'Plans', image: 'https://cdn/x.png' },
      versionId: 'screen-version-1',
      parentId: 'screen-0',
      order: 3,
      layoutId: 'layout-1',
      publishedAt: PUBLISHED_AT,
      // A PENDING schedule whose time has passed — the state the sweep at
      // `apps/tenant/utils/publish-schedule-job.ts:77` exists to find.
      publishSchedule: {
        versionId: 'v2',
        action: 'publish',
        status: 'pending',
        publishAt: PUBLISH_AT,
      },
      visibility: 'password',
      protection: { passwordHash: 'a'.repeat(64) },
      locale: 'en',
      localeVariants: { es: 'screen-2' },
      kind: 'page',
      status: 'published',
      schedule: { startAt: null, endAt: null },
    },
  },
  {
    // Modern version shape: nodes as a plain map.
    collection: 'versions',
    path: 'hosts/host-1/screens/screen-1/versions',
    id: 'screen-version-1',
    doc: {
      displayName: 'Initial version',
      nodes: { root: { $id: 'root', componentId: 'div', nodes: [] } },
      rootId: 'root',
      screenId: 'screen-1',
      hostId: 'host-1',
    },
  },
  {
    /**
     * A screen whose published version was last saved through the BESIGNER —
     * the common case, and the one the suite had no seed for (AGL-1391).
     */
    collection: 'screens',
    path: 'hosts/host-1/screens',
    id: 'screen-2',
    doc: {
      displayName: 'Home',
      slug: '/',
      nameLower: 'home',
      versionId: 'screen-version-2',
    },
  },
  {
    /**
     * The COMPRESSED version shape, and the whole point of AGL-1391.
     *
     * The seed above it is honest about the FIELD surviving; it does not model
     * the STORAGE FORM, which is why this suite was green against a feature
     * that restores every besigner-saved page blank. `nodes` here is a pooled
     * Node `Buffer` because that is what the Admin SDK materialises a `Bytes`
     * field as, and the export reads `version.data()` with no converter.
     *
     * `JSON.stringify(Buffer)` yields `{"type":"Buffer","data":[…]}`. That
     * object is not an `ArrayBuffer` view, so `decodeStoredNodes` returns it
     * unchanged, nothing in it has a `componentId`, and NOTHING THROWS — the
     * restored page is simply empty. Silent, like AGL-1223 before it.
     */
    collection: 'versions',
    path: 'hosts/host-1/screens/screen-2/versions',
    id: 'screen-version-2',
    doc: {
      displayName: 'Besigner save',
      nodes: pooledNodes(),
      rootId: 'root',
      screenId: 'screen-2',
      hostId: 'host-1',
    },
    // A bundle must carry a readable tree, so the restore lands the decoded
    // map rather than the bytes.
    restored: { nodes: BESIGNER_NODES },
  },
  {
    collection: 'layouts',
    path: 'hosts/host-1/layouts',
    id: 'layout-1',
    doc: {
      displayName: 'Site chrome',
      description: 'Header and footer',
      versionId: 'layout-version-1',
      layoutId: 'layout-parent',
      publishSchedule: {
        versionId: 'lv2',
        action: 'publish',
        status: 'pending',
        publishAt: PUBLISH_AT,
      },
    },
  },
  {
    /**
     * PRE-MIGRATION version shape, and the reason this seed exists at all.
     * `elements` is a legacy alias for `nodes` migrated only inside
     * `screenVersionConverter` — and the export reads `version.data()` RAW,
     * with no converter. A version not re-saved since that migration ships
     * `elements` and no `nodes`, so an allow-list without it restores the page
     * EMPTY. Same for the `bundleId`/`pluginId` pair beside it.
     */
    collection: 'versions',
    path: 'hosts/host-1/layouts/layout-1/versions',
    id: 'layout-version-1',
    doc: {
      displayName: 'Legacy layout version',
      elements: { root: { $id: 'root', componentId: 'div', nodes: [] } },
      rootId: 'root',
      layoutId: 'layout-1',
      hostId: 'host-1',
      componentId: 'component-1',
      pluginId: 'mui',
      bundleId: 'mui',
    },
  },
  {
    collection: 'components',
    path: 'hosts/host-1/components',
    id: 'component-1',
    doc: {
      displayName: 'Site nav',
      description: 'Shared navigation',
      // Neither of these is in the create allow-list — both arrive only by
      // update, so a list seeded from RESOURCES.reusableComponent would erase
      // them on every restore.
      icon: { iconId: 'menu', iconPath: 'M0 0h24v24H0z' },
      props: [{ name: 'label', type: 'text' }],
      rootId: 'root',
      nodes: { root: { $id: 'root', componentId: 'div', nodes: [] } },
      // Seeded because a live component genuinely carries it — and DROPPED on
      // restore, because the bundle carries no component version for it to
      // name (AGL-1392).
      versionId: 'component-version-1',
      marketplace: { listingId: 'listing-1', profileId: 'profile-1', version: '1.2.0' },
      installedFrom: {
        listingId: 'listing-1',
        version: '1.2.0',
        sha256: 'abc123',
        artifactType: 'component',
        // `serverTimestamp()` at marketplace/server/provenance.ts:64 — a real
        // Timestamp, NESTED inside a map, which is why the codec walks deep
        // rather than naming known fields.
        installedAt: INSTALLED_AT,
        publisherOrgId: 'org-9',
      },
      detachedFrom: { listingId: 'listing-0', version: '1.0.0' },
      publishSchedule: {
        versionId: 'cv2',
        status: 'pending',
        publishAt: PUBLISH_AT,
      },
      kind: 'component',
    },
    dropped: ['versionId'],
  },
  {
    collection: 'variables',
    path: 'hosts/host-1/variables',
    id: 'variable-1',
    doc: {
      name: 'supportEmail',
      type: 'text',
      value: 'help@example.com',
      workflowId: 'workflow-1',
      workflowName: 'Compute support address',
    },
  },
  {
    collection: 'functions',
    path: 'hosts/host-1/functions',
    id: 'function-1',
    doc: {
      name: 'lineTotal',
      parameters: [{ name: 'P1', type: 'number', required: true }],
      variables: [{ name: 'P3', type: 'number' }],
      operations: [
        {
          if: { left: 'P1', comparator: '<=', right: '0' },
          then: [{ set: 'P3', expression: '0' }],
          otherwise: [],
        },
      ],
      returnValue: 'P3',
    },
  },
  {
    collection: 'workflows',
    path: 'hosts/host-1/workflows',
    id: 'workflow-1',
    doc: {
      name: 'Notify on order',
      steps: [{ functionName: 'lineTotal', args: ['1'], resultName: 'step1' }],
      returnValue: 'step1',
      // A CLEARED trigger is written as a literal null by the edit path, so
      // absence and null are different states — the filter must drop only
      // `undefined`, or clearing a trigger stops surviving a restore.
      trigger: null,
    },
  },
  {
    collection: 'actions',
    path: 'hosts/host-1/actions',
    id: 'action-1',
    doc: {
      name: 'Open the signup dialog',
      trigger: {
        event: 'click',
        selector: '#cta',
        oncePerVisitor: true,
        conditions: [{ left: 'path', comparator: '==', right: '/' }],
        combinator: 'and',
      },
      steps: [{ type: 'openDialog', dialogId: 'signup' }],
      enabled: true,
    },
  },
  {
    collection: 'services',
    path: 'hosts/host-1/services',
    id: 'service-1',
    doc: {
      name: 'Consultation',
      description: 'Intro call',
      durationMinutes: 30,
      priceUsd: 0,
      timezone: 'America/Chicago',
      windows: { 1: [{ start: 540, end: 1020 }] },
    },
  },
  {
    collection: 'collections',
    path: 'hosts/host-1/collections',
    id: 'collection-1',
    doc: {
      kind: 'content',
      slug: 'blog',
      displayName: 'Blog',
      listScreenId: 'screen-1',
      entryScreenId: 'screen-2',
      templateScreenId: 'screen-3',
      // Entries reference the stable category id, so dropping this orphans
      // the taxonomy of every entry in the collection.
      categories: [{ id: 'category-1', name: 'Releases' }],
    },
  },
  {
    collection: 'collections',
    path: 'hosts/host-1/collections',
    id: 'collection-2',
    doc: {
      kind: 'catalog',
      slug: 'winter',
      name: 'Winter',
      description: 'Cold weather',
      mode: 'smart',
      productIds: ['product-1'],
      rules: [{ field: 'categoryId', comparator: '==', value: 'category-1' }],
      matchAll: true,
      imageUrl: 'https://cdn/winter.png',
      order: 2,
    },
  },
  {
    collection: 'entries',
    path: 'hosts/host-1/collections/collection-1/entries',
    id: 'entry-1',
    doc: {
      title: 'Shipping the export',
      slug: 'shipping-the-export',
      excerpt: 'A short summary',
      body: '# Heading\n\nBody copy.',
      coverImage: 'https://cdn/cover.png',
      seoTitle: 'Shipping the export',
      seoDescription: 'How the bundle works',
      authorName: 'Zach',
      categoryId: 'category-1',
      category: 'Releases',
      tags: ['release'],
      // `listLiveEntries` queries on this, so an entry restored without one
      // is invisible on the live site.
      status: 'published',
      publishedAt: PUBLISHED_AT,
      // What `isLive` reads through `.seconds` (get-collection-content.ts:143).
      publishAt: PUBLISH_AT,
    },
  },
  {
    collection: 'datasets',
    path: 'orgs/org-1/datasets',
    id: 'dataset-1',
    doc: {
      displayName: 'Roasts',
      name: 'Roasts',
      fields: ['roast'],
      // Drop this and every restored dataset silently degrades to the derived
      // all-text v1 model, losing types, required, validation and references.
      model: {
        fields: { roast: { name: 'Roast', type: 'text', required: true } },
        order: ['roast'],
      },
      names: { singular: 'Roast', plural: 'Roasts' },
      description: 'Coffee roast levels',
      source: { type: 'marketplace', listingId: 'listing-2', version: '1.0.0' },
      installedFrom: {
        listingId: 'listing-2',
        version: '1.0.0',
        sha256: 'def456',
        artifactType: 'dataset',
        installedAt: 1767323045,
        publisherOrgId: 'org-9',
      },
      detachedFrom: { listingId: 'listing-3', version: '0.9.0' },
    },
  },
  {
    collection: 'records',
    path: 'orgs/org-1/datasets/dataset-1/records',
    id: 'record-1',
    // `order` is what sortDatasetRecords sorts by, so dropping it reorders
    // every repeatable on the restored site.
    doc: { values: { roast: 'Dark' }, order: 4 },
  },
  {
    /**
     * The folder tree the media manifest references (AGL-1392).
     *
     * `orgs/{orgId}/mediaFolders` was in neither `EXPORT_COLLECTION_LIMITS` nor
     * the export's `Promise.all`, while `media.folderId` was (correctly)
     * restorable — so every restored asset pointed at a folder document the
     * bundle provably did not contain. Same class as AGL-1046/AGL-1050: a
     * referenced collection nobody added to the manifest.
     */
    collection: 'mediaFolders',
    path: 'orgs/org-1/mediaFolders',
    id: 'folder-1',
    doc: { name: 'Brand', parentId: null },
  },
  {
    // Nested, so the restore has to carry the hierarchy and not just the names.
    collection: 'mediaFolders',
    path: 'orgs/org-1/mediaFolders',
    id: 'folder-2',
    doc: { name: 'Logos', parentId: 'folder-1' },
  },
  {
    collection: 'media',
    path: 'orgs/org-1/media',
    id: 'media-1',
    doc: {
      fileName: 'hero.png',
      contentType: 'image/png',
      sizeBytes: 20480,
      url: 'https://firebasestorage.example/hero.png?alt=media&token=t',
      storagePath: 'orgs/org-1/media/hero.png',
      folderId: 'folder-1',
      folder: 'Legacy folder',
      tags: ['hero'],
      alt: 'A hero image',
      description: 'Home page hero',
      width: 1600,
      height: 900,
      contentHash: 'sha256-abc',
      variants: [{ width: 800, url: 'https://cdn/hero-800.webp' }],
      cdnPath: '/api/media/cdn/media-1',
      customMetadata: { campaign: 'launch' },
      private: false,
    },
  },
]

const HOST_DOC = {
  memberRoles: { 'user-1': 'admin' },
  orgId: 'org-1',
  subdomain: 'acme',
  displayName: 'Acme',
  seo: { title: 'Acme' },
  theme: { primary: '#123456' },
  screens: { '/': 'screen-1' },
  layouts: { chrome: 'layout-1' },
  notFoundScreenId: 'screen-404',
  errorScreens: { 500: 'screen-500' },
  analytics: { provider: 'plausible' },
}

const resetStore = () => {
  store.clear()
  writes.length = 0
  seed('hosts', 'host-1', HOST_DOC)
  for (const entry of SEEDS) seed(entry.path, entry.id, entry.doc)
}

const runExport = async () => {
  const response = await EXPORT_GET(
    new Request('https://app.aglyn.com/api/hosts/export?hostId=host-1', {
      headers: { authorization: 'Bearer tok' },
    }),
  )
  expect(response.status).toBe(200)
  // Through JSON, exactly as the browser downloads it and hands it back.
  return JSON.parse(await response.text())
}

const runImport = async (bundle: unknown) => {
  writes.length = 0
  const response = await IMPORT_POST(
    new Request('https://app.aglyn.com/api/hosts/import', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1', bundle }),
    }),
  )
  expect(response.status).toBe(200)
  return response
}

/** Applies a mutation to every document in the bundle, at every depth. */
const mutateEveryDocument = (bundle: any, mutate: (doc: any) => void) => {
  for (const value of Object.values(bundle)) {
    if (!Array.isArray(value)) continue
    for (const item of value as any[]) {
      if (!item || typeof item !== 'object') continue
      mutate(item)
      if (item.version) mutate(item.version)
      for (const child of [...(item.entries ?? []), ...(item.records ?? [])]) {
        mutate(child)
      }
    }
  }
  return bundle
}

beforeEach(() => {
  jest.clearAllMocks()
  resetStore()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe('the export/import round trip is lossless (AGL-1382)', () => {
  it('exports every seeded collection', async () => {
    const bundle = await runExport()
    expect(bundle.format).toBe('aglyn-site-export')
    // The bundle really does carry the documents the assertions below rely on
    // — an empty export would make every round-trip test vacuously green.
    expect(bundle.screens).toHaveLength(2)
    expect(bundle.screens[0].version.$id).toBe('screen-version-1')
    expect(bundle.screens[1].version.$id).toBe('screen-version-2')
    expect(bundle.layouts[0].version.$id).toBe('layout-version-1')
    expect(bundle.collections[0].entries).toHaveLength(1)
    expect(bundle.datasets[0].records).toHaveLength(1)
    expect(bundle.media).toHaveLength(1)
  })

  describe.each(SEEDS)('$collection/$id', ({ path, id, doc, restored, dropped }) => {
    it('restores every field it was exported with', async () => {
      const bundle = await runExport()
      await runImport(bundle)
      const stored = storedAt(`${path}/${id}`)
      expect(stored).toBeDefined()
      // Field by field rather than a whole-object match: the failure message
      // then names the key that stopped round-tripping.
      for (const [key, value] of Object.entries({ ...doc, ...restored })) {
        if (dropped?.includes(key)) continue
        /**
         * `toStrictEqual`, not `toEqual` — and this is the whole AGL-1392
         * trap in one line.
         *
         * An Admin `Timestamp`'s own enumerable keys are EXACTLY `_seconds`
         * and `_nanoseconds`, which is also exactly what `JSON.stringify`
         * makes of it. `toEqual` ignores prototypes, so it reports the
         * degraded plain map and a live `Timestamp` as EQUAL — a field-by-
         * field positive control written with it is green against a round
         * trip that silently changes the type of every date in the bundle.
         * `toStrictEqual` compares the class too.
         */
        expect({ [key]: stored[key] }).toStrictEqual({ [key]: value })
      }
      for (const key of dropped ?? []) {
        expect({ key, present: key in stored }).toEqual({ key, present: false })
      }
    })
  })

  it('re-mints updatedAt rather than restoring the exported one', async () => {
    const bundle = await runExport()
    await runImport(bundle)
    expect(storedAt('hosts/host-1/screens/screen-1')['updatedAt']).toBe(
      mockServerTimestamp,
    )
  })

  it('restores host settings through the exportable-field list', async () => {
    const bundle = await runExport()
    await runImport(bundle)
    const stored = storedAt('hosts/host-1')
    expect(stored['displayName']).toBe('Acme')
    expect(stored['analytics']).toEqual({ provider: 'plausible' })
    // Host identity never travels, in either direction.
    expect(stored).not.toHaveProperty('memberRoles')
    expect(stored).not.toHaveProperty('subdomain')
    expect(stored).not.toHaveProperty('orgId')
  })

  it('assigns a fresh host scope to org-owned documents', async () => {
    const bundle = await runExport()
    // A bundle is portable: honouring an embedded org-wide scope on restore
    // would publish one org's data across another agency's client roster.
    bundle.media[0].visibleTo = ['org']
    bundle.datasets[0].visibleTo = ['org']
    await runImport(bundle)
    expect(storedAt('orgs/org-1/media/media-1')['visibleTo']).toEqual([
      'host:host-1',
    ])
    expect(storedAt('orgs/org-1/datasets/dataset-1')['visibleTo']).toEqual([
      'host:host-1',
    ])
  })
})

/**
 * AGL-1391: a besigner-saved page must survive a backup.
 *
 * The differentiator feature (AGL-163, "HubSpot famously has no site backup")
 * was restoring EVERY besigner-saved screen and layout blank. The export read
 * `version.data()` raw, `JSON.stringify` turned the Node `Buffer` into
 * `{"type":"Buffer","data":[…]}`, and the import wrote that object back as the
 * document's `nodes`. No error anywhere — a backup that reads as a success and
 * restores nothing.
 */
describe('a besigner-saved version survives the round trip (AGL-1391)', () => {
  const VERSION_PATH = 'hosts/host-1/screens/screen-2/versions/screen-version-2'

  it('is seeded in the compressed storage form, not a plain map', () => {
    // Guard the premise. A seed that quietly became a plain map would make
    // every assertion below pass against the broken route — which is the
    // precise reason this suite was green before AGL-1391.
    const seeded = store.get('hosts/host-1/screens/screen-2/versions')
      .get('screen-version-2')['nodes'] as Buffer
    expect(ArrayBuffer.isView(seeded)).toBe(true)
    // Pooled, like firebase-admin's: a zero-offset buffer would let the
    // byteOffset bug decode the whole pool and still look fine here.
    expect(seeded.byteOffset).toBeGreaterThan(0)
    expect(seeded.buffer.byteLength).toBeGreaterThan(seeded.byteLength)
  })

  it('exports a readable node map rather than a Buffer envelope', async () => {
    const bundle = await runExport()
    const version = bundle.screens.find((s: any) => s.$id === 'screen-2').version

    // The exact broken shape, pinned so it cannot come back green.
    expect(version.nodes).not.toHaveProperty('type', 'Buffer')
    expect(version.nodes).not.toHaveProperty('data')
    expect(version.nodes).toEqual(BESIGNER_NODES)
  })

  it('restores a node map with a reachable root', async () => {
    const bundle = await runExport()
    await runImport(bundle)
    const stored = storedAt(VERSION_PATH)
    const nodes = stored['nodes'] as Record<string, any>

    // "The key survived" is what the pre-AGL-1391 suite proved, and it is not
    // enough: `{type:'Buffer'}` is a present `nodes` too. A page renders only
    // if the root resolves and its children are real nodes.
    expect(nodes[stored['rootId'] as string]).toBeDefined()
    expect(nodes[stored['rootId'] as string].componentId).toBe('container')
    for (const childId of nodes[stored['rootId'] as string].nodes) {
      expect({ childId, componentId: nodes[childId]?.componentId }).toEqual({
        childId,
        componentId: 'typography',
      })
    }
    expect(nodes).toEqual(BESIGNER_NODES)
  })

  it('restores an already-downloaded bundle that carries the Buffer envelope', async () => {
    // Belt and braces (AGL-1391). Decoding on export cannot help a bundle a
    // customer downloaded BEFORE the fix — that file is on their disk and
    // already carries the opaque blob. Restoring one has to work, because the
    // only time anyone opens a year-old backup is the day they need it.
    const bundle = await runExport()
    const version = bundle.screens.find((s: any) => s.$id === 'screen-2').version
    version.nodes = JSON.parse(JSON.stringify(pooledNodes()))
    // Precisely the shape an old bundle carries.
    expect(version.nodes.type).toBe('Buffer')

    await runImport(bundle)
    const nodes = storedAt(VERSION_PATH)['nodes'] as Record<string, any>
    expect(nodes['root']?.componentId).toBe('container')
    expect(nodes).toEqual(BESIGNER_NODES)
  })
})

/**
 * AGL-1392 gap 1: a restored publish schedule must still FIRE.
 *
 * `JSON.stringify` on an Admin `Timestamp` yields `{_seconds, _nanoseconds}`,
 * so every date in a bundle came back as a plain MAP. The consequence is not
 * cosmetic and it is not "the field is missing" — the field is right there,
 * holding the right numbers, in the wrong type:
 *
 * * `publishSchedule.publishAt <= now` is a RANGE query
 *   (`apps/tenant/utils/publish-schedule-job.ts:77-78`). Firestore orders by
 *   type before value and maps sort after timestamps, so the sweep never
 *   returns the restored screen and the schedule never fires. A restored site
 *   looks correct and silently stops publishing.
 * * Every reader that got the document anyway reads `.seconds`, which a
 *   `_seconds` map does not have — and the two readers degrade in OPPOSITE
 *   directions. `applyDuePublishSchedule` (`apply-publish-schedule.ts:39`)
 *   does `(publishAt?.seconds ?? 0) * 1000`, so `undefined` becomes 0 and
 *   every restored schedule reads as already due. `isLive`
 *   (`get-collection-content.ts:143`) does `?? POSITIVE_INFINITY`, so a
 *   restored scheduled ENTRY is never live.
 *
 * The repo already knew about this decay in another door: `get-screen.ts:89`
 * refuses to ISR-cache a doc with a pending schedule precisely because "the
 * JSON round trip a cache hit implies decays that to `_seconds`". The export
 * path had no such guard.
 */
describe('a restored publish schedule still fires (AGL-1392)', () => {
  const SCREEN_PATH = 'hosts/host-1/screens/screen-1'
  const ENTRY_PATH = 'hosts/host-1/collections/collection-1/entries/entry-1'

  /** Land the restore, so the sweep below reads what an import actually left. */
  const applyWritesToStore = () => {
    for (const { path, data } of writes) {
      const cut = path.lastIndexOf('/')
      seed(path.slice(0, cut), path.slice(cut + 1), data)
    }
  }

  /**
   * The scheduled-publish sweep, verbatim from
   * `apps/tenant/utils/publish-schedule-job.ts:77-78`. Modelled rather than
   * imported because that job lives in `apps/tenant` and registers itself
   * against `next/cache`; what has to be faithful is the FILTER, and
   * `matchesFilter` above is where that faithfulness lives.
   */
  const runDueSweep = () =>
    (mockFirestore as any)
      .collection('hosts/host-1/screens')
      .where('publishSchedule.status', '==', 'pending')
      .where('publishSchedule.publishAt', '<=', new Date())
      .limit(100)
      .get()

  it('is seeded as a real Timestamp, and the sweep can tell the difference', async () => {
    // Guard the premise, twice — the AGL-1391 lesson. A seed that quietly
    // became a `{_seconds}` map, or a query model that compared with plain
    // JavaScript `<=`, would make every assertion below pass against the bug.
    expect(
      store.get('hosts/host-1/screens').get('screen-1')['publishedAt'],
    ).toBeInstanceOf(Timestamp)

    expect((await runDueSweep()).docs.map((doc: any) => doc.id)).toEqual([
      'screen-1',
    ])

    // The degraded shape, in the same query, must NOT come back. This is the
    // assertion that makes the model worth anything.
    seed('hosts/host-1/screens', 'screen-1', {
      publishSchedule: {
        status: 'pending',
        publishAt: { _seconds: PUBLISH_AT.seconds, _nanoseconds: 0 },
      },
    })
    expect((await runDueSweep()).docs).toHaveLength(0)
  })

  it('carries a tagged wire form rather than the SDK private fields', async () => {
    const bundle = await runExport()
    const publishedAt = bundle.screens.find((s: any) => s.$id === 'screen-1')
      .publishedAt

    // The exact broken shape, pinned so it cannot come back green.
    expect(publishedAt).not.toHaveProperty('_seconds')
    expect(publishedAt).toEqual({
      type: 'firestore/timestamp/1.0',
      seconds: PUBLISHED_AT.seconds,
      nanoseconds: PUBLISHED_AT.nanoseconds,
    })
  })

  it('restores publishAt as a Timestamp the due sweep RETURNS', async () => {
    const bundle = await runExport()
    await runImport(bundle)
    applyWritesToStore()

    // Not "the field round-tripped" — `{_seconds}` round-trips as something
    // too. The question is whether the scheduled-publish beat can see it.
    const due = await runDueSweep()
    expect(due.docs.map((doc: any) => doc.id)).toEqual(['screen-1'])

    const schedule = storedAt(SCREEN_PATH)['publishSchedule'] as any
    expect(schedule.publishAt).toBeInstanceOf(Timestamp)
    // And the executor's own arithmetic, verbatim from
    // `apply-publish-schedule.ts:39`. Against the bug `.seconds` is undefined,
    // so this collapses to 0 — every restored schedule "already due".
    expect((schedule.publishAt?.seconds ?? 0) * 1000).toBe(
      PUBLISH_AT.seconds * 1000,
    )
  })

  it('restores a scheduled entry that isLive still counts as live', async () => {
    const bundle = await runExport()
    await runImport(bundle)
    const stored = storedAt(ENTRY_PATH)

    expect(stored['publishAt']).toBeInstanceOf(Timestamp)
    // `isLive`, verbatim from `get-collection-content.ts:143`. Against the bug
    // the `?? POSITIVE_INFINITY` fallback fires and the entry is never live —
    // the opposite direction from the screen executor, from the same cause.
    const publishAtMs =
      ((stored['publishAt'] as any)?.seconds ?? Number.POSITIVE_INFINITY) * 1000
    expect(publishAtMs <= Date.now()).toBe(true)
  })

  it('keeps nanosecond precision an ISO string would have truncated', async () => {
    const bundle = await runExport()
    await runImport(bundle)
    // 123456789ns is not representable in ISO-8601 milliseconds. Serialising
    // dates as `.toISOString()` would round this and nobody would notice.
    expect(storedAt(SCREEN_PATH)['publishedAt']).toStrictEqual(PUBLISHED_AT)
  })

  it('revives a nested timestamp, not just the fields anyone listed', async () => {
    const bundle = await runExport()
    await runImport(bundle)
    // `installedFrom.installedAt` is a `serverTimestamp()` two levels down in
    // a map. A codec that named known top-level fields would miss it, which is
    // how this class of gap gets filed in the first place.
    const installedFrom = storedAt('hosts/host-1/components/component-1')[
      'installedFrom'
    ] as any
    expect(installedFrom.installedAt).toBeInstanceOf(Timestamp)
    expect(installedFrom.installedAt).toStrictEqual(INSTALLED_AT)
  })

  it('restores an already-downloaded bundle carrying the _seconds envelope', async () => {
    // Belt and braces, exactly as AGL-1391 argued: fixing the export cannot
    // reach a file already on a customer's disk, and the only day anyone opens
    // a year-old backup is the day they need it.
    const bundle = await runExport()
    const screen = bundle.screens.find((s: any) => s.$id === 'screen-1')
    screen.publishedAt = { _seconds: PUBLISHED_AT.seconds, _nanoseconds: 7 }
    screen.publishSchedule.publishAt = {
      _seconds: PUBLISH_AT.seconds,
      _nanoseconds: 0,
    }

    await runImport(bundle)
    applyWritesToStore()
    expect((await runDueSweep()).docs.map((doc: any) => doc.id)).toEqual([
      'screen-1',
    ])
    expect(storedAt(SCREEN_PATH)['publishedAt']).toStrictEqual(
      new Timestamp(PUBLISHED_AT.seconds, 7),
    )
  })

  it('does not turn a date-shaped STRING into a Timestamp', async () => {
    // The reason the wire form is tagged rather than an ISO string. A bare
    // `2026-01-02T…Z` in a bundle is indistinguishable from a user's text, so
    // reviving by pattern would silently retype authored content — the same
    // class of bug in the opposite direction.
    const bundle = await runExport()
    bundle.collections[0].entries[0].body = '2026-01-02T04:24:05.000Z'
    bundle.collections[0].entries[0].title = PUBLISHED_AT.toDate().toISOString()
    await runImport(bundle)

    const stored = storedAt(ENTRY_PATH)
    expect(typeof stored['body']).toBe('string')
    expect(typeof stored['title']).toBe('string')
  })
})

/**
 * AGL-1392 gap 2: `orgs/{orgId}/mediaFolders` was in no list at all.
 *
 * Not in `EXPORT_COLLECTION_LIMITS`, not in the export's `Promise.all`, not in
 * `IMPORTABLE_FIELDS` — while `media.folderId` was (correctly) restorable. So
 * every restored asset pointed at a folder document the bundle provably did
 * not contain, and a dangling `folderId` is not merely untidy: the DAM's root
 * view filters OUT anything with a truthy `folderId`, so the asset is in no
 * folder and not at root either.
 */
describe('the media folder tree survives the round trip (AGL-1392)', () => {
  it('exports the folders the manifest references', async () => {
    const bundle = await runExport()
    expect(bundle.mediaFolders).toHaveLength(2)
    // The referenced folder is IN the bundle — the whole point.
    const referenced = bundle.media[0].folderId
    expect(bundle.mediaFolders.map((f: any) => f.$id)).toContain(referenced)
  })

  it('restores the hierarchy and assigns a fresh host scope', async () => {
    const bundle = await runExport()
    bundle.mediaFolders[0].visibleTo = ['org']
    await runImport(bundle)

    expect(storedAt('orgs/org-1/mediaFolders/folder-1')).toMatchObject({
      name: 'Brand',
      parentId: null,
      visibleTo: ['host:host-1'],
    })
    // Nesting, not just names.
    expect(storedAt('orgs/org-1/mediaFolders/folder-2')['parentId']).toBe(
      'folder-1',
    )
  })

  it('drops a parentId no folder in the bundle or the org holds', async () => {
    // A folder whose parent is missing is unreachable in the tree — invisible
    // rather than misplaced. Root is recoverable by dragging; invisible is not.
    const bundle = await runExport()
    bundle.mediaFolders[1].parentId = 'folder-that-was-never-exported'
    await runImport(bundle)
    expect(storedAt('orgs/org-1/mediaFolders/folder-2')['parentId']).toBeNull()
  })

  it('keeps a parentId the TARGET org already holds', async () => {
    // The other direction, and the reason this is a read rather than a guess:
    // a folder scoped to a sibling host is not in the bundle but IS in the
    // org, so nulling it would reparent a folder that was never broken.
    seed('orgs/org-1/mediaFolders', 'folder-sibling', { name: 'Sibling' })
    const bundle = await runExport()
    bundle.mediaFolders = bundle.mediaFolders.filter(
      (folder: any) => folder.$id !== 'folder-sibling',
    )
    bundle.mediaFolders[1].parentId = 'folder-sibling'
    await runImport(bundle)
    expect(storedAt('orgs/org-1/mediaFolders/folder-2')['parentId']).toBe(
      'folder-sibling',
    )
  })

  it('drops a media folderId that would dangle', async () => {
    const bundle = await runExport()
    bundle.media[0].folderId = 'folder-that-was-never-exported'
    await runImport(bundle)
    // Not "left pointing at nothing": at root the asset is filtered out of the
    // grid entirely, so a dangling pointer HIDES the asset.
    expect(storedAt('orgs/org-1/media/media-1')['folderId']).toBeNull()
  })
})

/**
 * AGL-1392 gap 3: a restored component's `versionId` dangles, and defeats the
 * self-heal that would otherwise fix it.
 *
 * The export carries version subdocuments for screens and layouts ONLY, but
 * `components.versionId` was restorable — so a restored component pointed at a
 * version document the bundle provably did not contain.
 *
 * Unlike screens, that pointer is not on the render path at all: the tenant
 * reads `nodes`/`rootId`/`props` straight off the component DOCUMENT
 * (`get-components.ts:47-63`) and never opens a version. What a dangling
 * pointer breaks is EDITING — and permanently, because both "mint version 1"
 * fallbacks are guarded on `!versionId` (component detail page and
 * `host-components-card.component.tsx:262`), which a dangling id satisfies.
 * Dropping it on import is what lets the existing self-heal fire.
 */
describe('a restored component can still be edited (AGL-1392)', () => {
  it('does not restore a versionId the bundle carries no version for', async () => {
    const bundle = await runExport()
    // The export really does ship it — this is about the import, not the file.
    expect(bundle.components[0].versionId).toBe('component-version-1')

    await runImport(bundle)
    const stored = storedAt('hosts/host-1/components/component-1')
    expect(stored).not.toHaveProperty('versionId')
    // The tree still restores: the component document is the renderable one.
    expect(stored['rootId']).toBe('root')
    expect(stored['nodes']).toEqual({
      root: { $id: 'root', componentId: 'div', nodes: [] },
    })
  })

  it('leaves no version pointer anywhere without its version document', async () => {
    // The invariant, rather than a fact about one collection: a restored
    // pointer is legitimate only when the same import wrote the document it
    // names. Screens and layouts pass because the export attaches
    // `item.version`; components pass by not restoring the pointer at all.
    const bundle = await runExport()
    await runImport(bundle)

    for (const { path, id, collection } of SEEDS) {
      if (!['screens', 'layouts', 'components'].includes(collection)) continue
      const stored = storedAt(`${path}/${id}`)
      const versionId = stored?.['versionId']
      if (!versionId) continue
      expect({
        path,
        versionId,
        written: Boolean(storedAt(`${path}/${id}/versions/${versionId}`)),
      }).toEqual({ path, versionId, written: true })
    }
  })
})

/**
 * Keys no export produces and no collection should store. `$id` is the one
 * AGL-1374 found leaking into stored documents from a listener spread;
 * `createdAt`/`updatedAt` are stamped server-side; `deletedAt` is what the
 * soft-delete caps count and what the export deliberately filters out;
 * `staff`/`role` are the shape of a field a later feature makes load-bearing.
 */
const UNEXPECTED = {
  $id: 'synthetic-id',
  createdAt: 1,
  updatedAt: 2,
  deletedAt: { _seconds: 1, _nanoseconds: 0 },
  staff: true,
  role: 'admin',
  memberRoles: { 'attacker-1': 'admin' },
}

describe('an unexpected key in a bundle is not stored (AGL-1382)', () => {
  it('drops it from every document in the bundle', async () => {
    const bundle = mutateEveryDocument(await runExport(), (doc) => {
      Object.assign(doc, UNEXPECTED)
    })
    await runImport(bundle)

    // Every subcollection write, not a sampled one: the deny-list stored all
    // of these verbatim, so a spot check would have passed against it too.
    const subcollectionWrites = writes.filter(
      (entry) => entry.path !== 'hosts/host-1',
    )
    expect(subcollectionWrites.length).toBe(SEEDS.length)
    for (const { path, data } of subcollectionWrites) {
      expect({ path, key: '$id' in data }).toEqual({ path, key: false })
      expect({ path, key: 'deletedAt' in data }).toEqual({ path, key: false })
      expect({ path, key: 'staff' in data }).toEqual({ path, key: false })
      expect({ path, key: 'role' in data }).toEqual({ path, key: false })
      expect({ path, key: 'memberRoles' in data }).toEqual({ path, key: false })
      expect({ path, key: 'createdAt' in data }).toEqual({ path, key: false })
      // Stamped, never taken from the bundle — a file's clock is not a fact
      // about the document it restores into.
      expect({ path, updatedAt: data['updatedAt'] }).toEqual({
        path,
        updatedAt: mockServerTimestamp,
      })
    }
  })

  it('still restores every legitimate field from the same bundle', async () => {
    // The drop must be surgical: a route that answered the test above by
    // storing nothing would pass it and fail this.
    //
    // `$id` is left off here alone. It is the one "unexpected" key that is
    // not junk — the import keys each document BY it (a restore is additive
    // by id, so links keep resolving), it just must never be stored as a
    // field. Injecting it would re-point every document at one id and this
    // assertion would be looking up paths that no longer exist.
    const { $id: _id, ...unexpectedFields } = UNEXPECTED
    const bundle = mutateEveryDocument(await runExport(), (doc) => {
      Object.assign(doc, unexpectedFields)
    })
    await runImport(bundle)
    for (const { path, id, doc, dropped } of SEEDS) {
      const stored = storedAt(`${path}/${id}`)
      for (const key of Object.keys(doc)) {
        if (dropped?.includes(key)) continue
        expect({ path, key, present: key in stored }).toEqual({
          path,
          key,
          present: true,
        })
      }
    }
  })

  it('does not restore a soft-delete tombstone onto a live document', async () => {
    // The export filters deleted documents, so `deletedAt` can only reach the
    // import from a hand-edited bundle — where restoring it would make the
    // document invisible with no error at all.
    const bundle = await runExport()
    bundle.screens[0].deletedAt = { _seconds: 1, _nanoseconds: 0 }
    await runImport(bundle)
    const stored = storedAt('hosts/host-1/screens/screen-1')
    expect(stored).not.toHaveProperty('deletedAt')
    expect(stored['displayName']).toBe('Pricing')
  })

  it('rejects a collection with no declared allow-list rather than storing it', async () => {
    // Fail-closed would be silent total data loss for that collection, so an
    // undeclared name is a 500, not an empty write.
    const declared = Object.keys(IMPORTABLE_FIELDS)
    for (const name of [
      'screens',
      'layouts',
      'versions',
      'components',
      'variables',
      'functions',
      'workflows',
      'actions',
      'services',
      'collections',
      'entries',
      'datasets',
      'records',
      'media',
      // The collection that was in neither list at all (AGL-1392).
      'mediaFolders',
    ]) {
      expect({ name, declared: declared.includes(name) }).toEqual({
        name,
        declared: true,
      })
    }
  })
})

describe('every permitted field is one a document actually carries (AGL-1382)', () => {
  it('exercises each allow-listed key with a real seeded document', () => {
    // The AGL-1384 property, held by a test: a key nobody can point at a
    // document for is a key nobody can defend, and it cannot sit on the list
    // unnoticed. If this fails, either the seed is incomplete or the field is
    // the one to delete.
    const seeded: Record<string, Set<string>> = {}
    for (const { collection, doc } of SEEDS) {
      seeded[collection] ??= new Set()
      for (const key of Object.keys(doc)) seeded[collection].add(key)
    }
    for (const [collection, fields] of Object.entries(IMPORTABLE_FIELDS)) {
      for (const field of fields) {
        expect({ collection, field, seeded: seeded[collection]?.has(field) }).toEqual(
          { collection, field, seeded: true },
        )
      }
    }
  })
})
