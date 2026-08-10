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

function collectionRef(path: string): any {
  const ref: any = {
    path,
    limit: () => ref,
    where: () => ref,
    select: () => ref,
    get: async () => ({
      docs: [...(store.get(path) ?? new Map()).entries()].map(([id, data]) =>
        snapshotOf(path, id, data),
      ),
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

/**
 * A fully-populated document of every shape the bundle carries, keyed by the
 * collection path it lives on. Every field here was read off a real write path
 * (create route, client-direct update, or marketplace install) — narrowing the
 * allow-list past any of them loses site content on restore with no error.
 */
const SEEDS: Array<{ collection: string; path: string; id: string; doc: Doc }> = [
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
      publishedAt: { _seconds: 1767323045, _nanoseconds: 0 },
      publishSchedule: { versionId: 'v2', action: 'publish', status: 'pending' },
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
    collection: 'layouts',
    path: 'hosts/host-1/layouts',
    id: 'layout-1',
    doc: {
      displayName: 'Site chrome',
      description: 'Header and footer',
      versionId: 'layout-version-1',
      layoutId: 'layout-parent',
      publishSchedule: { versionId: 'lv2', action: 'publish', status: 'pending' },
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
      versionId: 'component-version-1',
      marketplace: { listingId: 'listing-1', profileId: 'profile-1', version: '1.2.0' },
      installedFrom: {
        listingId: 'listing-1',
        version: '1.2.0',
        sha256: 'abc123',
        artifactType: 'component',
        installedAt: 1767323045,
        publisherOrgId: 'org-9',
      },
      detachedFrom: { listingId: 'listing-0', version: '1.0.0' },
      publishSchedule: { versionId: 'cv2', status: 'pending' },
      kind: 'component',
    },
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
      publishedAt: { _seconds: 1767323045, _nanoseconds: 0 },
      publishAt: { _seconds: 1767323045, _nanoseconds: 0 },
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
    expect(bundle.screens).toHaveLength(1)
    expect(bundle.screens[0].version.$id).toBe('screen-version-1')
    expect(bundle.layouts[0].version.$id).toBe('layout-version-1')
    expect(bundle.collections[0].entries).toHaveLength(1)
    expect(bundle.datasets[0].records).toHaveLength(1)
    expect(bundle.media).toHaveLength(1)
  })

  describe.each(SEEDS)('$collection/$id', ({ path, id, doc }) => {
    it('restores every field it was exported with', async () => {
      const bundle = await runExport()
      await runImport(bundle)
      const stored = storedAt(`${path}/${id}`)
      expect(stored).toBeDefined()
      // Field by field rather than a whole-object match: the failure message
      // then names the key that stopped round-tripping.
      for (const [key, value] of Object.entries(doc)) {
        expect({ [key]: stored[key] }).toEqual({ [key]: value })
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
    for (const { path, id, doc } of SEEDS) {
      const stored = storedAt(`${path}/${id}`)
      for (const key of Object.keys(doc)) {
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
