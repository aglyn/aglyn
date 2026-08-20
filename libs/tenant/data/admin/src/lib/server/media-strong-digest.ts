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
 * A BOUNDED strong content digest for objects the server never held
 * (AGL-1629) — the decision AGL-1614 deferred, taken now that AGL-1475
 * changed what it costs.
 *
 * ## What changed since the question was asked
 *
 * AGL-1614 wrote `contentSha256` only where the bytes were already in hand,
 * and argued — correctly, at the time — that the signed-upload route could
 * not have one: the browser PUTs straight to GCS, GCS computes md5 and
 * crc32c but never sha256, and `file.download()` on a 200 MB video is the
 * exact cost the route exists to avoid. The conclusion was "needs a
 * product call on cost".
 *
 * AGL-1475 (`c607678ee`) then made finalize read bytes anyway — a 4 KB head
 * and, for document archives, a 64 KB tail — to inspect structure. The
 * route is no longer byte-blind, and the honest question is no longer
 * "download or not" but "how much".
 *
 * ## The measurement the decision rests on
 *
 * Production media bucket, `gs://aglyn-main.appspot.com`, read-only listing
 * on 2026-08-20: **182 source objects, 44,774,216 bytes (42.70 MiB)** —
 * plus 269 derived `__wNNN.webp` variants, which carry no media document
 * and need no digest. Largest single object **7,742,225 B (7.38 MiB)**;
 * mean 246 KB; 177 of 182 under 1 MB; **nothing above 10 MiB and no video
 * at all**. Hashing the entire back catalogue is ~$0.005 of egress.
 *
 * So the "200 MB video" that made this expensive is a CEILING, not a
 * population. It still has to be handled — a ceiling is what an attacker
 * aims at — but it must not be allowed to price the other 99%.
 *
 * ## The decision
 *
 * Digest every signed upload up to {@link MEDIA_STRONG_DIGEST_MAX_BYTES},
 * by STREAMING; above it, write nothing and degrade exactly as before.
 *
 * **Why 50 MiB and not a rounder number.** It is precisely the largest
 * NON-VIDEO ceiling on the signed route: ZIP is 50 MB and `.pptx` is 50 MB,
 * PDF and the Office types are 25 MB, images are 15 MB. At 50 MiB every
 * type except video is covered *at its own maximum* — there is no size at
 * which a PDF or a brand-kit zip silently loses its strong digest. Only
 * video (200 MB) can exceed it, and only past 50 MB.
 *
 * **What the bound costs, precisely.** One additional full read of the
 * object, capped at 50 MiB. GCS internet egress is ~$0.12/GiB, so the
 * worst case is **$0.0057 per upload** and the measured mean case is
 * **$0.00003**. sha256 in Node runs at roughly 500 MB/s, so the CPU is
 * ~0.1 s at the ceiling. The route already declares `maxDuration = 60` and
 * already budgets a 15 MB download plus three `sharp` encodes inside it.
 *
 * **What the bound buys.**
 *
 *  1. **Cross-route matching, which was previously impossible.** The
 *     in-process routes key on sha256 of the bytes; this route keyed on a
 *     16-hex truncation of GCS's md5. The same file through the two paths
 *     produced two unrelated keys, so "re-uploading the same bytes stays
 *     quarantined" held within an ingestion path and not across them. Under
 *     the ceiling it now holds across them. That is the headline.
 *  2. **The md5 collision target goes away** for everything under the
 *     ceiling. A chosen-prefix md5 collision is hours of ordinary compute
 *     and yields two files sharing the 64-bit truncation — a cross-tenant
 *     availability attack an outsider could mount. The preferred key stops
 *     being md5-derived.
 *  3. **Ingestion refusal actually works** on the signed route for known
 *     bytes, rather than only at delivery via the per-asset fallback.
 *
 * **What it does not buy, stated rather than implied.** Video above 50 MB
 * carries no `contentSha256` and never will on this path. That is the
 * bounded alternative, not a pretence of completeness: such an object
 * matches on the legacy truncated hash and on its per-asset key, exactly as
 * every signed upload did before this module existed. Video is also the
 * type least plausibly a chosen-prefix collision target or a
 * shared-bytes malware carrier, which is why it is the class the bound
 * sacrifices.
 *
 * ## Why streaming rather than `download()`
 *
 * `file.download()` resolves a single Buffer. At the ceiling that is 50 MiB
 * of function heap on a path that is concurrently holding a `sharp`
 * pipeline. Streaming through the hash keeps the resident set at one chunk
 * regardless of object size, which is what makes a 50 MiB bound safe to
 * state at all. The spec asserts the peak rather than only the hex, because
 * a hex-only assertion passes just as happily against a buffering
 * implementation.
 */

import { createHash } from 'node:crypto'

/**
 * The largest object this path will digest.
 *
 * Deliberately equal to the largest non-video `signedMaxBytes` in
 * `apps/console/utils/media-upload-limits.ts` (ZIP, `.pptx`). Raising it
 * only ever adds video; lowering it silently strips the strong key off a
 * document type that has one today, which is why the spec asserts the
 * number instead of trusting it.
 */
export const MEDIA_STRONG_DIGEST_MAX_BYTES = 50 * 1024 * 1024

/** Why no digest was taken. Absent when one was. */
export type StrongDigestSkip = 'over-ceiling' | 'unreadable'

export interface StoredObjectDigest {
  /** Lower-case hex sha256 of the whole object, or absent. */
  sha256?: string
  /** Set when — and only when — `sha256` is absent. */
  skipped?: StrongDigestSkip
  /** Bytes actually pulled out of the bucket. Zero when the bound bit. */
  bytesRead: number
  /**
   * The largest single buffer held while hashing.
   *
   * Exported because it is the only externally checkable evidence that this
   * function streams rather than buffers — a caller, a log line or a spec
   * can distinguish the two without reading the implementation. It is also
   * the number that would move first if someone "simplified" this back to
   * `file.download()`.
   */
  peakChunkBytes: number
}

/**
 * May an object of this size be digested?
 *
 * A pure predicate so the route, the spec and
 * `tools/scripts/backfill-media-content-sha256.mjs` (AGL-1630) all apply
 * ONE rule rather than three copies that drift.
 *
 * An unknown, zero or non-finite size answers `false`, never `true`. GCS
 * reports no size for a composite object, and guessing "small" there means
 * starting an unbounded read on the exact shape that cannot be bounded.
 */
export function strongDigestWithinCeiling(
  sizeBytes: number,
  maxBytes: number = MEDIA_STRONG_DIGEST_MAX_BYTES,
): boolean {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes)) return false
  if (sizeBytes <= 0) return false
  return sizeBytes <= maxBytes
}

/** The minimal Storage surface this needs; injectable for tests. */
export interface DigestibleStorageFile {
  createReadStream: (options?: unknown) => NodeJS.ReadableStream
}

/**
 * Stream one stored object through sha256.
 *
 * FAILS SOFT, in both directions, and that is the whole safety argument:
 *
 * * An unreadable object returns `unreadable`, not a throw. The callers are
 *   an upload finalize and a backfill; a Storage blip must not start
 *   refusing uploads, matching the fail-open posture of the ranged
 *   inspection above it and the deny-list read below it.
 * * A stream that ends SHORT — a truncated range, a proxy cutting the body,
 *   a mid-flight reset — returns `unreadable` rather than the digest of
 *   what did arrive. A partial digest is worse than none: it is a
 *   well-formed 64-hex value that matches nothing, and because
 *   `mediaQuarantineKeys` PREFERS the strong digest, writing one would
 *   shadow the legacy hash that would otherwise have matched. That is a
 *   takedown quietly lifting itself, which is the one failure this whole
 *   subsystem may not have.
 */
export async function storedObjectSha256(options: {
  file: DigestibleStorageFile
  /** The object's real size, as Storage reports it. */
  sizeBytes: number
  maxBytes?: number
}): Promise<StoredObjectDigest> {
  const { file, sizeBytes } = options
  const maxBytes = options.maxBytes ?? MEDIA_STRONG_DIGEST_MAX_BYTES

  // Before any egress, not after — a bound that reads and discards costs
  // exactly what it exists to save.
  if (!strongDigestWithinCeiling(sizeBytes, maxBytes)) {
    return { skipped: 'over-ceiling', bytesRead: 0, peakChunkBytes: 0 }
  }

  const hash = createHash('sha256')
  let bytesRead = 0
  let peakChunkBytes = 0
  try {
    const stream = file.createReadStream()
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      if (buffer.length > peakChunkBytes) peakChunkBytes = buffer.length
      bytesRead += buffer.length
      hash.update(new Uint8Array(buffer))
    }
  } catch (error) {
    console.error('[media] strong digest read failed', error)
    return { skipped: 'unreadable', bytesRead, peakChunkBytes }
  }

  if (bytesRead !== sizeBytes) {
    // See the fail-soft note above: a short read is not a small file.
    console.error(
      '[media] strong digest read short',
      `expected ${sizeBytes} bytes, read ${bytesRead}`,
    )
    return { skipped: 'unreadable', bytesRead, peakChunkBytes }
  }

  return { sha256: hash.digest('hex'), bytesRead, peakChunkBytes }
}
