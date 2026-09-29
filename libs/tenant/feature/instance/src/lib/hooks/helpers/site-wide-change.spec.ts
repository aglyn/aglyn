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
 * A site-wide change saved from the browser commits its cache drop with it
 * (AGL-3386): the outbox entry rides the write's own batch, the tab's drop
 * releases it on a plain `ok`, and a rule that refuses the entry never costs
 * the save.
 */

import { renderHook } from '@testing-library/react'

interface MockBatch {
  ops: { op: 'set' | 'update' | 'delete'; path: string; data?: unknown; options?: unknown }[]
}
const mockBatches: MockBatch[] = []
const mockCommit = jest.fn()
const mockDeleteDoc = jest.fn()
const mockFetch = jest.fn()

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ collectionPath: name }),
  doc: (first: { collectionPath?: string }, ...segments: string[]) =>
    first?.collectionPath
      ? { path: `${first.collectionPath}/entry-1` }
      : { path: segments.join('/') },
  serverTimestamp: () => '__now__',
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  writeBatch: () => {
    const batch: MockBatch & Record<string, unknown> = {
      ops: [],
      set: (ref: { path: string }, data: unknown, options?: unknown) => {
        batch.ops.push({ op: 'set', path: ref.path, data, options })
      },
      update: (ref: { path: string }, data: unknown) => {
        batch.ops.push({ op: 'update', path: ref.path, data })
      },
      delete: (ref: { path: string }) => {
        batch.ops.push({ op: 'delete', path: ref.path })
      },
      commit: () => mockCommit(batch),
    }
    mockBatches.push(batch)
    return batch
  },
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import {
  announceSiteWideChange,
  commitWithSiteWideEntry,
  SITE_WIDE_OUTBOX_COLLECTION,
  writeSiteWideChange,
} from './site-wide-change'
import { useModifyDocCallback } from './use-modify-doc-callback'

const firestore = {} as never
const user = { getIdToken: async () => 'token' }
const ENTRY = {
  hostId: 'host-1',
  paths: ['/'],
  createdAt: '__now__',
  attempts: 0,
  entireHost: true,
}
const answered = (reason: string, ok = true) => ({
  ok,
  status: ok ? 200 : 423,
  json: async () => ({ reason }),
})
const denied = () =>
  Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
  })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  mockBatches.length = 0
  mockCommit.mockReset().mockResolvedValue(undefined)
  mockDeleteDoc.mockReset().mockResolvedValue(undefined)
  mockFetch.mockReset().mockResolvedValue(answered('ok'))
})

describe('writeSiteWideChange', () => {
  const save = () =>
    writeSiteWideChange({
      firestore,
      user,
      hostId: 'host-1',
      write: (batch) =>
        batch.update({ path: 'hosts/host-1/variables/v1' } as never, { value: '2' }),
    })

  it('commits the write and the site-wide entry as ONE batch', async () => {
    await save()
    expect(mockBatches).toHaveLength(1)
    expect(mockBatches[0].ops).toEqual([
      { op: 'update', path: 'hosts/host-1/variables/v1', data: { value: '2' } },
      {
        op: 'set',
        path: `${SITE_WIDE_OUTBOX_COLLECTION}/entry-1`,
        data: ENTRY,
        options: undefined,
      },
    ])
    expect(mockCommit).toHaveBeenCalledTimes(1)
  })

  it('asks the console for the whole-site drop, and releases the entry on ok', async () => {
    await save()
    await flush()
    expect(mockFetch).toHaveBeenCalledWith(user, '/api/screens/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId: 'host-1', entireHost: true }),
    })
    expect(mockDeleteDoc).toHaveBeenCalledWith({ path: `${SITE_WIDE_OUTBOX_COLLECTION}/entry-1` })
  })

  it.each([
    ['a refusing tenant', answered('tenant-429')],
    ['a refusing console', answered('whatever', false)],
  ])('keeps the entry for the drain after %s', async (_label, response) => {
    mockFetch.mockResolvedValue(response)
    await save()
    await flush()
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('keeps the entry when the request never answered', async () => {
    mockFetch.mockRejectedValue(new Error('offline'))
    await expect(save()).resolves.toBeUndefined()
    await flush()
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('saves without the entry when the rules refuse it — never fails the save for it', async () => {
    mockCommit.mockRejectedValueOnce(denied()).mockResolvedValueOnce(undefined)
    await expect(save()).resolves.toBeUndefined()
    expect(mockBatches).toHaveLength(2)
    expect(mockBatches[1].ops.map((op) => op.path)).toEqual(['hosts/host-1/variables/v1'])
    await flush()
    // The tab's drop still runs; nothing to release.
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('rejects when the write itself is refused, and asks for no drop', async () => {
    mockCommit.mockRejectedValue(denied())
    await expect(save()).rejects.toThrow('insufficient permissions')
    await flush()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects any other failure without a retry', async () => {
    mockCommit.mockRejectedValue(new Error('unavailable'))
    await expect(save()).rejects.toThrow('unavailable')
    expect(mockCommit).toHaveBeenCalledTimes(1)
  })
})

describe('commitWithSiteWideEntry', () => {
  it('stages into a transaction as well as a batch', async () => {
    const staged: unknown[] = []
    const entry = await commitWithSiteWideEntry('host-1', async (stage) => {
      stage?.({ set: (ref, data) => staged.push({ ref, data }) }, firestore)
    })
    expect(entry).toEqual({ path: `${SITE_WIDE_OUTBOX_COLLECTION}/entry-1` })
    expect(staged).toEqual([{ ref: entry, data: ENTRY }])
  })

  it('answers null when the commit staged nothing', async () => {
    await expect(commitWithSiteWideEntry('host-1', async () => undefined)).resolves.toBeNull()
  })
})

describe('announceSiteWideChange', () => {
  it('answers the route’s reason', async () => {
    mockFetch.mockResolvedValue(answered('not-configured'))
    await expect(announceSiteWideChange({ user, hostId: 'h' })).resolves.toBe('not-configured')
  })

  it('answers the status when the console refused', async () => {
    mockFetch.mockResolvedValue(answered('x', false))
    await expect(announceSiteWideChange({ user, hostId: 'h' })).resolves.toBe('console-423')
  })

  it('never throws', async () => {
    mockFetch.mockRejectedValue(new Error('offline'))
    await expect(announceSiteWideChange({ user, hostId: 'h' })).resolves.toBeNull()
  })
})

describe("the library setter's `alongside`", () => {
  const ref = {
    path: 'hosts/host-1',
    firestore: { name: 'db' },
  } as never

  it('lands the write and what `alongside` stages in one commit', async () => {
    const { result } = renderHook(() => useModifyDocCallback(ref))
    const seen: unknown[] = []
    await result.current({ theme: { mode: 'dark' }, $id: 'host-1' } as never, {
      mergeFields: ['theme'],
      alongside: (batch, db) => {
        seen.push(db)
        batch.set({ path: 'publishOutbox/e' } as never, { hostId: 'host-1' })
      },
    })
    expect(mockCommit).toHaveBeenCalledTimes(1)
    const [batch] = mockBatches
    // SET, with the caller's merge options and none of its own keys; the
    // `$id` the readers attach is stripped and `updatedAt` stamped, as on
    // the unbatched path.
    expect(batch.ops[0]).toEqual({
      op: 'set',
      path: 'hosts/host-1',
      data: { updatedAt: expect.anything(), theme: { mode: 'dark' } },
      options: { mergeFields: ['theme'] },
    })
    expect(batch.ops[1]).toMatchObject({ op: 'set', path: 'publishOutbox/e' })
    expect(seen).toEqual([{ name: 'db' }])
  })

  it('updates when no merge option is given, exactly as without it', async () => {
    const { result } = renderHook(() => useModifyDocCallback(ref))
    await result.current({ logoUrl: '/l.png' } as never, { alongside: () => undefined })
    expect(mockBatches[0].ops[0]).toMatchObject({
      op: 'update',
      path: 'hosts/host-1',
      data: { logoUrl: '/l.png' },
    })
  })
})
