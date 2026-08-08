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
 * The transactional save precondition (AGL-1301).
 *
 * The AGL-674 conflict guard is listener-based: a save clicked between
 * another writer's commit and the local snapshot's delivery sailed straight
 * past it. These specs pin the server-side half — the check that runs on
 * what the transaction actually READ, not on what the client had heard —
 * and the stamp-proofing: a writer that updated `nodes` without touching
 * `updatedAt` (admin scripts did exactly this) must still abort the save.
 */

import { ConcurrentEditError, versionStamp } from '@aglyn/aglyn'
import { saveNodesGuarded } from './guarded-nodes-save'

const mockTransaction = {
  get: jest.fn(),
  set: jest.fn(),
}

jest.mock('firebase/firestore', () => ({
  runTransaction: jest.fn(
    (_firestore: unknown, updater: (tx: unknown) => Promise<void>) =>
      updater(mockTransaction),
  ),
}))

describe('saveNodesGuarded (AGL-1301)', () => {
  /** A Firestore-Timestamp-shaped value, which is what versionStamp reads. */
  const stamp = (millis: number) => ({ toMillis: () => millis })

  const NODES_A = { root: { $id: 'root', componentId: 'div' } }
  const NODES_B = {
    root: { $id: 'root', componentId: 'div', sx: { p: 2 } },
  }
  const NEXT = { nodes: { root: { $id: 'root', componentId: 'section' } } }

  const ref = { firestore: {} } as never

  function storedDocument(value: unknown) {
    mockTransaction.get.mockResolvedValue({ data: () => value })
  }

  beforeEach(() => {
    mockTransaction.get.mockReset()
    mockTransaction.set.mockReset()
  })

  it('commits when the stored document still matches the baseline', async () => {
    storedDocument({ updatedAt: stamp(1), nodes: NODES_A })

    await saveNodesGuarded(ref, NEXT as never, {
      baseStamp: versionStamp(stamp(1)),
      baseNodes: NODES_A,
    })

    expect(mockTransaction.set).toHaveBeenCalledWith(ref, NEXT, {
      merge: true,
    })
  })

  it('aborts a save whose baseline stamp is stale', async () => {
    storedDocument({ updatedAt: stamp(2), nodes: NODES_A })

    await expect(
      saveNodesGuarded(ref, NEXT as never, {
        baseStamp: versionStamp(stamp(1)),
        baseNodes: NODES_A,
      }),
    ).rejects.toThrow(ConcurrentEditError)

    expect(mockTransaction.set).not.toHaveBeenCalled()
  })

  /**
   * The stamp-proofing half: `updatedAt` is an app-level FIELD, and a writer
   * that forgets it is invisible to a stamp comparison. The stored CONTENT
   * cannot lie the same way — if `nodes` moved, someone wrote, stamped or
   * not.
   */
  it('aborts when the nodes changed even though the stamp did not', async () => {
    storedDocument({ updatedAt: stamp(1), nodes: NODES_B })

    await expect(
      saveNodesGuarded(ref, NEXT as never, {
        baseStamp: versionStamp(stamp(1)),
        baseNodes: NODES_A,
      }),
    ).rejects.toThrow(ConcurrentEditError)

    expect(mockTransaction.set).not.toHaveBeenCalled()
  })

  // Same reasoning as `hasConcurrentWrite`: refusing every save on a
  // document we never managed to stamp would break editing entirely to
  // protect against a case we cannot confirm.
  it('commits when no baseline was ever established', async () => {
    storedDocument({ updatedAt: stamp(9), nodes: NODES_B })

    await saveNodesGuarded(ref, NEXT as never, undefined)

    expect(mockTransaction.set).toHaveBeenCalled()
  })

  it('commits over a document that does not exist yet', async () => {
    storedDocument(undefined)

    await saveNodesGuarded(ref, NEXT as never, {
      baseStamp: null,
      baseNodes: undefined,
    })

    expect(mockTransaction.set).toHaveBeenCalledWith(ref, NEXT, {
      merge: true,
    })
  })
})
