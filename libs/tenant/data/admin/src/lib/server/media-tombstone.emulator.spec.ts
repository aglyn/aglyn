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
 * AGL-1467: a DAM delete is reversible, proved by running it.
 *
 * The four facts an undo rests on, none of which a source-reading spec can
 * establish:
 *
 *  1. The delete leaves a tombstone carrying the object's **generation** —
 *     the number `File.restore()` takes, and the one nobody was capturing.
 *     Asserted against the value the object had WHILE LIVE, together with the
 *     proof that it could not have been read afterwards: the same
 *     `getMetadata()` throws once the object is soft-deleted.
 *  2. A restore brings back the document *verbatim* and both counters, to the
 *     byte. A restore that returns the file but not `visibleTo`, `cdnPath` or
 *     `variants` has produced a different asset wearing the same id.
 *  3. Past the retention window it fails CLEANLY — a real sentence, nothing
 *     half-written, and the counters untouched.
 *  4. Over quota it refuses and KEEPS the tombstone, so the answer is "not
 *     yet" rather than "gone".
 *
 * ## Why Storage is a hand-built double rather than a mock of convenience
 *
 * There is no Storage emulator, and the admin app on a developer machine holds
 * a real service-account credential — an unstubbed run writes to and deletes
 * from the PRODUCTION bucket, which is the one thing this issue must not do.
 * The double below therefore models the property under test rather than
 * stubbing it out: objects have generations, a delete moves the object into a
 * soft-deleted set keyed by generation, `restore()` only succeeds for a
 * generation that is actually in that set, and metadata for a deleted object
 * is unreadable. Every one of those is a way the real bucket can refuse, and
 * a double that always said yes would prove nothing about the generation at
 * all.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns media-tombstone.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

/** Nothing in this file may reach a real bucket. Belt as well as braces. */
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => {
    throw new Error('BLOCKED: this spec must never reach Cloud Storage')
  },
}))

const ORG_ID = 'e2e-media-tombstone-org'
const MEDIA_ID = 'e2e-media-tombstone-asset'
const OBJECT_PATH = `orgs/${ORG_ID}/media/${MEDIA_ID}`
const VARIANT_PATH = `${OBJECT_PATH}__w640.webp`

/**
 * The media document as `/api/media/upload` writes one — every field the
 * restore has to bring back, including the three whose loss is the reason
 * this issue exists (`visibleTo`, `cdnPath`, `variants`).
 */
const MEDIA_DOC = {
  fileName: 'hero-banner.png',
  contentType: 'image/png',
  sizeBytes: 4096,
  url: 'https://firebasestorage.googleapis.com/v0/b/bucket/o/hero?alt=media',
  storagePath: OBJECT_PATH,
  folderId: 'brand-assets',
  width: 1200,
  height: 630,
  uploadedBy: 'e2e-uploader-uid',
  contentHash: 'abc123def456',
  variants: [640],
  visibleTo: ['org'],
  cdnPath: `/api/media/cdn/org:${ORG_ID}/${MEDIA_ID}`,
  alt: 'The banner nobody meant to delete',
  description: 'Deleted on 2026-08-13 by mistake, twice.',
  tags: ['brand', 'hero'],
  customMetadata: { campaign: 'launch' },
}

/** A bucket double with generations and a soft-delete set. See the header. */
function fakeBucket() {
  let nextGeneration = 1_700_000_000_000
  const live = new Map<string, string>()
  const softDeleted = new Set<string>()
  // Stringified on the way in: `restore()` takes a number (the SDK's own
  // signature) and the tombstone stores a string, and a double that has lost
  // a digit must not silently match the key it should have missed.
  const key = (path: string, generation: string | number) =>
    `${path}#${String(generation)}`

  const bucket = {
    /** Put an object there, as an upload would. */
    put(path: string): string {
      const generation = String((nextGeneration += 7))
      live.set(path, generation)
      return generation
    },
    isLive: (path: string) => live.has(path),
    generationOf: (path: string) => live.get(path) ?? null,
    /** Drop the soft-deleted copy — the bucket past its retention window. */
    expire(path: string, generation: string) {
      softDeleted.delete(key(path, generation))
    },
    file(path: string) {
      return {
        async getMetadata() {
          const generation = live.get(path)
          if (!generation) {
            // What the real API does for an object that is not live — and the
            // reason the generation has to be captured before the delete.
            throw Object.assign(new Error('No such object'), { code: 404 })
          }
          return [{ generation }]
        },
        async delete() {
          const generation = live.get(path)
          if (!generation) throw Object.assign(new Error('No such object'), { code: 404 })
          live.delete(path)
          softDeleted.add(key(path, generation))
        },
        async exists() {
          return [live.has(path)]
        },
        async restore({ generation }: { generation: number }) {
          if (!softDeleted.has(key(path, generation))) {
            throw Object.assign(
              new Error(`No soft-deleted generation ${generation} for ${path}`),
              { code: 404 },
            )
          }
          softDeleted.delete(key(path, generation))
          live.set(path, String(generation))
          return [{ generation }]
        },
      }
    },
  }
  return bucket
}

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('a DAM delete leaves a restorable tombstone (AGL-1467)', () => {
  let db: Firestore
  let tombstone: typeof import('./media-tombstone')
  let scopeRef: FirebaseFirestore.DocumentReference

  const counters = async () => {
    const doc = await scopeRef.collection('counters').doc('media').get()
    return { bytes: Number(doc.get('bytes') ?? 0), count: Number(doc.get('count') ?? 0) }
  }

  async function reset(): Promise<void> {
    await db.recursiveDelete(scopeRef)
    await scopeRef.set({ name: 'Tombstone Fixture' })
    await scopeRef.collection('media').doc(MEDIA_ID).set(MEDIA_DOC)
    await scopeRef
      .collection('counters')
      .doc('media')
      .set({ bytes: 10_000, count: 3 })
  }

  beforeAll(async () => {
    db = getFirestore()
    tombstone = await import('./media-tombstone')
    scopeRef = db.collection('orgs').doc(ORG_ID)
  }, 60_000)

  afterAll(async () => {
    if (!EMULATED) return
    await db.recursiveDelete(scopeRef)
  }, 60_000)

  beforeEach(async () => {
    await reset()
  }, 60_000)

  it('THE DEFECT: the tombstone carries the generation, captured while live', async () => {
    const bucket = fakeBucket()
    const generation = bucket.put(OBJECT_PATH)
    const variantGeneration = bucket.put(VARIANT_PATH)

    const result = await tombstone.deleteMediaWithTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      objectPath: OBJECT_PATH,
      uid: 'e2e-deleter-uid',
    })
    expect(result.deleted).toBe(true)

    const doc = await scopeRef
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .doc(MEDIA_ID)
      .get()
    expect(doc.exists).toBe(true)
    expect(doc.get('objects')).toEqual([
      { path: OBJECT_PATH, generation },
      { path: VARIANT_PATH, generation: variantGeneration },
    ])

    // The proof that the capture had to happen when it did: the object is
    // gone, and asking the bucket for its generation now throws. Before this
    // issue there was no earlier moment at which anybody asked.
    expect(bucket.isLive(OBJECT_PATH)).toBe(false)
    await expect(bucket.file(OBJECT_PATH).getMetadata()).rejects.toThrow()
  }, 60_000)

  /**
   * The retention decision, pinned. Two independent things are asserted
   * because each fails silently on its own:
   *
   * - The bound is the bucket's soft-delete window EXACTLY. Shorter strands
   *   recoverable bytes with no address, which is the defect this issue fixes
   *   made smaller; longer holds a copy of a customer's asset whose only
   *   possible future is a failed restore — AGL-1443's open question,
   *   volunteered in a new collection.
   * - `expiresAt` is a **Timestamp**. A Firestore TTL policy cannot key on a
   *   number, which is exactly why `bookings.expiresAtMs` is documented as not
   *   a TTL target (`docs/FIRESTORE_MANUAL_CONFIG.md`). Written as a number
   *   this reads fine, restores fine, and never gets reaped.
   */
  it('bounds the tombstone to the bucket window, in a form TTL can reap', async () => {
    const bucket = fakeBucket()
    bucket.put(OBJECT_PATH)
    await tombstone.deleteMediaWithTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      objectPath: OBJECT_PATH,
      uid: 'e2e-deleter-uid',
    })

    const doc = await scopeRef
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .doc(MEDIA_ID)
      .get()
    const expiresAt = doc.get('expiresAt')
    const deletedAt = doc.get('deletedAt')
    expect(typeof expiresAt?.toMillis).toBe('function')
    expect(expiresAt.toMillis() - deletedAt.toMillis()).toBe(
      tombstone.MEDIA_TOMBSTONE_RETENTION_MS,
    )
    expect(tombstone.MEDIA_TOMBSTONE_RETENTION_DAYS).toBe(7)
  }, 60_000)

  it('takes the document and both counters in one commit', async () => {
    const bucket = fakeBucket()
    bucket.put(OBJECT_PATH)
    bucket.put(VARIANT_PATH)
    await tombstone.deleteMediaWithTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      objectPath: OBJECT_PATH,
      uid: 'e2e-deleter-uid',
    })

    const media = await scopeRef.collection('media').doc(MEDIA_ID).get()
    expect(media.exists).toBe(false)
    expect(await counters()).toEqual({ bytes: 10_000 - 4096, count: 2 })
  }, 60_000)

  it('restores the document VERBATIM, the object, the variant and the counters', async () => {
    const bucket = fakeBucket()
    bucket.put(OBJECT_PATH)
    bucket.put(VARIANT_PATH)
    await tombstone.deleteMediaWithTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      objectPath: OBJECT_PATH,
      uid: 'e2e-deleter-uid',
    })

    const restore = await tombstone.restoreMediaFromTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      billing: {},
    })
    expect(restore).toMatchObject({ ok: true, status: 200 })

    // Field for field. A restore that drops `visibleTo`, `cdnPath` or
    // `variants` has produced a different asset with the same id — and the
    // first two decide who can see it and whether it is served at all.
    const media = await scopeRef.collection('media').doc(MEDIA_ID).get()
    expect(media.data()).toEqual(MEDIA_DOC)

    expect(await counters()).toEqual({ bytes: 10_000, count: 3 })
    expect(bucket.isLive(OBJECT_PATH)).toBe(true)
    expect(bucket.isLive(VARIANT_PATH)).toBe(true)

    // Consumed: the tombstone is a copy of customer data and must not outlive
    // its purpose by a single request.
    const doc = await scopeRef
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .doc(MEDIA_ID)
      .get()
    expect(doc.exists).toBe(false)
  }, 60_000)

  it('a second undo is a no-op, not a second counter increment', async () => {
    const bucket = fakeBucket()
    bucket.put(OBJECT_PATH)
    await tombstone.deleteMediaWithTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      objectPath: OBJECT_PATH,
      uid: 'e2e-deleter-uid',
    })
    const args = { scopeRef, bucket, mediaId: MEDIA_ID, billing: {} }
    await tombstone.restoreMediaFromTombstone(args)
    const second = await tombstone.restoreMediaFromTombstone(args)

    expect(second.ok).toBe(true)
    expect(second.message.toLowerCase()).toContain('already')
    expect(await counters()).toEqual({ bytes: 10_000, count: 3 })
  }, 60_000)

  it('past the window it fails cleanly, with a sentence and no half-restore', async () => {
    const bucket = fakeBucket()
    const generation = bucket.put(OBJECT_PATH)
    const deletedAt =
      Date.now() - tombstone.MEDIA_TOMBSTONE_RETENTION_MS - 60_000
    await tombstone.deleteMediaWithTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      objectPath: OBJECT_PATH,
      uid: 'e2e-deleter-uid',
      nowMs: deletedAt,
    })
    // The bucket reaped the bytes when its own window closed — the state the
    // tombstone must never outlive, and the reason the two are the same seven
    // days rather than a number each.
    bucket.expire(OBJECT_PATH, generation)

    const before = await counters()
    const restore = await tombstone.restoreMediaFromTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      billing: {},
    })

    expect(restore.ok).toBe(false)
    expect(restore.status).toBe(410)
    // A real message, naming the file and saying what happened — not a code.
    expect(restore.message).toContain('"hero-banner.png"')
    expect(restore.message.toLowerCase()).toContain('no longer recoverable')

    // Nothing half-written: no document, no counter movement, and the dead
    // tombstone reaped rather than left as a copy with no future.
    expect((await scopeRef.collection('media').doc(MEDIA_ID).get()).exists).toBe(
      false,
    )
    expect(await counters()).toEqual(before)
    const doc = await scopeRef
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .doc(MEDIA_ID)
      .get()
    expect(doc.exists).toBe(false)
  }, 60_000)

  it('refuses a restore that would breach the plan, and KEEPS the tombstone', async () => {
    const bucket = fakeBucket()
    bucket.put(OBJECT_PATH)
    await tombstone.deleteMediaWithTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      objectPath: OBJECT_PATH,
      uid: 'e2e-deleter-uid',
    })
    // The library filled up with something else in the meantime. A free org's
    // cap is 250 MB; this leaves less than the asset's 4 KB of room.
    await scopeRef
      .collection('counters')
      .doc('media')
      .set({ bytes: 250 * 1024 * 1024 - 10, count: 900 })

    const restore = await tombstone.restoreMediaFromTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      billing: {},
    })

    expect(restore.ok).toBe(false)
    expect(restore.status).toBe(403)
    expect(restore.message).toContain('250 MB')
    // "Not yet", not "gone": the tombstone stays, so freeing space and trying
    // again inside the window still works. A refusal that also destroyed the
    // record would turn a quota answer into a permanent loss.
    const doc = await scopeRef
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .doc(MEDIA_ID)
      .get()
    expect(doc.exists).toBe(true)
    expect((await scopeRef.collection('media').doc(MEDIA_ID).get()).exists).toBe(
      false,
    )
  }, 60_000)

  /**
   * The delete's object sweep is best-effort and always was, so a tombstone
   * whose object never actually left is a real state. Restoring must notice
   * rather than call `restore()` on a live generation, which the API refuses.
   */
  it('restores an asset whose object delete had failed', async () => {
    const bucket = fakeBucket()
    const generation = bucket.put(OBJECT_PATH)
    const objects = [{ path: OBJECT_PATH, generation }]
    await scopeRef
      .collection(tombstone.MEDIA_TOMBSTONE_COLLECTION)
      .doc(MEDIA_ID)
      .set({
        media: MEDIA_DOC,
        objects,
        sizeBytes: MEDIA_DOC.sizeBytes,
        fileName: MEDIA_DOC.fileName,
        deletedBy: 'e2e-deleter-uid',
        deletedAt: Date.now(),
        expiresAt: tombstone.mediaTombstoneExpiry(Date.now()),
      })
    await scopeRef.collection('media').doc(MEDIA_ID).delete()

    const restore = await tombstone.restoreMediaFromTombstone({
      scopeRef,
      bucket,
      mediaId: MEDIA_ID,
      billing: {},
    })
    expect(restore.ok).toBe(true)
    expect(bucket.isLive(OBJECT_PATH)).toBe(true)
  }, 60_000)
})
