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
 * An erasure takes the media tombstones with it (AGL-1467, against AGL-1443).
 *
 * A tombstone is a **verbatim copy of a customer's media document** — file
 * name, alt text, description, tags, custom metadata, the scope tokens saying
 * who could see it. AGL-1467 introduces a new place that copy lives, which
 * makes it the exact class of object AGL-1443 is open on: a durable record of
 * customer content sitting somewhere the erasure path might not reach.
 * AGL-1444 and AGL-1448 each had to go back and hand-wire a collection the
 * cascade was blind to. This spec exists so this one is never on that list.
 *
 * ## The property, and why it is a placement decision rather than a sweep
 *
 * Tombstones live at `{hosts|orgs}/{scopeId}/mediaTombstones/{mediaId}` — a
 * subcollection of the scope that owned the asset. `eraseHost` ends in
 * `recursiveDelete(hostRef)` and `eraseOrg` in `recursiveDelete(orgRef)`, and
 * a path-scoped cascade takes every subcollection beneath the path. So the
 * erasure needs no new code, and the thing worth pinning is the PLACEMENT: the
 * last assertion in each block is that no top-level `mediaTombstones`
 * collection exists at all, because the day somebody moves them there for a
 * cheap cross-scope query is the day this silently becomes AGL-1443 again.
 *
 * Storage is stubbed for the same non-negotiable reason as the other erasure
 * specs: there is no Storage emulator and the admin app holds a real
 * service-account credential, so an unstubbed `eraseOrg`/`eraseHost` writes to
 * and deletes from the PRODUCTION bucket.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-media-tombstones.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

// Before any module reads them: neither integration may be reachable from a
// fixture — one deletes a real billing customer, the other mutates Vercel.
delete process.env.STRIPE_SECRET_KEY
delete process.env.VERCEL_TOKEN
delete process.env.VERCEL_CONSOLE_PROJECT_ID

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

/** No Storage emulator, and the default app holds a production credential. */
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({ save: async () => undefined }),
      deleteFiles: async () => undefined,
    }),
  }),
}))

const ORG_ID = 'e2e-erase-tombstone-org'
const OTHER_ORG_ID = 'e2e-erase-tombstone-bystander'
const HOST_ID = 'e2e-erase-tombstone-host'
const MEDIA_ID = 'e2e-erase-tombstone-asset'

/** The tombstone as `deleteMediaWithTombstone` writes one. */
function tombstoneDoc(path: string) {
  const deletedAt = Date.now()
  return {
    media: {
      fileName: 'contract-scan.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      storagePath: path,
      alt: 'A customer document nobody may keep a copy of',
      tags: ['legal'],
      visibleTo: ['org'],
    },
    objects: [{ path, generation: '1700000000000007' }],
    sizeBytes: 2048,
    fileName: 'contract-scan.pdf',
    deletedBy: 'e2e-deleter-uid',
    deletedAt,
    expiresAt: deletedAt + 7 * 24 * 60 * 60 * 1000,
  }
}

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('an erasure takes the media tombstones (AGL-1467)', () => {
  let db: Firestore
  let erase: typeof import('./erase')
  let tombstone: typeof import('./media-tombstone')

  const tombstonesUnder = async (
    ref: FirebaseFirestore.DocumentReference,
  ): Promise<string[]> => {
    const rows = await ref
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .get()
    return rows.docs.map((doc) => doc.id)
  }

  beforeAll(async () => {
    db = getFirestore()
    erase = await import('./erase')
    tombstone = await import('./media-tombstone')

    for (const id of [ORG_ID, OTHER_ORG_ID]) {
      await db.recursiveDelete(db.collection('orgs').doc(id))
    }
    await db.recursiveDelete(db.collection('hosts').doc(HOST_ID))
  }, 120_000)

  afterAll(async () => {
    if (!EMULATED) return
    for (const id of [ORG_ID, OTHER_ORG_ID]) {
      await db.recursiveDelete(db.collection('orgs').doc(id))
    }
    await db.recursiveDelete(db.collection('hosts').doc(HOST_ID))
    await db.collection('hostIndex').doc(HOST_ID).delete().catch(() => undefined)
  }, 120_000)

  it('eraseHost removes the tombstones under a site library', async () => {
    const hostRef = db.collection('hosts').doc(HOST_ID)
    await hostRef.set({ orgId: ORG_ID, name: 'Tombstone Site' })
    await hostRef
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .doc(MEDIA_ID)
      .set(tombstoneDoc(`hosts/${HOST_ID}/media/${MEDIA_ID}`))
    // Guard the premise: an assertion about a survivor needs something that
    // could have survived.
    expect(await tombstonesUnder(hostRef)).toEqual([MEDIA_ID])

    await erase.eraseHost(HOST_ID)

    expect(await tombstonesUnder(hostRef)).toEqual([])
  }, 120_000)

  it('eraseOrg removes the tombstones under an org library', async () => {
    const orgRef = db.collection('orgs').doc(ORG_ID)
    await orgRef.set({
      name: 'Tombstone Fixture',
      erasureRequestedAt: Timestamp.fromMillis(
        Date.now() - erase.ERASURE_HOLD_MS - 60_000,
      ),
    })
    await orgRef
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .doc(MEDIA_ID)
      .set(tombstoneDoc(`orgs/${ORG_ID}/media/${MEDIA_ID}`))

    const otherRef = db.collection('orgs').doc(OTHER_ORG_ID)
    await otherRef.set({ name: 'Bystander' })
    await otherRef
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .doc(MEDIA_ID)
      .set(tombstoneDoc(`orgs/${OTHER_ORG_ID}/media/${MEDIA_ID}`))

    expect(await tombstonesUnder(orgRef)).toEqual([MEDIA_ID])

    const result = await erase.eraseOrg(ORG_ID)
    expect(result).toMatchObject({ ok: true })

    expect(await tombstonesUnder(orgRef)).toEqual([])
    // The bystander half: every erasure fix in this file's neighbours had a
    // way to take out a live tenant. A cascade cannot, which is exactly why
    // the placement is the fix — but the assertion is cheap and the day
    // somebody replaces it with a sweep is the day it earns its keep.
    expect(await tombstonesUnder(otherRef)).toEqual([MEDIA_ID])
  }, 180_000)

  /**
   * The placement guard. A top-level `mediaTombstones/{mediaId}` carrying an
   * `orgId` field would be a convenient cross-scope query and would be
   * structurally invisible to both cascades — AGL-1444's `apiKeys` and
   * AGL-1448's `ssoDomains` exactly. If this ever fails, the two assertions
   * above have stopped meaning anything.
   */
  it('keeps no top-level tombstone collection for a cascade to miss', async () => {
    const rows = await db
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .limit(1)
      .get()
    expect(rows.size).toBe(0)
  }, 60_000)
})
