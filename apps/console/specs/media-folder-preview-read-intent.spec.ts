/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * AGL-1694 · the folder-sharing PREVIEW is a READ, and a read-only lock
 * passes reads.
 *
 * `POST /api/media/folders` carries six actions. Five of them write, and so
 * does the sixth — `set-scope` — unless it is asked for `preview: true`, in
 * which case it walks the subtree, counts it, and returns. That count is
 * what the AGL-1045 confirmation dialog quotes ("also apply to the 47 files
 * in this folder and its subfolders?") before an author changes who can see
 * a folder's assets. Under a read-only lock it used to 423, because the
 * verdict runs inside `resolveMediaScope` at the top of the handler — before
 * `const action = ...`, let alone before the `preview` check five branches
 * down. A read inherited a write's verdict.
 *
 * The fix does NOT move the chokepoint. Moving a security verdict below a
 * client-controlled branch is the expensive version of this change and the
 * one AGL-1694 was reluctant about; it is also unnecessary, because the
 * resolver already receives the same `body` the branch reads. So the intent
 * is DECIDED from that body and handed to the verdict, which still runs
 * unconditionally, first, on every request.
 *
 * That makes the request shape the security assertion, so this file pins
 * both sides of it:
 *
 *  - the preview passes a read-only lock, AND writes nothing while doing it;
 *  - every genuine write is still refused, including `set-scope` itself
 *    without the flag, and including a write action that decorates itself
 *    with `preview: true`. A fix that stopped refusing those would be far
 *    worse than the over-refusal it replaced.
 *
 * The verdict's own semantics (read-only passes reads, `full` refuses both,
 * staff bypass everything) are unit-pinned in
 * libs/tenant/data/admin/src/lib/server/lockdown.spec.ts. The stub here
 * restates that one rule so this file can observe what the ROUTE declares.
 */

import { ORG_SCOPE_TOKEN } from '@aglyn/aglyn/server'

const ORG_ID = 'org-1'
const UID = 'u-admin'

/** The lock in force for the current test; null = no lock. */
let lock: { scope: string; reason: string; mode: 'read-only' | 'full' } | null =
  null
/** Every intent the route handed the verdict, in call order. */
let intents: unknown[] = []
/** Every mutating call the fake Firestore/Storage saw. */
let writes: string[] = []

const mockVerifyIdToken = jest.fn()

/**
 * The verdict, restated: a read-only lock refuses writes and passes reads;
 * a full lock refuses both. Recording `options.intent` is the point — it is
 * the route's declaration, and the only thing this file is really testing.
 */
const mockGetLockdownVerdict = jest.fn(
  async (options: { intent?: unknown; staff?: boolean }) => {
    intents.push(options.intent)
    if (options.staff === true) return null
    if (!lock) return null
    if (lock.mode === 'read-only' && options.intent === 'read') return null
    return lock
  },
)

const FOLDERS: { id: string; parentId: string | null; name: string }[] = [
  { id: 'f-root', parentId: null, name: 'Brand' },
  { id: 'f-child', parentId: 'f-root', name: 'Logos' },
  { id: 'f-other', parentId: null, name: 'Elsewhere' },
]
const ASSETS: { id: string; folderId: string | null }[] = [
  { id: 'm-1', folderId: 'f-root' },
  { id: 'm-2', folderId: 'f-child' },
  { id: 'm-3', folderId: 'f-other' },
]

const snapshot = (
  path: string,
  data: Record<string, unknown> | undefined,
  id: string,
) => ({
  id,
  exists: data !== undefined,
  data: () => data,
  get: (field: string) => data?.[field],
  ref: docHandle(path, data, id),
})

const docHandle = (
  path: string,
  data: Record<string, unknown> | undefined,
  id: string,
): Record<string, unknown> => ({
  path,
  id,
  get: async () => snapshot(path, data, id),
  set: async () => {
    writes.push(`set ${path}`)
  },
  update: async () => {
    writes.push(`update ${path}`)
  },
})

const folderDocs = () =>
  FOLDERS.map((folder) =>
    snapshot(`mediaFolders/${folder.id}`, { ...folder }, folder.id),
  )
const assetDocs = (predicate: (folderId: string | null) => boolean) =>
  ASSETS.filter((asset) => predicate(asset.folderId)).map((asset) =>
    snapshot(`media/${asset.id}`, { ...asset }, asset.id),
  )

const subcollection = (name: string) => ({
  limit: () => ({ get: async () => ({ docs: folderDocs() }) }),
  doc: (id: string) => {
    const folder = FOLDERS.find((entry) => entry.id === id)
    const asset = ASSETS.find((entry) => entry.id === id)
    const data = name === 'mediaFolders' ? folder : asset
    return docHandle(`${name}/${id}`, data ? { ...data } : undefined, id)
  },
  where: (field: string, op: string, value: unknown) => ({
    get: async () => ({
      docs:
        name === 'mediaFolders'
          ? folderDocs().filter((doc) => doc.get('parentId') === value)
          : assetDocs((folderId) =>
              op === 'in'
                ? (value as string[]).includes(folderId as string)
                : folderId === value,
            ),
    }),
  }),
})

const mockBatch = () => ({
  set: (ref: { path: string }) => writes.push(`batch.set ${ref.path}`),
  update: (ref: { path: string }) => writes.push(`batch.update ${ref.path}`),
  delete: (ref: { path: string }) => writes.push(`batch.delete ${ref.path}`),
  commit: async () => {
    writes.push('batch.commit')
  },
})

const mockFirestore = {
  batch: mockBatch,
  collection: (name: string) => ({
    doc: (id: string) => ({
      path: `${name}/${id}`,
      id,
      collection: subcollection,
      get: async () => snapshot(`${name}/${id}`, {}, id),
      set: async () => writes.push(`set ${name}/${id}`),
    }),
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
      storage: () => ({
        bucket: () => ({
          name: 'bucket',
          file: () => {
            // Nothing under test may reach Storage: the preview never
            // writes, and every write path is refused before it starts.
            throw new Error('unexpected Storage access')
          },
        }),
      }),
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        delete: () => 'FIELD_DELETE',
      },
    },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  getLockdownVerdict: (...args: unknown[]) =>
    (mockGetLockdownVerdict as (...a: unknown[]) => unknown)(...args),
  featureLockdownRefusal: async () => null,
  lockdownJsonResponse: (state: { scope: string; reason: string }) =>
    Response.json(
      { error: 'locked', scope: state.scope, reason: state.reason },
      { status: 423 },
    ),
  getOrgDoc: async () => ({ plan: 'pro' }),
  getOrgForHost: async () => ({ orgId: ORG_ID, org: { plan: 'pro' } }),
  resolveOrgMembership: async () => ({
    orgId: ORG_ID,
    member: { $id: UID, role: 'admin' },
  }),
}))

import { POST } from '../app/api/media/folders/route'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/media/folders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: ORG_ID, ...body }),
    }),
  )

const PREVIEW = {
  action: 'set-scope',
  folderId: 'f-root',
  visibleTo: [ORG_SCOPE_TOKEN],
  preview: true,
}

beforeEach(() => {
  jest.clearAllMocks()
  lock = { scope: 'org', reason: 'maintenance', mode: 'read-only' }
  intents = []
  writes = []
  mockVerifyIdToken.mockResolvedValue({
    uid: UID,
    email_verified: true,
    staff: false,
  })
})

describe('AGL-1694 · the folder-sharing preview under a read-only lock', () => {
  it('answers the subtree count instead of a 423', async () => {
    const response = await post(PREVIEW)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      preview: true,
      folders: 1,
      // `f-root` plus its child `f-child`; `f-other` is a sibling.
      assets: 2,
    })
  })

  it('declares that request a READ to the verdict', async () => {
    await post(PREVIEW)
    expect(intents).toEqual(['read'])
  })

  it('writes nothing while counting — the claim the read intent makes', async () => {
    lock = null
    const response = await post(PREVIEW)
    expect(response.status).toBe(200)
    // No cascade batch, no `lastPreviewedAt`, no minted document. If this
    // ever fails, the 423 was RIGHT and the declaration must come out.
    expect(writes).toEqual([])
  })
})

describe('AGL-1694 · what the lock must still refuse', () => {
  it('refuses the same action without the preview flag', async () => {
    const { preview, ...cascade } = PREVIEW
    expect(preview).toBe(true)
    const response = await post(cascade)
    expect(response.status).toBe(423)
    expect(intents).toEqual(['write'])
    expect(writes).toEqual([])
  })

  it.each([
    ['rename', { action: 'rename', folderId: 'f-root', name: 'Renamed' }],
    ['delete', { action: 'delete', folderId: 'f-root' }],
    ['move-assets', { action: 'move-assets', mediaIds: ['m-1'] }],
    ['set-private', { action: 'set-private', mediaId: 'm-1', private: true }],
    [
      'custom-metadata',
      { action: 'custom-metadata', mediaId: 'm-1', customMetadata: { a: 'b' } },
    ],
  ])('refuses %s', async (_name, body) => {
    const response = await post(body as Record<string, unknown>)
    expect(response.status).toBe(423)
    expect(intents).toEqual(['write'])
    expect(writes).toEqual([])
  })

  it('does not let a write action buy a read verdict with the flag', async () => {
    // The declaration is the ACTION AND the flag together. `preview` alone
    // is a word in a body a client controls.
    const response = await post({
      action: 'delete',
      folderId: 'f-root',
      preview: true,
    })
    expect(response.status).toBe(423)
    expect(intents).toEqual(['write'])
    expect(writes).toEqual([])
  })

  it('treats a non-boolean preview as the write it would perform', async () => {
    // The branch that skips the writes tests `=== true`. Anything looser
    // here would declare a read and then run the cascade.
    const response = await post({ ...PREVIEW, preview: 'true' })
    expect(response.status).toBe(423)
    expect(intents).toEqual(['write'])
    expect(writes).toEqual([])
  })

  it('refuses the preview under a FULL lock', async () => {
    lock = { scope: 'org', reason: 'abuse', mode: 'full' }
    const response = await post(PREVIEW)
    expect(response.status).toBe(423)
    expect(intents).toEqual(['read'])
  })
})

describe('AGL-1694 · unlocked behaviour is unchanged', () => {
  beforeEach(() => {
    lock = null
  })

  it('still runs the real cascade when no preview is asked for', async () => {
    const { preview, ...cascade } = PREVIEW
    expect(preview).toBe(true)
    const response = await post(cascade)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      folders: 1,
      assets: 2,
      total: 3,
      written: 3,
      done: true,
    })
    // The folder doc plus its two subtree assets, in one committed batch.
    expect(writes).toEqual([
      'batch.set mediaFolders/f-root',
      'batch.set media/m-1',
      'batch.set media/m-2',
      'batch.commit',
    ])
  })
})
