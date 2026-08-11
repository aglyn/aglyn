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
 * AGL-1413: "Find where this is used" must not answer "nowhere" for an asset
 * that is on the live site.
 *
 * The panel is the control an author consults IMMEDIATELY BEFORE DELETING, so
 * every gap in it is a deletion hazard rather than a display bug. Measured in
 * the production org `jWmGooWE3L`: a full programmatic scan found 47 of 206
 * assets referenced, and the panel's coverage was a strict subset — it read
 * the LIVE version of screens and layouts plus collection entries, and nothing
 * else. Two live assets reported as used nowhere, and both are seeded here
 * under their real names, at their real reference sites:
 *
 * * `favicon.png` — the site's `seo.favicon`, held on the HOST DOCUMENT
 * * `besigner-canvas-mockup.png` — held by TWO reusable COMPONENTS
 *
 * ## Both traps in this area fail toward "unused"
 *
 * 1. `MEDIA_REF_PREFIX` is `media:`, not `media://`. A scan written against
 *    the wrong prefix matched 2 of 206 instead of 47 — acting on it would have
 *    deleted 45 live images. `mediaRefPattern` is therefore imported REAL
 *    here, never mocked, and `the wrong prefix finds nothing` pins the
 *    difference as an assertion.
 * 2. `nodes` has three storage forms, and the compressed one is the majority
 *    (AGL-1223/AGL-1391). Every version fixture below is seeded as POOLED
 *    msgpack `Bytes` with `byteOffset > 0`, because a plain-map-only fixture
 *    passes against the bug — both the two-storage-forms bug and the
 *    byteOffset bug.
 *
 * Since both failure directions point at "unused", the suite leads with a
 * POSITIVE CONTROL — an asset on a live version, which the endpoint already
 * found before this change. If that one ever goes green-by-accident the
 * harness itself is broken and nothing below it means anything.
 */

import {
  compress,
  formatMediaRef,
  MEDIA_REF_PREFIX,
  mediaRefPattern,
} from '@aglyn/aglyn/server'

const ORG_ID = 'jWmGooWE3L'
const HOST_ID = 'host-marketing'
const SUBDOMAIN = 'aglyn'

const mockVerifyIdToken = jest.fn()

type Doc = Record<string, any>

/**
 * An in-memory Firestore keyed by collection PATH, so a fixture lands where
 * production would put it — `hosts/{id}/components` and
 * `hosts/{id}/screens/{id}/versions` are different collections here for the
 * same reason they are there.
 */
const store = new Map<string, Map<string, Doc>>()

/**
 * Documents materialized by the scan.
 *
 * The panel runs this per asset on a user's click and again inside the delete
 * confirmation, so the read count is a product constraint, not trivia. Counted
 * rather than reasoned about: `reads` is what the assertions at the bottom
 * hold the design to.
 */
let reads = 0

const seed = (collectionPath: string, id: string, data: Doc) => {
  if (!store.has(collectionPath)) store.set(collectionPath, new Map())
  store.get(collectionPath).set(id, data)
}

/** Firestore reads a dotted path; `seo.favicon` is one field access there. */
const fieldAt = (data: Doc | undefined, path: string) =>
  path
    .split('.')
    .reduce<any>((value, key) => (value == null ? undefined : value[key]), data)

const snapshotOf = (path: string, id: string, data: Doc | undefined) => ({
  id,
  exists: data !== undefined,
  ref: docRef(path, id),
  data: () => data,
  get: (field: string) => fieldAt(data, field),
})

function collectionRef(path: string, filters: Array<[string, any]> = [], cap = Infinity): any {
  const ref: any = {
    path,
    where: (field: string, _op: string, value: any) =>
      collectionRef(path, [...filters, [field, value]], cap),
    limit: (next: number) => collectionRef(path, filters, next),
    select: () => ref,
    orderBy: () => ref,
    get: async () => {
      const all = [...(store.get(path) ?? new Map()).entries()]
        .filter(([, data]) =>
          filters.every(([field, value]) => fieldAt(data, field) === value),
        )
        .slice(0, cap === Infinity ? undefined : cap)
      reads += all.length
      const docs = all.map(([id, data]) => snapshotOf(path, id, data))
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
    doc: (id: string) => docRef(path, id),
  }
  return ref
}

function docRef(collectionPath: string, id: string): any {
  return {
    id,
    path: `${collectionPath}/${id}`,
    get: async () => {
      reads += 1
      return snapshotOf(
        collectionPath,
        id,
        (store.get(collectionPath) ?? new Map()).get(id),
      )
    },
    collection: (name: string) => collectionRef(`${collectionPath}/${id}/${name}`),
  }
}

const mockFirestore = {
  collection: (name: string) => collectionRef(name),
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
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  getOrgDoc: async () => ({}),
  getOrgForHost: async () => ({ orgId: ORG_ID, org: {} }),
  resolveOrgMembership: async () => ({ member: { role: 'admin' } }),
}))

/**
 * The scope resolver is the AUTH half and has its own coverage; what is under
 * test here is what the scan reaches once a caller is through it. Everything
 * else in that module — `scopeAllows`, `mediaObjectPath` — stays REAL, since
 * the needle set is built from it.
 */
jest.mock('../utils/server/media-scope', () => {
  const actual = jest.requireActual('../utils/server/media-scope')
  return {
    ...actual,
    resolveMediaScope: async () => ({
      scope: {
        base: `orgs/${ORG_ID}`,
        collection: 'orgs',
        scopeId: ORG_ID,
        scopeRef: mockFirestore.collection('orgs').doc(ORG_ID),
        billing: {},
        cdnScope: `org:${ORG_ID}`,
        viewerTokens: ['org'],
        viewerOrgWide: true,
      },
    }),
  }
})

// `require` after the mocks, not a hoisted `import`: the route resolves its
// Firestore handle at module scope.
const { POST } = require('../app/api/media/references/route')
const {
  documentHaystack,
} = require('../utils/server/scan-media-references')

/** `media:org:{orgId}/{mediaId}` — what the picker actually writes. */
const refTo = (mediaId: string) => {
  const value = formatMediaRef(`org:${ORG_ID}`, mediaId)
  // A malformed reference would make every assertion below vacuous.
  expect(value).toBe(`media:org:${ORG_ID}/${mediaId}`)
  return value
}

/**
 * A node map holding one media reference, exactly as the besigner stores it:
 * the picker writes ONE string into a `src`-shaped prop.
 */
const nodesReferencing = (mediaId: string) => ({
  root: { $id: 'root', componentId: 'container', nodes: ['image-1'] },
  'image-1': {
    $id: 'image-1',
    componentId: 'image',
    props: { src: refTo(mediaId), alt: 'seeded' },
  },
})

/**
 * The COMPRESSED storage form, carved into a pooled slab.
 *
 * firebase-admin hands back pooled Buffers, so a version's bytes are a view at
 * some offset into a shared 8 KB ArrayBuffer. A fixture at offset 0 lets the
 * `new Uint8Array(value.buffer)` bug pass by luck, so the offset is asserted
 * rather than hoped for.
 */
const compressedNodes = (nodes: Record<string, unknown>) => {
  const bytes = compress(nodes)
  const slab = Buffer.alloc(8192)
  const offset = 1024
  Buffer.from(bytes).copy(slab, offset)
  const view = slab.subarray(offset, offset + bytes.byteLength)
  expect(view.byteOffset).toBeGreaterThan(0)
  expect(view.byteLength).toBeLessThan(slab.byteLength)
  return view
}

interface ScanResult {
  status: number
  references: Array<{
    kind: string
    id: string
    name: string
    hostId: string
    versionId?: string
    live?: boolean
    field?: string
  }>
  complete?: boolean
  coverage?: string
  reads: number
}

async function scan(mediaId: string): Promise<ScanResult> {
  reads = 0
  const response = await POST(
    new Request('https://console.test/api/media/references', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
      },
      body: JSON.stringify({ orgId: ORG_ID, mediaId }),
    }),
  )
  const payload = await response.json()
  return {
    status: response.status,
    references: payload?.references ?? [],
    complete: payload?.complete,
    coverage: payload?.coverage,
    reads,
  }
}

const kindsFor = (result: ScanResult) =>
  result.references.map((reference) => `${reference.kind}:${reference.id}`).sort()

beforeEach(() => {
  store.clear()
  reads = 0
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })

  // ── The org's sites ────────────────────────────────────────────────────
  // `seo.favicon` is the reference site for `favicon.png`. `logoUrl` and
  // `seo.image` are the other two host fields a picker writes into.
  seed('hosts', HOST_ID, {
    orgId: ORG_ID,
    subdomain: SUBDOMAIN,
    displayName: 'Aglyn',
    memberRoles: { 'user-1': 'admin' },
    logoUrl: refTo('logo-png'),
    seo: {
      title: 'Aglyn',
      favicon: refTo('favicon-png'),
      image: refTo('social-png'),
    },
  })

  // ── The media library ──────────────────────────────────────────────────
  for (const [id, fileName] of [
    ['favicon-png', 'favicon.png'],
    ['mockup-png', 'besigner-canvas-mockup.png'],
    ['hero-png', 'hero.png'],
    ['draft-png', 'draft-only.png'],
    ['social-png', 'social-card.png'],
    ['logo-png', 'logo.png'],
    ['screen-social-png', 'screen-social.png'],
    ['cover-png', 'cover.png'],
    ['orphan-png', 'orphan.png'],
  ] as const) {
    seed(`orgs/${ORG_ID}/media`, id, {
      fileName,
      url: `https://firebasestorage.googleapis.com/v0/b/x/o/orgs%2F${ORG_ID}%2Fmedia%2F${id}`,
      cdnPath: `/api/media/cdn/org:${ORG_ID}/${id}`,
      storagePath: `orgs/${ORG_ID}/media/${id}`,
      visibleTo: ['org'],
    })
  }

  // ── Screens ────────────────────────────────────────────────────────────
  // The positive control: a live version, in the COMPRESSED form.
  seed(`hosts/${HOST_ID}/screens`, 'screen-home', {
    displayName: 'Home',
    versionId: 'version-live',
  })
  seed(`hosts/${HOST_ID}/screens/screen-home/versions`, 'version-live', {
    nodes: compressedNodes(nodesReferencing('hero-png')),
  })
  // A version that is NOT the published one. Deleting an asset only this
  // holds breaks the next publish or any rollback — silently, later.
  seed(`hosts/${HOST_ID}/screens/screen-home/versions`, 'version-draft', {
    nodes: compressedNodes(nodesReferencing('draft-png')),
  })
  // A screen's OWN social card (AGL-1337) lives on the screen document, not
  // in its nodes — the parent doc is already read, so missing this was free
  // to fix and expensive to get wrong.
  seed(`hosts/${HOST_ID}/screens`, 'screen-pricing', {
    displayName: 'Pricing',
    versionId: 'pricing-live',
    seo: { image: refTo('screen-social-png') },
  })
  seed(`hosts/${HOST_ID}/screens/screen-pricing/versions`, 'pricing-live', {
    nodes: compressedNodes({ root: { $id: 'root', componentId: 'container' } }),
  })

  // ── Layouts ────────────────────────────────────────────────────────────
  seed(`hosts/${HOST_ID}/layouts`, 'layout-main', {
    displayName: 'Main',
    versionId: 'layout-live',
  })
  seed(`hosts/${HOST_ID}/layouts/layout-main/versions`, 'layout-live', {
    nodes: compressedNodes({ root: { $id: 'root', componentId: 'container' } }),
  })

  // ── Components ─────────────────────────────────────────────────────────
  // `besigner-canvas-mockup.png` is held by two of them in production. A
  // component DOCUMENT stores its tree plainly so the tenant runtime can read
  // it without decoding; its VERSIONS are compressed like any other. Both
  // shapes are seeded so neither can be the only one that works.
  seed(`hosts/${HOST_ID}/components`, 'component-hero', {
    displayName: 'Product hero',
    rootId: 'root',
    nodes: nodesReferencing('mockup-png'),
  })
  seed(`hosts/${HOST_ID}/components`, 'component-feature', {
    displayName: 'Feature strip',
    rootId: 'root',
    versionId: 'feature-live',
    nodes: nodesReferencing('mockup-png'),
  })
  seed(`hosts/${HOST_ID}/components/component-feature/versions`, 'feature-live', {
    nodes: compressedNodes(nodesReferencing('mockup-png')),
  })

  // ── Content collections ────────────────────────────────────────────────
  // Already covered before this change; seeded so the fix cannot regress it.
  seed(`hosts/${HOST_ID}/collections`, 'blog', { name: 'Blog' })
  seed(`hosts/${HOST_ID}/collections/blog/entries`, 'entry-launch', {
    title: 'Launch',
    coverImage: refTo('cover-png'),
  })
})

describe('media usage scan — positive control', () => {
  /**
   * The one the endpoint already answered correctly. It has to stay green for
   * any of the failures below to mean "coverage gap" rather than "the fake
   * Firestore never returned anything".
   */
  it('finds an asset on a live screen version, stored COMPRESSED', async () => {
    const result = await scan('hero-png')
    expect(result.status).toBe(200)
    expect(kindsFor(result)).toEqual(['screen:screen-home'])
  })

  it('finds an asset on a collection entry', async () => {
    expect(kindsFor(await scan('cover-png'))).toEqual(['entry:entry-launch'])
  })

  /**
   * The negative control. An asset genuinely referenced nowhere must come back
   * empty AND complete — "we found nothing" and "we could not look" are
   * different answers, and only one of them may reach a delete confirmation as
   * silence.
   */
  it('reports a genuinely unreferenced asset as unused, and says the scan was complete', async () => {
    const result = await scan('orphan-png')
    expect(result.references).toEqual([])
    expect(result.complete).toBe(true)
  })
})

describe('media usage scan — the two production assets that reported "used nowhere"', () => {
  it('favicon.png is USED — the host document holds it at seo.favicon', async () => {
    const result = await scan('favicon-png')
    expect(kindsFor(result)).toEqual([`site:${HOST_ID}`])
    expect(result.references[0]).toMatchObject({
      kind: 'site',
      hostId: HOST_ID,
      field: 'seo.favicon',
    })
  })

  it('besigner-canvas-mockup.png is USED — by TWO components', async () => {
    const result = await scan('mockup-png')
    expect(kindsFor(result)).toEqual([
      'component:component-feature',
      'component:component-hero',
    ])
  })
})

describe('media usage scan — the rest of the corpus it never read', () => {
  it('finds an asset held only by a NON-LIVE version, and marks it not live', async () => {
    const result = await scan('draft-png')
    expect(kindsFor(result)).toEqual(['screen:screen-home'])
    expect(result.references[0]).toMatchObject({
      versionId: 'version-draft',
      live: false,
    })
  })

  it('finds the site logo held on the host document', async () => {
    expect(kindsFor(await scan('logo-png'))).toEqual([`site:${HOST_ID}`])
  })

  it("finds a screen's own social card, which lives on the screen document", async () => {
    const result = await scan('screen-social-png')
    expect(kindsFor(result)).toEqual(['screen:screen-pricing'])
  })

  it("finds the org's own logo, picked out of this very library", async () => {
    seed('orgs', ORG_ID, { name: 'Aglyn', logoUrl: refTo('orphan-png') })
    const result = await scan('orphan-png')
    expect(result.references).toEqual([
      expect.objectContaining({ kind: 'site', id: ORG_ID, field: 'logoUrl' }),
    ])
  })

  /**
   * Screens and layouts have never stored a `name`; the scan read exactly
   * that field, so every row in the panel was a raw document id — the one
   * thing a "where is this used" list must not be.
   */
  it('names a screen by its displayName rather than its document id', async () => {
    const result = await scan('hero-png')
    expect(result.references[0].name).toBe('Home')
  })
})

describe('media usage scan — the compressed storage form', () => {
  /**
   * The decode pinned at the helper, so "just JSON.stringify the document"
   * cannot come back green. This is the AGL-1223 shape stated as an
   * assertion: the raw form is not merely harder to search, it contains NONE
   * of the document's strings, so every needle misses and the answer is a
   * confident "used nowhere".
   */
  it('a raw compressed document is searchable only after decoding', () => {
      const document = { nodes: compressedNodes(nodesReferencing('mockup-png')) }
    const pattern = mediaRefPattern('mockup-png')

    expect(pattern.test(JSON.stringify(document))).toBe(false)
    expect(JSON.stringify(document)).toContain('"type":"Buffer"')
    expect(pattern.test(documentHaystack(document))).toBe(true)
  })

  /**
   * The third storage form (AGL-1391): what `JSON.stringify` makes of a Node
   * Buffer, which is what an already-downloaded export bundle carries.
   */
  it('reads the {type:"Buffer"} envelope an export bundle carries', () => {
      const envelope = JSON.parse(
      JSON.stringify({ nodes: compressedNodes(nodesReferencing('hero-png')) }),
    )
    expect(envelope.nodes.type).toBe('Buffer')
    expect(mediaRefPattern('hero-png').test(documentHaystack(envelope))).toBe(true)
  })
})

describe('media usage scan — the wrong-prefix trap', () => {
  /**
   * The regression guard for the mistake that matched 2 of 206. It is written
   * as a comparison rather than a constant check, because the constant being
   * right is not the point — the point is that a scan built on the wrong
   * assumption finds NOTHING and reports it as safety.
   */
  it('media:// finds nothing where media: finds the reference', async () => {
    expect(MEDIA_REF_PREFIX).toBe('media:')
    const stored = refTo('mockup-png')
    expect(new RegExp(`media://[^"]*mockup-png`).test(stored)).toBe(false)
    expect(mediaRefPattern('mockup-png').test(stored)).toBe(true)
    // And the endpoint agrees with the pattern, not with the wrong prefix.
    expect((await scan('mockup-png')).references.length).toBe(2)
  })

  it('does not match a longer id that merely starts the same', async () => {
    expect(mediaRefPattern('mockup').test(refTo('mockup-png'))).toBe(false)
  })
})

describe('media usage scan — read cost is bounded and honesty is reported', () => {
  /**
   * The naive version of this fix is an unbounded per-org scan running on a
   * user's click. The bound is asserted here rather than described in a
   * comment: seed far more versions than the per-parent budget and require
   * that the scan stops AND says it stopped.
   */
  it('caps the versions it reads per document and reports the scan as incomplete', async () => {
    for (let index = 0; index < 60; index += 1) {
      seed(`hosts/${HOST_ID}/screens/screen-home/versions`, `filler-${index}`, {
        nodes: compressedNodes({ root: { $id: 'root', componentId: 'container' } }),
      })
    }
    const result = await scan('orphan-png')
    expect(result.reads).toBeLessThan(60)
    expect(result.complete).toBe(false)
    // History was cut, not the live corpus — so the answer stays useful.
    expect(result.coverage).toBe('published')
  })

  /**
   * A truncated scan that found nothing must never be presentable as "nothing
   * uses it" — that is the sentence this whole issue is about.
   */
  it('never returns complete:true alongside a truncated corpus', async () => {
    for (let index = 0; index < 60; index += 1) {
      seed(`hosts/${HOST_ID}/screens/screen-home/versions`, `filler-${index}`, {
        nodes: compressedNodes({ root: { $id: 'root', componentId: 'container' } }),
      })
    }
    expect((await scan('draft-png')).complete).toBe(false)
  })

  /**
   * The live corpus still has to be reachable inside the budget: the whole
   * point of bounding the scan is to spend the reads on what a visitor sees.
   */
  it('keeps a normal site well inside its budget', async () => {
    const result = await scan('hero-png')
    expect(result.complete).toBe(true)
    expect(result.reads).toBeLessThan(40)
  })

  /**
   * The ceiling, on a site far larger than any in production: 190 screens
   * with ten versions each, 30 layouts, 50 components, and three collections
   * of 200 entries — roughly 2,600 documents, every one of which the naive
   * "read everything" version of this fix would read, per asset, on a click.
   *
   * The number this prints is the design's actual cost. The assertion that
   * matters is not the number but the COVERAGE beside it: the budget ran out
   * on version history, so the live corpus was still read in full and the
   * panel can still say something true rather than only "we don't know".
   */
  it('cannot be made expensive by a large site', async () => {
    for (let screen = 0; screen < 190; screen += 1) {
      seed(`hosts/${HOST_ID}/screens`, `bulk-screen-${screen}`, {
        displayName: `Bulk ${screen}`,
        versionId: `bulk-${screen}-v0`,
      })
      for (let version = 0; version < 10; version += 1) {
        seed(
          `hosts/${HOST_ID}/screens/bulk-screen-${screen}/versions`,
          `bulk-${screen}-v${version}`,
          { nodes: compressedNodes({ root: { $id: 'root' } }) },
        )
      }
    }
    for (let layout = 0; layout < 30; layout += 1) {
      seed(`hosts/${HOST_ID}/layouts`, `bulk-layout-${layout}`, {
        displayName: `Layout ${layout}`,
      })
    }
    for (let component = 0; component < 50; component += 1) {
      seed(`hosts/${HOST_ID}/components`, `bulk-component-${component}`, {
        displayName: `Component ${component}`,
        nodes: { root: { $id: 'root' } },
      })
    }
    for (let collection = 0; collection < 3; collection += 1) {
      seed(`hosts/${HOST_ID}/collections`, `bulk-${collection}`, {
        name: `Bulk ${collection}`,
      })
      for (let entry = 0; entry < 200; entry += 1) {
        seed(
          `hosts/${HOST_ID}/collections/bulk-${collection}/entries`,
          `entry-${entry}`,
          { title: `Entry ${entry}` },
        )
      }
    }

    const result = await scan('orphan-png')
    // eslint-disable-next-line no-console
    console.log(
      `[AGL-1413] large site (2,600 docs): ${result.reads} reads, ` +
        `coverage=${result.coverage}`,
    )
    expect(result.reads).toBeLessThan(2000)
    // And the answer is honest about having stopped — but the budget ran out
    // on HISTORY, so the live corpus was still read in full and "nothing
    // published uses this" remains a true thing to say.
    expect(result.complete).toBe(false)
    expect(result.coverage).toBe('published')
  })

  /**
   * The other direction: a site so wide that even the live corpus is cut.
   * Nothing here may be presented as unused.
   */
  it('downgrades to partial when the LIVE corpus itself is truncated', async () => {
    for (let collection = 0; collection < 40; collection += 1) {
      seed(`hosts/${HOST_ID}/collections`, `wide-${collection}`, {
        name: `Wide ${collection}`,
      })
      for (let entry = 0; entry < 60; entry += 1) {
        seed(
          `hosts/${HOST_ID}/collections/wide-${collection}/entries`,
          `entry-${entry}`,
          { title: `Entry ${entry}`, body: 'x'.repeat(10) },
        )
      }
    }
    const result = await scan('orphan-png')
    expect(result.coverage).toBe('partial')
    expect(result.complete).toBe(false)
  })
})
