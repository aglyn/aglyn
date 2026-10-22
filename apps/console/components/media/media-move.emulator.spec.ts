/**
 * @jest-environment node
 */

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
 * AGL-1469 / AGL-1470 against a REAL Firestore.
 *
 * Both issues share one rule: **the message is the thing under suspicion, so
 * it cannot be its own evidence.** A bulk move reported "Move failed" while
 * seven files had moved, and a picker offered two rows reading `Covers` with
 * no way to tell which was which. In both cases the only witness that cannot
 * be fooled is the stored document.
 *
 * So this asserts stored `folderId`s: which assets a budget-bounded move
 * actually relocated, and which `Covers` a picked choice actually landed in.
 *
 * `moveAssetsWithinBudget` is exercised here with a `moveOne` that performs
 * the FIRESTORE half of a real move. The GCS half is deliberately absent —
 * there is no Storage emulator in this project (`npm run firebase:emulate`
 * starts auth, firestore and database only), and faking a bucket would make
 * this a test of the fake. What it does prove is the property the issue is
 * about, which is not "does a copy work" but "when the request stops early,
 * do the stored documents agree with the number the snackbar reports".
 *
 * Skipped unless the Firestore emulator host is set, so a normal `jest` run
 * is unaffected and this can never touch production:
 *
 *   npm run firebase:emulate
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c apps/console/jest.config.ts --testPathPatterns media-move
 */

import * as Aglyn from '@aglyn/aglyn'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { MOVE_BUDGET_MS, moveAssetsWithinBudget } from '../../utils/server/media-move'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'media-move-jest'

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('DAM bulk move (emulator)', () => {
  let db: Firestore
  let media: FirebaseFirestore.CollectionReference
  let folders: FirebaseFirestore.CollectionReference

  beforeAll(async () => {
    db = getFirestore()
    media = db.collection('orgs').doc(ORG).collection('media')
    folders = db.collection('orgs').doc(ORG).collection('mediaFolders')
    for (const collection of [media, folders]) {
      const existing = await collection.get()
      await Promise.all(existing.docs.map((doc) => doc.ref.delete()))
    }
  })

  /** What the route's `moveOne` does to Firestore, minus the bucket. */
  const writeFolderId =
    (folderId: string | null) => async (mediaId: string) => {
      await media.doc(mediaId).set({ folderId }, { merge: true })
    }

  async function storedFolderIds(ids: string[]) {
    const entries = await Promise.all(
      ids.map(async (id) => [id, (await media.doc(id).get()).get('folderId')]),
    )
    return Object.fromEntries(entries)
  }

  /**
   * The reported scenario, reproduced: nineteen assets, a request that
   * cannot finish them, and the question the red snackbar refused to answer
   * — which ones moved.
   */
  it('the documents that moved are exactly the ones the split names', async () => {
    const ids = Array.from({ length: 19 }, (_, i) => `asset-${i + 1}`)
    await Promise.all(
      ids.map((id) => media.doc(id).set({ name: `${id}.png`, folderId: null })),
    )
    await folders.doc('blog').set(
      Aglyn.newMediaFolderDoc({
        name: 'Blog',
        parentId: null,
        createdAt: new Date('2026-08-13T12:00:00Z'),
        visibleTo: [Aglyn.ORG_SCOPE_TOKEN],
      }),
    )

    // A clock that spends a quarter of the budget per asset, so the request
    // stops with work left — the shape that produced the bug.
    let elapsed = 0
    const result = await moveAssetsWithinBudget({
      mediaIds: ids,
      now: () => elapsed,
      moveOne: async (id) => {
        elapsed += MOVE_BUDGET_MS / 4
        await writeFolderId('blog')(id)
      },
    })

    expect(result.done).toBe(false)
    expect(result.movedIds.length).toBeLessThan(ids.length)

    const stored = await storedFolderIds(ids)
    // The assertion the snackbar could not make about itself.
    for (const id of result.movedIds) expect(stored[id]).toBe('blog')
    for (const id of result.remainingIds) expect(stored[id]).toBeNull()
    expect(result.movedIds.length + result.remainingIds.length).toBe(19)
  })

  /**
   * A failure mid-run leaves the earlier documents moved. That is the fact
   * "Move failed" denied, and it is asserted on storage rather than on the
   * return value so a bug in the accounting cannot hide it.
   */
  it('a failed asset does not un-move the ones before it', async () => {
    const ids = ['keep-1', 'keep-2', 'boom', 'keep-3']
    await Promise.all(
      ids.map((id) => media.doc(id).set({ name: `${id}.png`, folderId: null })),
    )

    const result = await moveAssetsWithinBudget({
      mediaIds: ids,
      now: () => 0,
      moveOne: async (id) => {
        if (id === 'boom') throw new Error('storage said no')
        await writeFolderId('blog')(id)
      },
    })

    expect(result.movedIds).toEqual(['keep-1', 'keep-2', 'keep-3'])
    expect(result.failedIds).toEqual(['boom'])
    const stored = await storedFolderIds(ids)
    expect(stored['keep-1']).toBe('blog')
    expect(stored['keep-3']).toBe('blog')
    expect(stored['boom']).toBeNull()
  })

  /**
   * AGL-1470 end to end: two folders named `Covers` under different parents,
   * the picker's own choices, and then the stored `folderId` — because the
   * whole danger of that bug is that picking wrong is silent, so the menu
   * label is precisely what may not be trusted as the witness.
   */
  it('a picked "Blog / Covers" lands the file under Blog, not Press', async () => {
    const tree = [
      { id: 'blog', name: 'Blog', parentId: null },
      { id: 'press', name: 'Press', parentId: null },
      { id: 'blog-covers', name: 'Covers', parentId: 'blog' },
      { id: 'press-covers', name: 'Covers', parentId: 'press' },
    ]
    await Promise.all(
      tree.map((folder) =>
        folders.doc(folder.id).set(
          Aglyn.newMediaFolderDoc({
            name: folder.name,
            parentId: folder.parentId,
            createdAt: new Date('2026-08-13T12:00:00Z'),
            visibleTo: [Aglyn.ORG_SCOPE_TOKEN],
          }),
        ),
      ),
    )
    await media.doc('cover-shot').set({ name: 'cover.png', folderId: null })

    // The picker's list, built the way the component builds it, from the
    // documents the listener would return.
    const snapshot = await folders.get()
    const choices = Aglyn.mediaFolderChoices(
      snapshot.docs.map((doc) => ({ $id: doc.id, ...doc.data() }) as any),
    )
    const labels = choices.map((choice) => choice.label)
    expect(new Set(labels).size).toBe(labels.length)

    const picked = choices.find((choice) => choice.label === 'Blog / Covers')
    expect(picked).toBeDefined()

    await moveAssetsWithinBudget({
      mediaIds: ['cover-shot'],
      now: () => 0,
      moveOne: writeFolderId(picked!.$id),
    })

    const landed = (await media.doc('cover-shot').get()).get('folderId')
    expect(landed).toBe('blog-covers')
    expect(
      (await folders.doc(String(landed)).get()).get('parentId'),
    ).toBe('blog')
  })
})
