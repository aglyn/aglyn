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

import { compress, storedNodesForm } from '@aglyn/aglyn'
import type { BesignerDraftIds } from './besigner-draft-store'

/** Documents by path, holding exactly what the code under test wrote. */
const mockStore = new Map<string, Record<string, unknown>>()

/**
 * The double is built INSIDE the factory and read back below, because
 * `jest.mock` is hoisted above every declaration in this file — a class
 * declared out here is still in its temporal dead zone when the factory runs.
 */
jest.mock('firebase/firestore', () => ({
  /**
   * A minimal `Bytes`: the client SDK's wrapper is matched STRUCTURALLY by
   * `decodeStoredNodes` — on `toUint8Array` rather than on the class — so a
   * double carrying that one method is the real contract, and modelling it
   * here keeps the whole Firestore client out of this suite.
   */
  Bytes: class FakeBytes {
    // A plain field rather than a TypeScript parameter property: the latter
    // compiles to an assignment the mock-factory scope check reads as an
    // out-of-scope variable access.
    packed: Uint8Array = new Uint8Array()
    static fromUint8Array(packed: Uint8Array) {
      const instance = new FakeBytes()
      instance.packed = packed
      return instance
    }
    toUint8Array() {
      return this.packed
    }
  },
  doc: (_firestore: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  setDoc: jest.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
    mockStore.set(ref.path, data)
  }),
  getDoc: jest.fn(async (ref: { path: string }) => ({
    exists: () => mockStore.has(ref.path),
    data: () => mockStore.get(ref.path),
  })),
  deleteDoc: jest.fn(async (ref: { path: string }) => {
    mockStore.delete(ref.path)
  }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}))

// After the mock, so the module under test binds to the doubles.
import {
  readServerDraft,
  writeServerDraft,
  clearServerDraft,
} from './besigner-server-draft'

/** The same class the module under test writes with. */
const mockBytes = (jest.requireMock('firebase/firestore') as {
  Bytes: {
    new (): { toUint8Array(): Uint8Array }
    fromUint8Array(packed: Uint8Array): { toUint8Array(): Uint8Array }
  }
}).Bytes

const IDS: BesignerDraftIds = {
  scope: 'host-1',
  kind: 'screen',
  docId: 'screen-1',
  versionId: 'v1',
}
const PATH = 'hosts/host-1/screens/screen-1/versions/v1/draft/current'

/** A tree with enough repeated structure for the encoders to differ. */
const NODES = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => [
    `node-${index}`,
    {
      $id: `node-${index}`,
      componentId: 'muiTypography',
      parentId: '_@_',
      props: { children: `Paragraph number ${index} of the page` },
    },
  ]),
) as never

const DRAFT = {
  nodes: NODES,
  baseStamp: 'stamp-1',
  updatedByUid: 'uid-1',
  updatedByEmail: 'author@example.com',
}

const firestore = {} as never

beforeEach(async () => {
  // The write fingerprint lives at module scope so all four editors share it,
  // which means it also outlives a test. Clearing the draft is what forgets
  // it — otherwise the second test to write this tree reports `unchanged` and
  // stores nothing, and every assertion after it reads an empty document.
  await clearServerDraft(firestore, IDS)
  mockStore.clear()
  jest.clearAllMocks()
})

describe('the working draft is compressed at rest', () => {
  /**
   * THE CONTROL. A draft holds the whole working tree, so it is the same size
   * as the version it sits beside — and that version is msgpack. Stored as a
   * plain map instead it costs about 1.4x as many bytes against the same 1 MiB
   * ceiling, and the editor's near-limit warning measures the msgpack size, so
   * nothing on screen reflects the difference.
   */
  it('writes nodes as bytes, not as a plain Firestore map', async () => {
    await writeServerDraft(firestore, IDS, DRAFT)

    const stored = mockStore.get(PATH)
    expect(stored).toBeDefined()
    expect(storedNodesForm(stored?.['nodes'])).toBe('bytes')
    // Named explicitly: `storedNodesForm` answering 'map' is the exact
    // regression, and a form assertion alone reads as a type check.
    expect(stored?.['nodes']).toBeInstanceOf(mockBytes)
  })

  it('stores fewer bytes than the plain tree it replaces', async () => {
    await writeServerDraft(firestore, IDS, DRAFT)

    const written = (
      mockStore.get(PATH)?.['nodes'] as { toUint8Array(): Uint8Array }
    ).toUint8Array()
    expect(written.byteLength).toBeLessThan(JSON.stringify(NODES).length)
  })

  it('keeps the rest of the draft readable alongside the tree', async () => {
    await writeServerDraft(firestore, IDS, DRAFT)

    const stored = mockStore.get(PATH)
    expect(stored?.['baseStamp']).toBe('stamp-1')
    expect(stored?.['updatedByUid']).toBe('uid-1')
    expect(stored?.['updatedByEmail']).toBe('author@example.com')
    expect(stored?.['updatedAt']).toEqual({ __serverTimestamp: true })
  })

  it('round-trips the tree it just wrote', async () => {
    await writeServerDraft(firestore, IDS, DRAFT)

    await expect(readServerDraft(firestore, IDS)).resolves.toEqual(DRAFT)
  })
})

/**
 * BOTH FORMS, PERMANENTLY.
 *
 * Every draft in production predates compression and nothing migrates them.
 * A reader that understood only bytes would find no tree in one of those and
 * report the draft ABSENT — which is not an error anybody sees, it is an
 * author being offered nothing where their unpublished work actually is.
 */
describe('reading a draft stored the other way', () => {
  it('reads a plain-map draft written before compression', async () => {
    mockStore.set(PATH, { ...DRAFT, updatedAt: { __serverTimestamp: true } })

    await expect(readServerDraft(firestore, IDS)).resolves.toEqual(DRAFT)
  })

  it('reads a bytes draft', async () => {
    mockStore.set(PATH, {
      ...DRAFT,
      nodes: mockBytes.fromUint8Array(compress(NODES)),
    })

    await expect(readServerDraft(firestore, IDS)).resolves.toEqual(DRAFT)
  })

  it('gives both stored forms the same answer', async () => {
    mockStore.set(PATH, { ...DRAFT })
    const fromMap = await readServerDraft(firestore, IDS)
    mockStore.set(PATH, {
      ...DRAFT,
      nodes: mockBytes.fromUint8Array(compress(NODES)),
    })
    const fromBytes = await readServerDraft(firestore, IDS)

    expect(fromMap).toEqual(fromBytes)
  })

  it('still reports a draft with no tree as absent', async () => {
    mockStore.set(PATH, { baseStamp: null })

    await expect(readServerDraft(firestore, IDS)).resolves.toBeNull()
  })
})

describe('the surrounding contract is unchanged', () => {
  it('reports a second identical write as unchanged rather than rewriting', async () => {
    await expect(writeServerDraft(firestore, IDS, DRAFT)).resolves.toBe(
      'written',
    )
    await expect(writeServerDraft(firestore, IDS, DRAFT)).resolves.toBe(
      'unchanged',
    )
  })

  it('writes again once the tree moves', async () => {
    await writeServerDraft(firestore, IDS, DRAFT)
    await expect(
      writeServerDraft(firestore, IDS, {
        ...DRAFT,
        nodes: { root: { $id: 'root', componentId: 'div' } } as never,
      }),
    ).resolves.toBe('written')
  })

  it('refuses a target that cannot hold a draft', async () => {
    await expect(
      writeServerDraft(firestore, { ...IDS, kind: 'template' }, DRAFT),
    ).resolves.toBe('failed')
    await expect(
      writeServerDraft(firestore, { ...IDS, scope: 'platform' }, DRAFT),
    ).resolves.toBe('failed')
  })

  it('clears the draft, and the fingerprint with it', async () => {
    await writeServerDraft(firestore, IDS, DRAFT)
    await clearServerDraft(firestore, IDS)

    expect(mockStore.has(PATH)).toBe(false)
    // The same tree writes again rather than reporting itself unchanged
    // against a draft that no longer exists.
    await expect(writeServerDraft(firestore, IDS, DRAFT)).resolves.toBe(
      'written',
    )
  })
})
