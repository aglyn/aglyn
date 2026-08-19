/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
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
 * THE RENAME TOMBSTONE NAMES THE HANDLE IT MOVED TO (AGL-2312).
 *
 * `claimPublisherHandle` leaves `{ orgId, movedTo, renamedAt }` on the old
 * handle so old marketplace links keep resolving. Until AGL-2312 nothing read
 * it, so nothing could tell whether the field was right either — a tombstone
 * pointing at the wrong handle, or at a constant, would have looked exactly
 * like the working case for as long as nobody followed it.
 *
 * Now that the publisher page DOES follow it, `movedTo` is a redirect target,
 * and a wrong one sends every inbound link to a stranger's storefront. So the
 * assertion below is not "a tombstone was written": it renames the same handle
 * TWICE to different destinations and demands the field move with the rename.
 *
 * The reader half lives in `apps/console/specs/publisher-handle-moved-to.spec`
 * — it cannot live here, because nx `depConstraints` forbid `scope:app` from
 * importing an `aglyn:addons` lib, so console and marketplace code cannot meet
 * in one module.
 */

const mockStore: Record<string, Record<string, unknown>> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    firestore: { FieldValue: { serverTimestamp: () => 'RENAMED-AT' } },
  },
}))

import { claimPublisherHandle, PublisherHandleTakenError } from './publisher-profile'

/**
 * A transaction double.
 *
 * `tx.set` REPLACES rather than merges, which is the behaviour the writer
 * leans on: re-claiming a handle a previous owner tombstoned has to clear
 * `movedTo`, and a double that merged would hide a real regression there —
 * the redirect would then bounce a live handle to its former owner's new one.
 */
const firestore: any = {
  collection: (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}` }),
  }),
  runTransaction: async (body: (tx: any) => Promise<void>) => {
    const tx = {
      get: async (ref: { path: string }) => ({
        exists: mockStore[ref.path] != null,
        get: (field: string) => mockStore[ref.path]?.[field],
      }),
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        mockStore[ref.path] = { ...data }
      },
    }
    await body(tx)
  },
}

const handleDoc = (handle: string) => mockStore[`publisherHandles/${handle}`]

beforeEach(() => {
  for (const key of Object.keys(mockStore)) delete mockStore[key]
})

describe('a rename leaves a tombstone pointing at the NEW handle', () => {
  it('records the destination the rename actually chose, not a constant', async () => {
    await claimPublisherHandle(firestore, 'org-1', 'brightforge', 'old-handle')
    expect(handleDoc('old-handle')).toEqual({
      orgId: 'org-1',
      movedTo: 'brightforge',
      renamedAt: 'RENAMED-AT',
    })

    // Renamed AGAIN, to somewhere else. A writer stamping a fixed value —
    // or stamping the OLD handle, which is the easy transposition here —
    // satisfies exactly one of these two assertions.
    await claimPublisherHandle(firestore, 'org-1', 'lumenworks', 'brightforge')
    expect(handleDoc('brightforge')?.['movedTo']).toBe('lumenworks')
    // …and the first hop is untouched, so a two-step rename leaves a chain
    // rather than one tombstone overwritten by the next.
    expect(handleDoc('old-handle')?.['movedTo']).toBe('brightforge')
  })

  it('claims the new handle for the org in the same transaction', async () => {
    await claimPublisherHandle(firestore, 'org-1', 'brightforge', 'old-handle')
    expect(handleDoc('brightforge')).toEqual({ orgId: 'org-1' })
  })

  it('writes no tombstone when the handle did not change', async () => {
    // Called on every profile save, so a self-tombstone here would make the
    // page bounce a live handle to itself on the next render.
    await claimPublisherHandle(firestore, 'org-1', 'brightforge', 'brightforge')
    expect(handleDoc('brightforge')).toEqual({ orgId: 'org-1' })
    expect(handleDoc('brightforge')?.['movedTo']).toBeUndefined()
  })

  it('PARKS the old handle with the org that renamed — nobody else may take it', async () => {
    // Written as a discovery: the tombstone carries `orgId`, so the
    // already-taken guard above refuses another org. A renamed handle is
    // therefore reserved forever, not released.
    //
    // That was incidental before AGL-2312 and is load-bearing now. `movedTo`
    // is a REDIRECT TARGET: if a stranger could claim `old-handle`, every
    // link ever published to the original publisher would resolve — through
    // this very page — to whoever grabbed it. Holding the handle is what
    // makes following the tombstone safe.
    await claimPublisherHandle(firestore, 'org-1', 'brightforge', 'old-handle')
    await expect(
      claimPublisherHandle(firestore, 'org-2', 'old-handle'),
    ).rejects.toBeInstanceOf(PublisherHandleTakenError)
    expect(handleDoc('old-handle')?.['orgId']).toBe('org-1')
  })

  it('lets the ORIGINAL org take its old handle back, clearing the tombstone', async () => {
    // A rename undone. The claim is a full `set`, so `movedTo` goes with it —
    // otherwise the page would bounce a handle that now resolves.
    await claimPublisherHandle(firestore, 'org-1', 'brightforge', 'old-handle')
    await claimPublisherHandle(firestore, 'org-1', 'old-handle', 'brightforge')
    expect(handleDoc('old-handle')).toEqual({ orgId: 'org-1' })
    expect(handleDoc('brightforge')?.['movedTo']).toBe('old-handle')
  })

  it('refuses a handle another org holds, and tombstones nothing', async () => {
    mockStore['publisherHandles/taken'] = { orgId: 'org-9' }
    await expect(
      claimPublisherHandle(firestore, 'org-1', 'taken', 'old-handle'),
    ).rejects.toBeInstanceOf(PublisherHandleTakenError)
    expect(handleDoc('old-handle')).toBeUndefined()
  })
})
