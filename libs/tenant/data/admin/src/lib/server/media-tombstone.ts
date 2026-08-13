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

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { checkQuota } from '@aglyn/aglyn/server'

/**
 * What a DAM delete has to leave behind for an undo to be possible at all
 * (AGL-1467).
 *
 * ## The gap this closes
 *
 * The bucket has soft-delete on with a **seven-day** retention, so the bytes
 * of a deleted asset really are still there. That was only ever half of an
 * undo, and AGL-1461 shipped honest copy rather than a button because of the
 * other half: `/api/media/upload`'s DELETE branch hard-deleted the Firestore
 * document. After it ran, nothing in the product knew the asset's id, file
 * name, folder, tags, alt text, description, custom metadata, `visibleTo`
 * scope tokens, `cdnPath` or `variants` — and `File.restore()` needs a
 * **generation number** that nobody had captured. Surviving bytes with no
 * address are not a recovery story. On 2026-08-13 two files deleted in error
 * came back only because an unrelated analysis document happened to have
 * recorded their ids; a customer has no such document.
 *
 * A tombstone is the three facts that make the bytes addressable again:
 *
 *  1. the media document verbatim, as it was at the moment of the delete;
 *  2. the **generation** of the storage object and of every CDN variant,
 *     read BEFORE the delete — afterwards there is no live object to ask;
 *  3. `sizeBytes`, so the counter decrement can be reversed by exactly the
 *     amount it moved rather than by a recomputation that can drift.
 *
 * ## Where it lives, and why that is the whole erasure answer
 *
 * `{hosts|orgs}/{scopeId}/mediaTombstones/{mediaId}` — a subcollection of the
 * scope that owned the asset, never a top-level collection keyed by media id.
 *
 * This is the load-bearing choice. `eraseHost` ends in
 * `recursiveDelete(hostRef)` and `eraseOrg` ends in `recursiveDelete(orgRef)`,
 * and a path-scoped cascade takes every subcollection under the path with it.
 * Put the tombstones there and an erasure removes them with no new code — put
 * them in a top-level `mediaTombstones/{id}` with an `orgId` field and they
 * become exactly the shape AGL-1444 and AGL-1448 had to go back and wire by
 * hand: a collection the cascade is structurally blind to, holding a verbatim
 * copy of customer content, surviving the request that promised it was gone.
 * A tombstone is customer data. It has to die with the customer.
 *
 * (The property is asserted rather than assumed —
 * `erase-media-tombstones.emulator.spec.ts` erases a host and an org that each
 * hold one and looks for the survivor.)
 *
 * ## Retention: the same seven days as the bytes, and not a day more
 *
 * `expiresAt` is stamped at `MEDIA_TOMBSTONE_RETENTION_MS` past the delete,
 * which is the bucket's soft-delete window exactly. Both other numbers are
 * wrong for the same reason from opposite directions: a shorter tombstone
 * strands recoverable bytes with no address, which is today's defect made
 * smaller, and a longer one can only ever produce a failed restore while
 * holding a copy of a customer's asset for no reachable purpose. AGL-1443 is
 * open on precisely that — a durable copy of customer data whose retention
 * nobody chose — and this must not become a second instance of it.
 *
 * The field is enforced two ways, because neither alone is enough. A Firestore
 * TTL policy on `mediaTombstones.expiresAt` reaps them (see
 * `docs/FIRESTORE_MANUAL_CONFIG.md`), and TTL deletion is explicitly not
 * prompt — so `restoreMediaFromTombstone` treats an expired tombstone as
 * absent and deletes it on sight rather than trusting the sweeper.
 */

/** The subcollection, under the scope that owned the asset. */
export const MEDIA_TOMBSTONE_COLLECTION = 'mediaTombstones'

/**
 * How long a tombstone lives: the bucket's soft-delete retention, exactly.
 *
 * Changing this without changing the bucket policy breaks the invariant the
 * whole module rests on — see the header.
 */
export const MEDIA_TOMBSTONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Days, for the copy that has to name the window to a person. */
export const MEDIA_TOMBSTONE_RETENTION_DAYS = Math.round(
  MEDIA_TOMBSTONE_RETENTION_MS / (24 * 60 * 60 * 1000),
)

/**
 * One deleted object and the generation that addresses it.
 *
 * `generation` is nullable on purpose: reading it is a Storage round-trip that
 * can fail, and an asset whose object was ALREADY missing (replaced, swept,
 * never written) must still produce a tombstone — the document half of the
 * restore is worth having on its own. A null generation means "nothing to
 * restore here", not "restore failed".
 */
export interface MediaObjectGeneration {
  path: string
  generation: string | null
}

/** The stored tombstone document. */
export interface MediaTombstoneDoc {
  /** The media document verbatim, exactly as the delete found it. */
  media: Record<string, unknown>
  /** Primary object first, then every CDN variant. */
  objects: MediaObjectGeneration[]
  /** The counter decrement to reverse, taken from the document. */
  sizeBytes: number
  fileName: string
  deletedBy: string
  deletedAt: Timestamp | number
  /**
   * Hard bound — see the header. Written as a **Timestamp**, which the TTL
   * policy requires (a number field cannot carry one, which is why
   * `bookings.expiresAtMs` is documented as not a TTL target). Read through
   * `isMediaTombstoneExpired`, which takes either form so a hand-written
   * fixture and the real write are both legible.
   */
  expiresAt: Timestamp | number
}

/**
 * The slice of `File` this module needs; the real one satisfies it.
 *
 * `restore` takes a NUMBER because the SDK's `RestoreOptions` does, while the
 * tombstone stores the generation as a string — a GCS generation is a
 * microsecond timestamp (~1.7e15), comfortably inside a double, but a string
 * is what survives JSON, a Firestore round-trip and a log line without anyone
 * having to reason about that. The conversion happens once, at the call.
 */
export interface TombstoneStorageFile {
  getMetadata(): Promise<any>
  delete(): Promise<any>
  exists(): Promise<any>
  restore(options: { generation: number }): Promise<any>
}

/** The slice of `Bucket` this module needs. */
export interface TombstoneStorageBucket {
  file(path: string): TombstoneStorageFile
}

/** When a tombstone written now stops being useful. */
export function mediaTombstoneExpiry(deletedAtMs: number): number {
  return deletedAtMs + MEDIA_TOMBSTONE_RETENTION_MS
}

/** Milliseconds out of a Firestore Timestamp or a plain number. */
function toMillis(value: unknown): number {
  const timestamp = value as { toMillis?: () => number }
  if (typeof timestamp?.toMillis === 'function') return timestamp.toMillis()
  return Number(value ?? 0)
}

/**
 * Whether the bytes this tombstone addresses are past the bucket's window.
 *
 * Missing or unreadable reads as EXPIRED, which is the safe direction: the
 * failure mode of a false positive is a refusal with a clear message, and the
 * failure mode of a false negative is a restore that half-succeeds against
 * bytes the bucket has already reaped.
 */
export function isMediaTombstoneExpired(
  tombstone: Pick<MediaTombstoneDoc, 'expiresAt'>,
  nowMs: number,
): boolean {
  return !(toMillis(tombstone.expiresAt) > nowMs)
}

/**
 * Read the generation of each object, best-effort (AGL-1467).
 *
 * Must run BEFORE the delete. Once the object is soft-deleted there is no live
 * generation to read, and the number is the only handle `restore()` takes —
 * this is the single fact whose absence made undo impossible rather than
 * merely unbuilt.
 *
 * A failure here degrades the tombstone to its document half rather than
 * failing the delete: an author who asked for a file to go must not be told
 * "no" because a metadata read timed out.
 */
export async function captureObjectGenerations(
  bucket: TombstoneStorageBucket,
  paths: readonly string[],
): Promise<MediaObjectGeneration[]> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        const response = await bucket.file(path).getMetadata()
        const metadata = Array.isArray(response) ? response[0] : response
        const generation = metadata?.generation
        return {
          path,
          generation:
            generation === undefined || generation === null
              ? null
              : String(generation),
        }
      } catch {
        return { path, generation: null }
      }
    }),
  )
}

export interface DeleteMediaResult {
  /** False when there was no document to delete (already gone). */
  deleted: boolean
  /** Present when a tombstone was written — the id is the media id. */
  tombstone?: { mediaId: string; expiresAt: number; fileName: string }
}

/**
 * Delete a media document and leave a tombstone behind, in one commit.
 *
 * **The invariant: the media document is never destroyed except in the same
 * transaction that writes its tombstone and moves the counter.** All three
 * belong to one commit, so there is no interleaving in which the document is
 * gone and the record of it is not — which is the state the product was
 * permanently in before this issue.
 *
 * The object delete happens AFTER that commit, deliberately, and the ordering
 * is a choice between two partial failures:
 *
 *  - object first: a failed commit leaves a live document pointing at bytes
 *    that are already soft-deleted — a broken asset in the library that
 *    nothing detects;
 *  - commit first: a failed object delete leaves a tombstone whose object is
 *    still live, which `restoreMediaFromTombstone` handles by skipping the
 *    restore for an object that is already there.
 *
 * The second is recoverable by the code in this file. The first is not
 * recoverable by anything.
 */
export async function deleteMediaWithTombstone(options: {
  scopeRef: FirebaseFirestore.DocumentReference
  bucket: TombstoneStorageBucket
  mediaId: string
  /** Path of the primary object, resolved by the caller (legacy fallback). */
  objectPath: string
  /** Who asked — an erasure record with no actor is half a record. */
  uid: string
  nowMs?: number
}): Promise<DeleteMediaResult> {
  const { scopeRef, bucket, mediaId, objectPath, uid } = options
  const nowMs = options.nowMs ?? Date.now()
  const mediaRef = scopeRef.collection('media').doc(mediaId)
  const snapshot = await mediaRef.get()
  if (!snapshot.exists) {
    // No document, so nothing to record and nothing to restore to. The object
    // sweep below still runs: an orphan object is exactly what this branch is
    // for, and it predates the tombstone.
    await bucket.file(objectPath).delete().catch(() => undefined)
    return { deleted: false }
  }

  const variantWidths: number[] = snapshot.get('variants') ?? []
  const variantPaths = variantWidths.map(
    (width) => `${objectPath}__w${width}.webp`,
  )
  // BEFORE the delete — the whole point. See `captureObjectGenerations`.
  const objects = await captureObjectGenerations(bucket, [
    objectPath,
    ...variantPaths,
  ])

  const sizeBytes = Number(snapshot.get('sizeBytes') ?? 0)
  const fileName = String(snapshot.get('fileName') ?? mediaId)
  const expiresAt = mediaTombstoneExpiry(nowMs)
  const tombstoneRef = scopeRef
    .collection(MEDIA_TOMBSTONE_COLLECTION)
    .doc(mediaId)
  const counterRef = scopeRef.collection('counters').doc('media')

  const committed = await scopeRef.firestore.runTransaction(
    async (transaction) => {
      const fresh = await transaction.get(mediaRef)
      // Someone else deleted it between the read above and here. Their commit
      // wrote the tombstone; ours must not write a second one over it.
      if (!fresh.exists) return false
      const data = (fresh.data() ?? {}) as Record<string, unknown>
      const tombstone: MediaTombstoneDoc = {
        media: data,
        objects,
        sizeBytes: Number(data['sizeBytes'] ?? sizeBytes) || 0,
        fileName: String(data['fileName'] ?? fileName),
        deletedBy: uid,
        deletedAt: Timestamp.fromMillis(nowMs),
        // Timestamp, not a number: the TTL policy on
        // `mediaTombstones.expiresAt` cannot key on anything else.
        expiresAt: Timestamp.fromMillis(expiresAt),
      }
      transaction.set(tombstoneRef, tombstone)
      transaction.delete(mediaRef)
      transaction.set(
        counterRef,
        {
          bytes: FieldValue.increment(-tombstone.sizeBytes),
          count: FieldValue.increment(-1),
        },
        { merge: true },
      )
      return true
    },
  )

  // Object and variants last, best-effort, exactly as before — the bucket
  // keeps them for the retention window either way.
  await bucket.file(objectPath).delete().catch(() => undefined)
  await Promise.all(
    variantPaths.map((path) =>
      bucket.file(path).delete().catch(() => undefined),
    ),
  )

  if (!committed) return { deleted: false }
  return { deleted: true, tombstone: { mediaId, expiresAt, fileName } }
}

export interface RestoreMediaResult {
  ok: boolean
  /** HTTP status the route should answer with. */
  status: number
  /** A real sentence for a person — never a bare code. */
  message: string
  fileName?: string
}

/**
 * Why a restore cannot proceed, decided without touching Storage (AGL-1467).
 *
 * Pure, because these are the answers a person actually sees and the two
 * interesting ones are cheap to get wrong: an expired tombstone must fail
 * CLEANLY rather than half-succeed against bytes the bucket has already
 * reaped, and a restore that would breach the plan must say so rather than
 * push the counter past the limit in silence.
 *
 * ## The quota call
 *
 * A restore re-adds real bytes, so it is gated exactly like an upload —
 * `storagePerHostMb`, same off-by-one — and REFUSED when it would breach the
 * plan. Waiving it would let delete-then-restore launder an over-quota
 * library, which is the AGL-1471/AGL-1279 shape (a limit evaluated at a moment
 * the caller controls). Refusing is safe precisely because the tombstone
 * outlives the refusal: the asset is still restorable for the rest of the
 * window once space is freed, which is what makes "no, and here is why"
 * an honest answer rather than a loss.
 *
 * Note what is NOT metered: the soft-deleted bytes themselves. They sit in the
 * bucket for seven days at Aglyn's cost, and counting them would mean deleting
 * a file did not free space until a week later — which breaks the one action
 * an author takes when they hit the wall. The window is the price of offering
 * undo, not an allocation to bill back.
 */
export function mediaRestoreRefusal(options: {
  tombstone: Pick<MediaTombstoneDoc, 'expiresAt' | 'sizeBytes' | 'fileName'>
  nowMs: number
  /** Counter bytes as they stand now, with the asset already removed. */
  usedBytes: number
  billing: Record<string, unknown> | undefined
}): { status: number; message: string } | null {
  const { tombstone, nowMs, usedBytes, billing } = options
  if (isMediaTombstoneExpired(tombstone, nowMs)) {
    return {
      status: 410,
      message:
        `"${tombstone.fileName}" was deleted more than ` +
        `${MEDIA_TOMBSTONE_RETENTION_DAYS} days ago, so its file is no ` +
        'longer recoverable.',
    }
  }
  const usedMb = (usedBytes + Number(tombstone.sizeBytes ?? 0)) / (1024 * 1024)
  const quota = checkQuota(
    billing as never,
    'storagePerHostMb',
    Math.ceil(usedMb) - 1,
  )
  if (!quota.allowed) {
    return {
      status: 403,
      message:
        `Restoring "${tombstone.fileName}" would put this library over its ` +
        `storage limit (${quota.limit} MB). Free up space and try again — ` +
        'the file stays restorable until the window closes.',
    }
  }
  return null
}

/**
 * Put a deleted asset back: object, variants, document and counters.
 *
 * Order is the same argument as the delete, run backwards. Bytes first, then
 * the commit — so the only partial state this can leave is an object restored
 * with no document, which the tombstone (still present, because the commit is
 * what consumes it) makes a retry away from finished. The reverse order would
 * publish a document whose bytes may never arrive.
 *
 * The commit itself carries the document write, the tombstone delete and both
 * counter increments together, and it re-reads the tombstone inside the
 * transaction. That re-read is what makes a double-click harmless: the second
 * transaction finds no tombstone, commits nothing, and the caller is told the
 * file is already back rather than being charged for it twice.
 */
export async function restoreMediaFromTombstone(options: {
  scopeRef: FirebaseFirestore.DocumentReference
  bucket: TombstoneStorageBucket
  mediaId: string
  billing: Record<string, unknown> | undefined
  nowMs?: number
}): Promise<RestoreMediaResult> {
  const { scopeRef, bucket, mediaId, billing } = options
  const nowMs = options.nowMs ?? Date.now()
  const mediaRef = scopeRef.collection('media').doc(mediaId)
  const tombstoneRef = scopeRef
    .collection(MEDIA_TOMBSTONE_COLLECTION)
    .doc(mediaId)
  const counterRef = scopeRef.collection('counters').doc('media')

  const tombstoneSnapshot = await tombstoneRef.get()
  if (!tombstoneSnapshot.exists) {
    // Either it was never written, or the window closed and the TTL swept it.
    // Both are the same fact to the caller, and neither is an error state the
    // product can act on.
    const media = await mediaRef.get()
    if (media.exists) {
      return {
        ok: true,
        status: 200,
        message: 'That file is already back in the library.',
        fileName: String(media.get('fileName') ?? mediaId),
      }
    }
    return {
      ok: false,
      status: 404,
      message: 'That file can no longer be restored.',
    }
  }

  const tombstone = tombstoneSnapshot.data() as MediaTombstoneDoc
  const counter = await counterRef.get()
  const usedBytes = Number(counter.get('bytes') ?? 0)
  const refusal = mediaRestoreRefusal({
    tombstone,
    nowMs,
    usedBytes,
    billing,
  })
  if (refusal) {
    // An expired tombstone is dead weight — a copy of customer data whose only
    // possible future is this refusal. Reap it here rather than waiting on a
    // TTL sweep that is documented as unprompt.
    if (refusal.status === 410) {
      await tombstoneRef.delete().catch(() => undefined)
    }
    return { ok: false, ...refusal, fileName: tombstone.fileName }
  }

  const objects = Array.isArray(tombstone.objects) ? tombstone.objects : []
  const [primary, ...variants] = objects
  const restoreObject = async (
    object: MediaObjectGeneration,
  ): Promise<boolean> => {
    if (!object?.generation) return false
    const file = bucket.file(object.path)
    // Already live — the delete's object sweep is best-effort, so this is a
    // real branch, not a defensive one. `restore()` on a live generation is
    // not a no-op, so the check has to come first.
    const existing = await file.exists().catch(() => [false])
    if (Array.isArray(existing) ? existing[0] : existing) return true
    await file.restore({ generation: Number(object.generation) })
    return true
  }

  if (primary) {
    try {
      await restoreObject(primary)
    } catch (error) {
      console.error(
        `restoreMediaFromTombstone: object restore failed for ${mediaId}`,
        error,
      )
      return {
        ok: false,
        status: 502,
        message:
          `"${tombstone.fileName}" could not be restored — its file could ` +
          'not be recovered from storage. Nothing was changed.',
        fileName: tombstone.fileName,
      }
    }
  }
  // Variants are derived artifacts the platform can regenerate, and the upload
  // path already refuses to fail an asset for them. Same call here.
  for (const variant of variants) {
    await restoreObject(variant).catch((error) => {
      console.error(
        `restoreMediaFromTombstone: variant ${variant?.path} failed`,
        error,
      )
      return false
    })
  }

  const restored = await scopeRef.firestore.runTransaction(
    async (transaction) => {
      const fresh = await transaction.get(tombstoneRef)
      if (!fresh.exists) return false
      const record = fresh.data() as MediaTombstoneDoc
      transaction.set(mediaRef, record.media)
      transaction.delete(tombstoneRef)
      transaction.set(
        counterRef,
        {
          bytes: FieldValue.increment(Number(record.sizeBytes ?? 0)),
          count: FieldValue.increment(1),
        },
        { merge: true },
      )
      return true
    },
  )

  return {
    ok: true,
    status: 200,
    message: restored
      ? `Restored "${tombstone.fileName}".`
      : 'That file is already back in the library.',
    fileName: tombstone.fileName,
  }
}
