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

import {
  readMediaEmbeddedMetadata,
  type EmbeddedByteReader,
} from '@aglyn/aglyn/server'
import {
  MEDIA_EMBEDDED_METADATA_VERSION,
  type MediaEmbeddedMetadata,
} from '@aglyn/aglyn/app-utils/media-embedded-fields'

/** The slice of a GCS `File` the reader needs — and all a spec must fake. */
export interface RangedObject {
  download(options: { start: number; end: number }): Promise<[Buffer]>
}

/**
 * A stored object as random-access bytes (AGL-3331), so reading a film's
 * `moov` box costs a few ranged GETs rather than the film. GCS takes an
 * INCLUSIVE end; the reader contract is exclusive, and the off-by-one lives
 * here once.
 */
export function storageObjectReader(
  file: RangedObject,
  size: number,
): EmbeddedByteReader {
  return {
    size,
    read: async (start, end) => {
      const from = Math.max(0, start)
      const to = Math.min(size, end)
      if (to <= from) return new Uint8Array(0)
      const [chunk] = await file.download({ start: from, end: to - 1 })
      return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    },
  }
}

/**
 * How long an ingress route will wait on the reader before giving up. The
 * read is a convenience at upload, not a gate: an asset it skips is read the
 * first time its Details drawer opens.
 */
export const EMBEDDED_INGRESS_BUDGET_MS = 8_000

/**
 * The embedded metadata to stamp on a new asset, or `null` — never a throw
 * and never a stall. An upload must not fail, or wait, because its caption
 * could not be parsed.
 */
export async function embeddedMetadataAtIngress(options: {
  contentType: string
  reader: EmbeddedByteReader
  contentSha256?: string
  budgetMs?: number
}): Promise<MediaEmbeddedMetadata | null> {
  const { budgetMs = EMBEDDED_INGRESS_BUDGET_MS, ...input } = options
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs)
  })
  try {
    return await Promise.race([
      readMediaEmbeddedMetadata(input).catch((error) => {
        console.warn('embedded metadata read failed at ingress', error)
        return null
      }),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Whether a stored record still describes the asset's bytes. Stale when the
 * reader has changed shape since, or when the bytes were replaced by a path
 * that did not re-read them — both are answered by reading the file again.
 */
export function embeddedMetadataIsCurrent(
  stored: unknown,
  contentSha256: unknown,
): stored is MediaEmbeddedMetadata {
  if (!stored || typeof stored !== 'object') return false
  const record = stored as Partial<MediaEmbeddedMetadata>
  if (record.version !== MEDIA_EMBEDDED_METADATA_VERSION) return false
  if (!Array.isArray(record.fields)) return false
  return typeof contentSha256 !== 'string' || record.contentSha256 === contentSha256
}
