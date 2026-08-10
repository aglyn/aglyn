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
 *
 * @jest-environment node
 */

/**
 * Publishing a besigner-edited screen or layout to the marketplace (AGL-1395).
 *
 * A version document's `nodes` is stored in two live forms — a plain Firestore
 * map, and msgpack `Bytes` written by the besigner — and both publish handlers
 * read it raw. The Admin SDK materialises the compressed form as a Node
 * `Buffer`, so the publisher was told their content was malformed when the
 * only thing wrong was the decode.
 *
 * Unlike the silent siblings (AGL-1223, AGL-1391) this one FAILS LOUDLY, which
 * is why the assertions below pin the exact message as well as the status: the
 * message is the entire experience of the bug, and it pointed at the author.
 */

import { compress } from '@aglyn/aglyn/app-utils/compress'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { sanitizeMarketplaceDefinition } from '../model/marketplace'

/** The canvas root-collection wrapper — `CANVAS_ROOT_ELEMENT_ID`. */
const ROOT = '_@_'
/** The node marking where a bound screen's content grafts in. */
const LAYOUT_SLOT_COMPONENT_ID = 'layoutSlot'

/** A publishable screen: wrapper root, one allowlisted child. */
const SCREEN_NODES = {
  [ROOT]: { componentId: 'div', nodes: ['hero'] },
  hero: {
    componentId: 'muiTypography',
    parentId: ROOT,
    props: { children: 'Welcome' },
  },
}

/** A publishable layout: wrapper root, chrome, and the content slot. */
const LAYOUT_NODES = {
  [ROOT]: { componentId: 'div', nodes: ['bar', 'slot'] },
  bar: { componentId: 'muiAppBar', parentId: ROOT, nodes: [] },
  slot: { componentId: LAYOUT_SLOT_COMPONENT_ID, parentId: ROOT },
}

/**
 * What firebase-admin actually hands back for a bytes field: a Node `Buffer`
 * carved out of the shared allocation pool, so `byteOffset` is non-zero and
 * `buffer.byteLength` is the whole pool rather than the field.
 *
 * Same construction as `pooledBuffer` in
 * `libs/aglyn/src/lib/app-utils/stored-nodes.spec.ts`, and for the same reason:
 * a zero-offset buffer lets the byteOffset bug pass by LUCK. `Buffer.from` and
 * `Buffer.allocUnsafe` do draw on the real pool, but the offset they land at is
 * whatever the rest of the process left behind — 0 whenever the pool has just
 * been replaced. A dedicated slab reproduces the same shape deterministically.
 *
 * Copied rather than imported: the original is a module-local const in another
 * project's spec, and importing a spec file would re-run its suite here.
 */
const pooledBuffer = (value: unknown) => {
  const bytes = compress(value)
  const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
  const packed = pool.subarray(64, 64 + bytes.byteLength)
  packed.set(bytes)
  return packed
}

/**
 * The document store the firestore mock serves, keyed by path. Reset per test
 * so a handler's own writes cannot leak into the next one.
 */
let store: Record<string, Record<string, any>> = {}
/** Every `set` the handlers performed, in order. */
let writes: Array<{ path: string; data: any }> = []

jest.mock('@aglyn/aglyn/server', () => ({
  CANVAS_ROOT_ELEMENT_ID: '_@_',
  checkEntitlement: () => true,
  createResourceUid: () => 'listing-new',
  // The REAL decoder, not a stub: this spec exists to prove the handlers call
  // it, so faking it would test the fix against itself.
  decodeStoredNodes: (
    jest.requireActual('@aglyn/aglyn/app-utils/stored-nodes') as {
      decodeStoredNodes: (raw: unknown) => unknown
    }
  ).decodeStoredNodes,
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'org-1',
    permissions: { publishToMarketplace: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  resolvePublisherProfile: async () => ({
    orgId: 'org-1',
    stripeChargesEnabled: true,
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = () =>
    jest.requireMock('@aglyn/tenant-data-admin') as {
      __store: Record<string, Record<string, any>>
      __writes: Array<{ path: string; data: any }>
    }
  const snapshotFor = (path: string) => {
    const data = state().__store[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    get: async () => snapshotFor(path),
    set: async (data: Record<string, unknown>) => {
      state().__writes.push({ path, data })
      state().__store[path] = { ...(state().__store[path] ?? {}), ...data }
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string): any => {
    // Every listing lookup in these handlers is a "does one already exist"
    // query; answering empty makes each publish a first publish.
    const query: any = {
      where: () => query,
      limit: () => query,
      get: async () => ({ empty: true, docs: [] }),
    }
    return { ...query, doc: (id: string) => docRef(`${path}/${id}`) }
  }
  return {
    __store: {} as Record<string, Record<string, any>>,
    __writes: [] as Array<{ path: string; data: any }>,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'uid-1' }) }),
        firestore: () => ({ collection: (name: string) => collectionRef(name) }),
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'NOW',
          arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
        },
        Timestamp: { now: () => 'TS' },
      },
    },
    getOrgForHost: async () => ({ orgId: 'org-1', org: {} }),
  }
})

const adminMock = jest.requireMock('@aglyn/tenant-data-admin') as {
  __store: Record<string, Record<string, any>>
  __writes: Array<{ path: string; data: any }>
}

import { publishTemplateHandler } from './publish-template'
import { publishLayoutHandler } from './publish-layout'

function respond() {
  const result: { status: number; body: any } = { status: 0, body: null }
  const res = {
    status(code: number) {
      result.status = code
      return {
        json(body: unknown) {
          result.body = body
          return body
        },
      }
    },
  }
  return { res, result }
}

/** Seeds a host whose one screen and one layout carry `nodes` as given. */
function seed(nodes: unknown) {
  store = {}
  store['hosts/host-1'] = {
    memberRoles: { 'uid-1': 'admin' },
    screens: { 'screen-1': '/home' },
    theme: { palette: 'light' },
  }
  store['hosts/host-1/screens/screen-1'] = {
    displayName: 'Home',
    versionId: 'v1',
  }
  store['hosts/host-1/screens/screen-1/versions/v1'] = { nodes }
  store['hosts/host-1/layouts/layout-1'] = { versionId: 'v1' }
  store['hosts/host-1/layouts/layout-1/versions/v1'] = { nodes }
  writes = []
  adminMock.__store = store
  adminMock.__writes = writes
}

async function publishTemplate() {
  const { res, result } = respond()
  await publishTemplateHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { hostId: 'host-1', displayName: 'Starter site' },
    } as never,
    res as never,
  )
  return result
}

async function publishLayout() {
  const { res, result } = respond()
  await publishLayoutHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { hostId: 'host-1', layoutId: 'layout-1', displayName: 'Shell' },
    } as never,
    res as never,
  )
  return result
}

/** What both handlers answer on success: the mocked uid, first version. */
const PUBLISHED = { status: 200, body: { listingId: 'listing-new', version: 1 } }

/** The `versions/<n>` write a successful publish makes, or undefined. */
const versionWrite = () =>
  writes.find((write) => /\/versions\/\d+$/.test(write.path))?.data

describe('publishing a besigner-saved screen as a template (AGL-1395)', () => {
  it('publishes the plain storage form', async () => {
    seed(SCREEN_NODES)
    const result = await publishTemplate()

    expect(result).toEqual(PUBLISHED)
    expect(versionWrite().template.screens[0].nodes[ROOT]).toBeDefined()
  })

  it('publishes the compressed storage form the besigner writes', async () => {
    const packed = pooledBuffer(SCREEN_NODES)
    // Guard the premise: on a zero-offset buffer the byteOffset bug passes by
    // luck, and this suite would go green against a broken decode.
    expect(packed.byteOffset).toBeGreaterThan(0)
    expect(packed.buffer.byteLength).toBeGreaterThan(packed.byteLength)
    seed(packed)

    const result = await publishTemplate()

    // Asserted whole rather than on `status` alone: what a publisher SEES of
    // this bug is the message, so it belongs in the failure output.
    expect(result).toEqual(PUBLISHED)
    // A real node tree reached the listing, not an empty wrapper: the root
    // resolves AND its child is the authored component.
    const screen = versionWrite().template.screens[0]
    expect(screen.nodes[ROOT].nodes).toEqual(['hero'])
    expect(screen.nodes['hero'].componentId).toBe('muiTypography')
    expect(screen.nodes).not.toHaveProperty('type', 'Buffer')
  })

  it('reads the same tree from both storage forms', async () => {
    seed(SCREEN_NODES)
    await publishTemplate()
    const plain = versionWrite().template.screens[0].nodes

    seed(pooledBuffer(SCREEN_NODES))
    await publishTemplate()

    expect(versionWrite().template.screens[0].nodes).toEqual(plain)
  })
})

describe('publishing a besigner-saved layout (AGL-1395)', () => {
  it('publishes the plain storage form', async () => {
    seed(LAYOUT_NODES)
    const result = await publishLayout()

    expect(result).toEqual(PUBLISHED)
    expect(versionWrite().layout.rootId).toBe(ROOT)
  })

  it('publishes the compressed storage form the besigner writes', async () => {
    const packed = pooledBuffer(LAYOUT_NODES)
    expect(packed.byteOffset).toBeGreaterThan(0)
    seed(packed)

    const result = await publishLayout()

    expect(result).toEqual(PUBLISHED)
    const layout = versionWrite().layout
    // `'0'` is the tell for the byte-index root: `Object.keys(buffer)` are
    // indices, and byte 0 is a NUMBER, so it has no `parentId` and wins the
    // "node without a parent" search. A fix that only added the decode to
    // publish-template would leave this in place, and a test that checked
    // only "publish succeeded" would not see it.
    expect(layout.rootId).not.toBe('0')
    expect(layout.rootId).toBe(ROOT)
    expect(layout.nodes[ROOT].nodes).toEqual(['bar', 'slot'])
    expect(
      Object.values(layout.nodes).some(
        (node: any) => node.componentId === LAYOUT_SLOT_COMPONENT_ID,
      ),
    ).toBe(true)
  })

  it('reads the same tree from both storage forms', async () => {
    seed(LAYOUT_NODES)
    await publishLayout()
    const plain = versionWrite().layout

    seed(pooledBuffer(LAYOUT_NODES))
    await publishLayout()

    expect(versionWrite().layout).toEqual(plain)
  })

  it('roots at the canvas wrapper, not the first parentless node', async () => {
    // A top-level node may rely on the root's child array alone and carry no
    // `parentId` — legal, see `compose-layout-nodes`. Searching for "the node
    // without a parent" then finds whichever comes first in key order, and if
    // that is a child the layout publishes rooted at its own app bar: one
    // node, no slot, and the author is told their layout has nowhere to
    // render. The byte-index `'0'` was the same search failing on a Buffer.
    seed(
      pooledBuffer({
        bar: { componentId: 'muiAppBar', nodes: [] },
        [ROOT]: { componentId: 'div', nodes: ['bar', 'slot'] },
        slot: { componentId: LAYOUT_SLOT_COMPONENT_ID, parentId: ROOT },
      }),
    )

    const result = await publishLayout()

    expect(result).toEqual(PUBLISHED)
    expect(versionWrite().layout.rootId).toBe(ROOT)
  })
})

/**
 * Pins the raw form as broken, so "just pass `snapshot.get('nodes')` straight
 * in" cannot come back green — the same guard AGL-1223 left on the scan
 * predicates.
 */
describe('the raw storage form defeats the publish paths', () => {
  it('resolves the layout root to the byte index "0"', () => {
    const packed: any = pooledBuffer(LAYOUT_NODES)

    expect(
      Object.keys(packed).find((id) => !packed[id]?.parentId),
    ).toBe('0')
    // The byte at that index is a NUMBER — msgpack's map header — which is why
    // the search finds it and why sanitizing it yields a wrapper with nothing
    // inside.
    expect(typeof packed['0']).toBe('number')

    const decoded = decodeStoredNodes(packed) as Record<string, any>
    expect(
      Object.keys(decoded).find((id) => !decoded[id]?.parentId),
    ).toBe(ROOT)
  })

  it('has no root node under the canvas root id', () => {
    const packed: any = pooledBuffer(SCREEN_NODES)

    // What `sanitizeMarketplaceDefinition` tests, and why the publisher was
    // told their screen had no root: a Buffer has no `_@_`.
    expect(packed[ROOT]).toBeUndefined()
    expect((decodeStoredNodes(packed) as any)[ROOT]).toBeDefined()
  })
})

/**
 * The message, which is the whole experience of this bug.
 *
 * "Definition has no root node" is a true sentence about a Buffer and a true
 * sentence about an empty page, and the publisher cannot tell which they have
 * — so it read as "your design is broken" for a design that was fine. The
 * decode above means these two can no longer collide through the publish
 * handlers; this pins the distinction at the sanitizer so the NEXT raw read
 * announces itself instead of impersonating a content problem.
 */
describe('an undecoded definition does not read as an authoring mistake', () => {
  const blames = (error: string) => /bug on our side/.test(error)

  it('names the decode for the Admin SDK Buffer', () => {
    const result = sanitizeMarketplaceDefinition({
      rootId: ROOT,
      nodes: pooledBuffer(SCREEN_NODES) as never,
    })

    expect(result.ok).toBe(false)
    expect(blames((result as { error: string }).error)).toBe(true)
  })

  it('names the decode for the JSON Buffer envelope', () => {
    // What a site-export bundle carries (AGL-1391) — a plain object, so it
    // survives every "is this bytes" test that is not looking for it.
    const envelope = JSON.parse(JSON.stringify(pooledBuffer(SCREEN_NODES)))
    const result = sanitizeMarketplaceDefinition({
      rootId: ROOT,
      nodes: envelope,
    })

    expect(result.ok).toBe(false)
    expect(blames((result as { error: string }).error)).toBe(true)
  })

  it('still blames nobody but the definition when it is genuinely rootless', () => {
    const result = sanitizeMarketplaceDefinition({
      rootId: ROOT,
      nodes: { other: { componentId: 'muiTypography' } },
    })

    expect(result).toEqual({ ok: false, error: 'Definition has no root node' })
  })

  it('leaves a node map whose keys merely resemble the envelope alone', () => {
    const result = sanitizeMarketplaceDefinition({
      rootId: 'type',
      nodes: {
        type: { componentId: 'div', nodes: ['data'] },
        data: { componentId: 'muiTypography', parentId: 'type' },
      },
    })

    expect(result.ok).toBe(true)
  })
})
