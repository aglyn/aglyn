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

import { FieldValue } from 'firebase-admin/firestore'
import {
  MEDIA_VARIANT_ENCODER_VERSION,
  MEDIA_VARIANT_ENCODER_VERSION_FIELD,
  mediaDisplayObjectPath,
  mediaVariantEncoderVersionOf,
} from '@aglyn/aglyn/app-utils/media-ref'

import {
  generateMediaVariants,
  MEDIA_DISPLAY_TYPES,
  MEDIA_TYPES_WITHOUT_VARIANTS,
  MEDIA_VARIANT_SOURCE_MAX_BYTES,
  mediaVariantDocFields,
  mediaVariantWidthsFor,
  type SaveMediaDerivedObject,
} from './media-variants'

/**
 * Lazy regeneration of an asset's delivery copies (AGL-3486).
 *
 * A change to the encoder — its quality, the width ladder, the display copy —
 * has to reach every asset already in every library, and the obvious tool is
 * a backfill script: a pass over the corpus that somebody has to remember to
 * run, against production, after each deploy that changes the encoder. The
 * last one (`backfill-media-variants.mjs`) was written, documented as
 * outstanding and never converged.
 *
 * So the CDN converges the corpus itself. A media document records the
 * encoder generation that made its copies
 * (`MEDIA_VARIANT_ENCODER_VERSION_FIELD`); a request that finds it older than
 * `MEDIA_VARIANT_ENCODER_VERSION` is SERVED what exists — an old variant, or
 * the original — and the asset is regenerated after the response. Every asset
 * a visitor actually sees reaches the new encoder on its first view; one
 * nobody requests costs nothing. An asset that never got variants at all,
 * which is what the old backfill was for, is simply an asset at generation 1.
 *
 * ## Why after the response, and not inside it
 *
 * Regenerating means fetching the original (up to 15 MB) and making up to ten
 * WebP encodes and a display copy: about two seconds for a large photo. A
 * visitor should not wait for that, and nothing about the old bytes is wrong —
 * only heavier — so the request is answered from what exists and the work
 * runs in `after()`.
 *
 * ## One regeneration per asset, not one per visitor
 *
 * A popular image is requested many times before its first regeneration
 * finishes. The first request takes a lease on the document in a transaction
 * (`variantRegeneration.startedAtMs`); every other request in the lease window
 * sees it on the snapshot it already read and schedules nothing, so the lease
 * costs one transaction per asset, not one per request. A failure records the
 * generation it failed at, so a source `sharp` cannot decode is tried once per
 * encoder generation rather than once per minute forever.
 */

/** How long a regeneration's lease keeps others from starting one. */
export const MEDIA_REGENERATION_LEASE_MS = 2 * 60 * 1000

/** The document field holding the lease and any failure. */
export const MEDIA_REGENERATION_FIELD = 'variantRegeneration'

export interface MediaRegenerationState {
  /** When the current (or last) regeneration took its lease. */
  startedAtMs?: number
  /** The encoder generation a regeneration last FAILED at. */
  failedVersion?: number
  /** Why, kept short — the same contract as `variantsError`. */
  error?: string
}

/** The fields of a media document this decision reads, among any others. */
export interface MediaRegenerationFacts {
  [field: string]: unknown
  contentType?: unknown
  cdnPath?: unknown
  sizeBytes?: unknown
  width?: unknown
  [MEDIA_VARIANT_ENCODER_VERSION_FIELD]?: unknown
  [MEDIA_REGENERATION_FIELD]?: unknown
}

/**
 * Whether this asset's delivery copies should be regenerated now.
 *
 * Pure, and decided from the snapshot the CDN already holds, so a request
 * that does not need to regenerate reads nothing more.
 *
 * - Only assets the generator would have worked on at upload: an image with a
 *   CDN path (the `mediaCdn` entitlement and a public asset, the same gate the
 *   upload routes apply), of a type that has variants or a display copy, no
 *   larger than the generator will fetch back.
 * - Only when the recorded generation is older than the current one.
 * - Not while another regeneration holds the lease, and not again at a
 *   generation that already failed.
 */
export function mediaDeliveryCopiesStale(
  facts: MediaRegenerationFacts,
  nowMs: number = Date.now(),
): boolean {
  const contentType = typeof facts.contentType === 'string' ? facts.contentType : ''
  if (!contentType.startsWith('image/')) return false
  if (MEDIA_TYPES_WITHOUT_VARIANTS.has(contentType)) return false
  if (typeof facts.cdnPath !== 'string' || !facts.cdnPath) return false
  if (
    mediaVariantEncoderVersionOf(facts[MEDIA_VARIANT_ENCODER_VERSION_FIELD]) >=
    MEDIA_VARIANT_ENCODER_VERSION
  ) {
    return false
  }
  const sizeBytes = Number(facts.sizeBytes ?? 0)
  if (!Number.isFinite(sizeBytes) || sizeBytes > MEDIA_VARIANT_SOURCE_MAX_BYTES) {
    return false
  }
  const sourceWidth =
    typeof facts.width === 'number' && facts.width > 0 ? facts.width : null
  const hasWork =
    mediaVariantWidthsFor({ contentType, sourceWidth }).length > 0 ||
    MEDIA_DISPLAY_TYPES.has(contentType)
  if (!hasWork) return false
  const state = (facts[MEDIA_REGENERATION_FIELD] ?? {}) as MediaRegenerationState
  if (state.failedVersion === MEDIA_VARIANT_ENCODER_VERSION) return false
  if (
    typeof state.startedAtMs === 'number' &&
    nowMs - state.startedAtMs < MEDIA_REGENERATION_LEASE_MS
  ) {
    return false
  }
  return true
}

/** The slice of a Storage bucket this needs. */
export interface MediaRegenerationBucket {
  file(path: string): {
    download(): Promise<[Buffer]>
    save(
      bytes: Buffer,
      options: { contentType: string; metadata: { cacheControl: string } },
    ): Promise<unknown>
    delete(): Promise<unknown>
  }
}

export type MediaRegenerationResult =
  | 'regenerated'
  | 'not-stale'
  | 'changed'
  | 'failed'

/**
 * Regenerate one asset's delivery copies with the current encoder.
 *
 * `basePath` is the original's object path as the CDN resolved it — already
 * proved to be inside the asset's own scope (AGL-1881) — and every object this
 * writes or deletes is derived from it.
 *
 * Ordering, and why:
 *
 * 1. **Lease**, in a transaction that re-reads the document: two requests that
 *    both saw it stale cannot both start.
 * 2. **Generate and save** the new copies. Their paths are the old ones, so a
 *    request in this window may receive new bytes under an old validator —
 *    harmless, both are the same picture.
 * 3. **Record**, in a transaction that refuses when the content hash moved: a
 *    replace during the work owns the document, and copies of the bytes it
 *    replaced must not be recorded over it.
 * 4. **Delete** what the new set no longer names — a width the new encoder
 *    skipped, a display copy the new rules do not need — only once the
 *    document stops naming them, so the CDN never points at a deleted object.
 */
export async function regenerateMediaDeliveryCopies(options: {
  docRef: FirebaseFirestore.DocumentReference
  bucket: MediaRegenerationBucket
  basePath: string
  nowMs?: number
}): Promise<MediaRegenerationResult> {
  const { docRef, bucket, basePath } = options
  const nowMs = options.nowMs ?? Date.now()
  const { firestore } = docRef

  const leased = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef)
    const data = snapshot.exists ? (snapshot.data() ?? {}) : null
    if (!data || data['deletedAt'] || !mediaDeliveryCopiesStale(data, nowMs)) {
      return null
    }
    const previous = (data[MEDIA_REGENERATION_FIELD] ?? {}) as MediaRegenerationState
    transaction.update(docRef, {
      [MEDIA_REGENERATION_FIELD]: { ...previous, startedAtMs: nowMs },
    })
    return data
  })
  if (!leased) return 'not-stale'

  const contentType = String(leased['contentType'])
  const contentHash = leased['contentHash']
  const previousVariants: number[] = Array.isArray(leased['variants'])
    ? (leased['variants'] as number[])
    : []
  const previousDisplay = Boolean(leased['display'])

  const saveVariant: SaveMediaDerivedObject = (path, bytes, type) =>
    bucket
      .file(path)
      .save(bytes, {
        contentType: type,
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
      })
      .then(() => undefined)

  let outcome: Awaited<ReturnType<typeof generateMediaVariants>>
  try {
    const [source] = await bucket.file(basePath).download()
    outcome = await generateMediaVariants({
      buffer: source,
      contentType,
      sourceWidth:
        typeof leased['width'] === 'number' ? (leased['width'] as number) : null,
      objectPath: basePath,
      saveVariant,
      display: true,
    })
  } catch (error) {
    outcome = {
      variants: [],
      error: `source download failed — ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
    }
  }

  if (outcome.error) {
    // The widths that DID land are real objects at the current generation and
    // the ones that did not are still the old encode, so the document names
    // both; the generation stays where it was, and the failure is recorded so
    // it is not retried until the encoder changes again.
    const written = new Set(outcome.variants)
    await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(docRef)
      if (!fresh.exists || fresh.data()?.['contentHash'] !== contentHash) return
      transaction.update(docRef, {
        variants: [...new Set([...previousVariants, ...written])].sort((a, b) => a - b),
        // A display copy that landed before the failure is a real object too.
        ...(outcome.display ? { display: outcome.display } : {}),
        variantsError: outcome.error,
        [MEDIA_REGENERATION_FIELD]: {
          startedAtMs: nowMs,
          failedVersion: MEDIA_VARIANT_ENCODER_VERSION,
          error: outcome.error,
        } satisfies MediaRegenerationState,
      })
    })
    return 'failed'
  }

  const recorded = await firestore.runTransaction(async (transaction) => {
    const fresh = await transaction.get(docRef)
    if (!fresh.exists || fresh.data()?.['contentHash'] !== contentHash) return false
    transaction.update(docRef, {
      ...mediaVariantDocFields(outcome),
      variantsError: FieldValue.delete(),
      [MEDIA_REGENERATION_FIELD]: FieldValue.delete(),
    })
    return true
  })
  if (!recorded) return 'changed'

  const kept = new Set(outcome.variants)
  await Promise.all([
    ...previousVariants
      .filter((width) => !kept.has(width))
      .map((width) =>
        bucket.file(`${basePath}__w${width}.webp`).delete().catch(() => undefined),
      ),
    ...(previousDisplay && !outcome.display
      ? [bucket.file(mediaDisplayObjectPath(basePath)).delete().catch(() => undefined)]
      : []),
  ])
  return 'regenerated'
}
