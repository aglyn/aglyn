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
 * A console write to the host document drops the live site's cache when it
 * changes something the site renders (AGL-3386).
 *
 * Settings have no publish step. The theme, the favicon, the SEO title, the
 * business details — every one of them is a client write the tenant renders
 * straight off the host document, and before this every one of them waited
 * out the page's hour-long ISR window while the console said "Saved!".
 *
 * These cases pin the door both kinds of writer go through: the console's
 * `useHost` setter, and `updateHostDocument` for the cards that write with a
 * bare document path.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, renderHook } from '@testing-library/react'
import { HOST_CLIENT_WRITABLE_FIELDS } from '@aglyn/aglyn/foundation/definitions/platform.types'

const mockRevalidateLivePages = jest.fn()
const mockUpdateDoc = jest.fn()
const mockLibrarySetDoc = jest.fn()
const mockDeleteDoc = jest.fn()
const mockCommit = jest.fn()
const mockUser = { uid: 'u1', getIdToken: async () => 'token' }

interface MockBatch {
  ops: { op: 'set' | 'update'; path: string; data: Record<string, unknown> }[]
}
/** Every batch the door opened, in order, with what it staged. */
const mockBatches: MockBatch[] = []

jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockRevalidateLivePages(...args),
  revalidateLivePages: (...args: unknown[]) => mockRevalidateLivePages(...args),
}))

jest.mock('@aglyn/aglyn/app-utils/create-resource-uid', () => ({
  createResourceUid: () => 'entry-1',
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ collectionPath: name }),
  doc: (first: { collectionPath?: string }, ...segments: string[]) =>
    first?.collectionPath
      ? { path: `${first.collectionPath}/entry-1` }
      : { path: segments.join('/') },
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  serverTimestamp: () => '__now__',
  writeBatch: () => {
    const batch: MockBatch & Record<string, unknown> = {
      ops: [],
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        batch.ops.push({ op: 'set', path: ref.path, data })
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        batch.ops.push({ op: 'update', path: ref.path, data })
      },
      commit: () => mockCommit(batch),
    }
    mockBatches.push(batch)
    return batch
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHost: () => ({
    doc: { status: 'success', data: { theme: {} } },
    setDoc: (...args: unknown[]) => mockLibrarySetDoc(...args),
  }),
  useUser: () => ({ data: mockUser }),
}))

import {
  announceHostDocumentWrite,
  HOST_FIELDS_WITHOUT_SITE_DROP,
  renderedHostFieldsIn,
  SITE_RENDERED_HOST_FIELDS,
  updateHostDocument,
} from '../utils/host-document-writes'
import { useHost } from '../hooks/use-host'
import { SITE_WIDE_OUTBOX_COLLECTION } from '@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change'
import {
  isSiteWidePublishOutboxEntry,
  PUBLISH_OUTBOX_COLLECTION,
  PUBLISH_OUTBOX_FIELDS,
  PUBLISH_OUTBOX_OPTIONAL_FIELDS,
} from '../constants/publish-outbox'

const OK = { revalidated: 12, pathsDropped: 0, scanTruncated: false, reason: 'ok' }
const firestore = {} as never

/** Lets a fired-and-forgotten promise chain settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The site-wide outbox entry exactly as the rules pin it (AGL-3386). */
const SITE_WIDE_ENTRY = {
  hostId: 'host-1',
  paths: ['/'],
  createdAt: '__now__',
  attempts: 0,
  entireHost: true,
}

const denied = () =>
  Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
  })

beforeEach(() => {
  mockRevalidateLivePages.mockReset().mockResolvedValue(OK)
  mockUpdateDoc.mockReset().mockResolvedValue(undefined)
  mockLibrarySetDoc.mockReset().mockResolvedValue(undefined)
  mockDeleteDoc.mockReset().mockResolvedValue(undefined)
  mockCommit.mockReset().mockResolvedValue(undefined)
  mockBatches.length = 0
})

describe('which writes change what the site renders', () => {
  it.each([
    [{ theme: { palette: {} } }, ['theme']],
    [{ themeOverride: { value: {} } }, ['themeOverride']],
    [{ seo: { favicon: '/favicon.png' } }, ['seo']],
    [{ logoUrl: '/logo.png' }, ['logoUrl']],
    [{ displayName: 'Acme', timeZone: 'America/Chicago' }, ['displayName', 'timeZone']],
  ])('%j is rendered', (payload, fields) => {
    expect(renderedHostFieldsIn(payload)).toEqual(fields)
  })

  it('reads a dotted update path by its top-level field', () => {
    // `updateDoc` addresses nested fields this way — the search indexing
    // switch and the consent banner both write like this.
    expect(renderedHostFieldsIn({ 'seo.discourageSearchEngines': true })).toEqual([
      'seo',
    ])
    expect(renderedHostFieldsIn({ 'consent.mode': 'strict' })).toEqual(['consent'])
  })

  it.each([
    [{ updatedAt: 1 }],
    [{ createdAt: 1, updatedAt: 1 }],
    [{ memberRoles: { u1: 'admin' } }],
    [{ layouts: { l1: 'Main' } }],
    [{ redirects: { r1: true } }],
    [{ screens: { s1: 'pricing' } }],
    [{ $id: 'host-1', updatedAt: 1 }],
  ])('%j is not', (payload) => {
    expect(renderedHostFieldsIn(payload)).toEqual([])
  })

  it('counts an unclassified field as rendered', () => {
    // A field nobody classified is more likely a new setting than a new
    // counter; guessing that way costs one regeneration, not an hour of a
    // live site contradicting its console.
    expect(renderedHostFieldsIn({ someNewSetting: true })).toEqual(['someNewSetting'])
  })

  it('names nothing for an empty or absent payload', () => {
    expect(renderedHostFieldsIn({})).toEqual([])
    expect(renderedHostFieldsIn(null)).toEqual([])
    expect(renderedHostFieldsIn(undefined)).toEqual([])
  })
})

describe('announceHostDocumentWrite', () => {
  it('drops the WHOLE site for a rendered field', async () => {
    const result = await announceHostDocumentWrite({
      user: mockUser,
      hostId: 'host-1',
      payload: { theme: {} },
    })
    expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1)
    expect(mockRevalidateLivePages).toHaveBeenCalledWith({
      user: mockUser,
      hostId: 'host-1',
      entireHost: true,
    })
    expect(result).toEqual(OK)
  })

  it('asks for nothing when only bookkeeping changed', async () => {
    const result = await announceHostDocumentWrite({
      user: mockUser,
      hostId: 'host-1',
      payload: { updatedAt: 1, memberRoles: {} },
    })
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('asks for nothing without a host id', async () => {
    await announceHostDocumentWrite({ user: mockUser, hostId: '', payload: { theme: {} } })
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('swallows a drop that throws, so a landed save never reads as failed', async () => {
    mockRevalidateLivePages.mockRejectedValue(new Error('network down'))
    await expect(
      announceHostDocumentWrite({ user: mockUser, hostId: 'host-1', payload: { seo: {} } }),
    ).resolves.toBeNull()
  })
})

describe('updateHostDocument', () => {
  it('commits the write and its site-wide outbox entry as ONE batch, then drops', async () => {
    await updateHostDocument(
      firestore,
      { user: mockUser, hostId: 'host-1' },
      { 'consent.mode': 'strict' },
    )
    await flush()
    // Both documents or neither: a pending entry always describes a save that
    // really landed, and a landed save always has an entry behind it.
    expect(mockBatches).toHaveLength(1)
    expect(mockBatches[0].ops).toEqual([
      { op: 'update', path: 'hosts/host-1', data: { 'consent.mode': 'strict' } },
      { op: 'set', path: 'publishOutbox/entry-1', data: SITE_WIDE_ENTRY },
    ])
    expect(mockCommit).toHaveBeenCalledTimes(1)
    expect(mockUpdateDoc).not.toHaveBeenCalled()
    expect(mockRevalidateLivePages).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'host-1', entireHost: true }),
    )
  })

  it('releases the entry once the drop answers ok', async () => {
    await updateHostDocument(firestore, { user: mockUser, hostId: 'host-1' }, { theme: {} })
    await flush()
    expect(mockDeleteDoc).toHaveBeenCalledWith({ path: 'publishOutbox/entry-1' })
  })

  it('keeps the entry for the drain when the tenant refused', async () => {
    mockRevalidateLivePages.mockResolvedValue({ ...OK, reason: 'tenant-429' })
    await updateHostDocument(firestore, { user: mockUser, hostId: 'host-1' }, { theme: {} })
    await flush()
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('keeps the entry when the drop answered nothing at all', async () => {
    mockRevalidateLivePages.mockResolvedValue(null)
    await updateHostDocument(firestore, { user: mockUser, hostId: 'host-1' }, { theme: {} })
    await flush()
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('saves WITHOUT the entry when the rules refuse it, rather than failing the save', async () => {
    // The window between a code release and the rules deploy that admits the
    // author's entry, or a role the outbox rule does not cover.
    mockCommit.mockRejectedValueOnce(denied()).mockResolvedValueOnce(undefined)
    await expect(
      updateHostDocument(firestore, { user: mockUser, hostId: 'host-1' }, { logoUrl: '/l.png' }),
    ).resolves.toBeNull()
    await flush()
    expect(mockBatches).toHaveLength(2)
    expect(mockBatches[1].ops).toEqual([
      { op: 'update', path: 'hosts/host-1', data: { logoUrl: '/l.png' } },
    ])
    // The tab's drop still runs; there is no entry to release.
    expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1)
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('rejects, and drops nothing, when the write itself is refused', async () => {
    mockCommit.mockRejectedValue(denied())
    await expect(
      updateHostDocument(firestore, { user: mockUser, hostId: 'host-1' }, { theme: {} }),
    ).rejects.toThrow('insufficient permissions')
    await flush()
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('rejects on any other failure without retrying', async () => {
    mockCommit.mockRejectedValue(new Error('unavailable'))
    await expect(
      updateHostDocument(firestore, { user: mockUser, hostId: 'host-1' }, { theme: {} }),
    ).rejects.toThrow('unavailable')
    expect(mockCommit).toHaveBeenCalledTimes(1)
    await flush()
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('writes a bookkeeping-only payload plainly — no entry, no drop', async () => {
    await updateHostDocument(firestore, { user: mockUser, hostId: 'host-1' }, { updatedAt: 1 })
    await flush()
    expect(mockUpdateDoc).toHaveBeenCalledWith({ path: 'hosts/host-1' }, { updatedAt: 1 })
    expect(mockBatches).toHaveLength(0)
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('does not hold the save for the drop unless asked to', async () => {
    let release: (value: unknown) => void = () => undefined
    mockRevalidateLivePages.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    // Resolves while the drop is still pending — a settings card has nothing
    // to say about the cache, so its "Saved!" must not wait on the tenant.
    await expect(
      updateHostDocument(firestore, { user: mockUser, hostId: 'host-1' }, { logoUrl: '' }),
    ).resolves.toBeNull()
    expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1)
    release(OK)
  })

  it('hands the drop back when the caller awaits it', async () => {
    const result = await updateHostDocument(
      firestore,
      { user: mockUser, hostId: 'host-1' },
      { maintenance: true },
      { awaitAnnounce: true },
    )
    expect(result).toEqual(OK)
  })

  it('still resolves when the awaited drop fails', async () => {
    mockRevalidateLivePages.mockRejectedValue(new Error('tenant down'))
    await expect(
      updateHostDocument(
        firestore,
        { user: mockUser, hostId: 'host-1' },
        { maintenance: true },
        { awaitAnnounce: true },
      ),
    ).resolves.toBeNull()
  })
})

describe("the console's useHost", () => {
  it('stages the site-wide entry beside a rendered write, then drops and releases', async () => {
    // The library setter commits `alongside` in the SAME batch as the write;
    // this double runs it against a batch of its own to see what it stages.
    const staged: { path: string; data: Record<string, unknown> }[] = []
    mockLibrarySetDoc.mockImplementation(async (_payload, options) => {
      options?.alongside?.(
        {
          set: (ref: { path: string }, data: Record<string, unknown>) =>
            staged.push({ path: ref.path, data }),
        },
        {},
      )
    })
    const { result } = renderHook(() => useHost({ hostId: 'host-1' }))
    await act(async () => {
      await result.current.setDoc({ seo: { favicon: '/f.png' } }, { merge: true })
    })
    await flush()
    expect(mockLibrarySetDoc).toHaveBeenCalledTimes(1)
    expect(mockLibrarySetDoc.mock.calls[0][0]).toEqual({ seo: { favicon: '/f.png' } })
    expect(mockLibrarySetDoc.mock.calls[0][1]).toMatchObject({ merge: true })
    expect(staged).toEqual([{ path: 'publishOutbox/entry-1', data: SITE_WIDE_ENTRY }])
    expect(mockRevalidateLivePages).toHaveBeenCalledWith({
      user: mockUser,
      hostId: 'host-1',
      entireHost: true,
    })
    expect(mockDeleteDoc).toHaveBeenCalledWith({ path: 'publishOutbox/entry-1' })
  })

  it('saves without the entry when the rules refuse it', async () => {
    mockLibrarySetDoc.mockImplementationOnce(async (_payload, options) => {
      options?.alongside?.({ set: () => undefined }, {})
      throw denied()
    })
    const { result } = renderHook(() => useHost({ hostId: 'host-1' }))
    await act(async () => {
      await expect(result.current.setDoc({ theme: {} } as never)).resolves.toBeUndefined()
    })
    await flush()
    expect(mockLibrarySetDoc).toHaveBeenCalledTimes(2)
    // The retry is the plain write, exactly as before the entry existed.
    expect(mockLibrarySetDoc.mock.calls[1][1]).toBeUndefined()
    expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1)
    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('passes a bookkeeping-only write straight through, with no entry', async () => {
    const { result } = renderHook(() => useHost({ hostId: 'host-1' }))
    await act(async () => {
      await result.current.setDoc({ updatedAt: 2 } as never, { merge: true })
    })
    expect(mockLibrarySetDoc).toHaveBeenCalledWith({ updatedAt: 2 }, { merge: true })
  })

  it('drops nothing for a write the site does not render', async () => {
    const { result } = renderHook(() => useHost({ hostId: 'host-1' }))
    await act(async () => {
      await result.current.setDoc({ updatedAt: 1 } as never)
    })
    await flush()
    expect(mockLibrarySetDoc).toHaveBeenCalledTimes(1)
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('drops nothing, and rejects as before, when the write fails', async () => {
    mockLibrarySetDoc.mockRejectedValue(new Error('permission-denied'))
    const { result } = renderHook(() => useHost({ hostId: 'host-1' }))
    await act(async () => {
      await expect(result.current.setDoc({ theme: {} } as never)).rejects.toThrow(
        'permission-denied',
      )
    })
    await flush()
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('keeps a successful save successful when the drop fails', async () => {
    mockRevalidateLivePages.mockRejectedValue(new Error('tenant down'))
    const { result } = renderHook(() => useHost({ hostId: 'host-1' }))
    await act(async () => {
      await expect(
        result.current.setDoc({ theme: {} } as never),
      ).resolves.toBeUndefined()
    })
    await flush()
  })

  it('hands back the listener untouched', () => {
    const { result } = renderHook(() => useHost({ hostId: 'host-1' }))
    expect(result.current.doc).toEqual({ status: 'success', data: { theme: {} } })
  })
})

describe('every host field a client can write is classified', () => {
  const rules = readFileSync(
    join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.rules'),
    'utf8',
  )
  /**
   * The admin tier of the host update rule — the keys only a site `admin`
   * may write from the client. Parsed rather than re-typed, so a key added
   * to the rule arrives here without anyone remembering to.
   */
  const adminTier = (() => {
    const at = rules.indexOf("(hostMemberRole(hostId) == 'admin' ||")
    const list = rules.slice(at, rules.indexOf(']', at))
    return [...list.matchAll(/'([A-Za-z]+)'/g)]
      .map((match) => match[1])
      .filter((field) => field !== 'admin')
  })()

  it('found the admin tier it means to classify', () => {
    // Premise guard: a reworded rule would otherwise leave this list empty
    // and the case below passing against nothing.
    expect(adminTier).toEqual(
      expect.arrayContaining(['enabledPlugins', 'authScreens', 'approvedImageHosts']),
    )
  })

  it('in exactly one of the two maps', () => {
    const writable = [...Object.keys(HOST_CLIENT_WRITABLE_FIELDS), ...adminTier]
    const unclassified = writable.filter(
      (field) =>
        !(field in SITE_RENDERED_HOST_FIELDS) &&
        !(field in HOST_FIELDS_WITHOUT_SITE_DROP),
    )
    expect(unclassified).toEqual([])
    const both = Object.keys(SITE_RENDERED_HOST_FIELDS).filter(
      (field) => field in HOST_FIELDS_WITHOUT_SITE_DROP,
    )
    expect(both).toEqual([])
  })
})

describe('the site-wide entry and the publish outbox are one collection and one shape', () => {
  it('names the same collection', () => {
    expect(SITE_WIDE_OUTBOX_COLLECTION).toBe(PUBLISH_OUTBOX_COLLECTION)
  })

  it('writes every required key, and nothing the rule does not allow', () => {
    const keys = Object.keys(SITE_WIDE_ENTRY)
    expect(keys).toEqual(expect.arrayContaining([...PUBLISH_OUTBOX_FIELDS]))
    const allowed = new Set<string>([
      ...PUBLISH_OUTBOX_FIELDS,
      ...PUBLISH_OUTBOX_OPTIONAL_FIELDS,
    ])
    expect(keys.filter((key) => !allowed.has(key))).toEqual([])
    // The drain reads the flag with the console's own predicate.
    expect(isSiteWidePublishOutboxEntry(SITE_WIDE_ENTRY.entireHost)).toBe(true)
  })
})
