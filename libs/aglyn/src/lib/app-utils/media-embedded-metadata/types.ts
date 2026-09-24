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

import type {
  MediaEmbeddedPatch,
  MediaEmbeddedSource,
} from '../media-embedded-fields'

/**
 * One value read from one metadata block, before the blocks are reconciled
 * (AGL-3331). A photo's caption arrives as up to three candidates — XMP,
 * IPTC, EXIF — and `index.ts` folds them into one field.
 */
export interface EmbeddedCandidate {
  /**
   * A canonical catalog key (`title`, `creator`, …) or a namespaced other
   * key from `otherEmbeddedKey` — see `media-embedded-fields.ts` for both
   * and for the value format each canonical key uses.
   */
  key: string
  value: string | string[]
  source: MediaEmbeddedSource
  /** Display label for an other key (`photoshop:TransmissionReference`). */
  label?: string
  /**
   * False when THIS value cannot be written back although its key can on
   * this format — a structured XMP property, a PDF entry that is not a text
   * string. The field is shown and not offered for editing.
   */
  editable?: boolean
}

/** An edit, keyed as the reader keyed it. Re-exported for the modules. */
export type EmbeddedPatch = MediaEmbeddedPatch

/**
 * Random access to a stored object, so a reader of a 200 MB film can fetch
 * its `moov` box without downloading the film. `end` is EXCLUSIVE and is
 * clamped by the implementation to `size`.
 */
export interface EmbeddedByteReader {
  size: number
  read(start: number, end: number): Promise<Uint8Array>
}

/** Wraps bytes already in memory as a reader. */
export function bytesReader(bytes: Uint8Array): EmbeddedByteReader {
  return {
    size: bytes.length,
    read: async (start, end) =>
      bytes.subarray(Math.max(0, start), Math.min(bytes.length, end)),
  }
}

/**
 * A write the format cannot take, with a sentence for the person who asked.
 * Thrown by writers; the route answers it as a 422 rather than a 500.
 */
export class EmbeddedWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbeddedWriteError'
  }
}
