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

import { decode } from '@msgpack/msgpack'

/**
 * A COPY of `decodeStoredNodes` from `@aglyn/aglyn` (AGL-1223), for the same
 * reason `email-media-src.ts` carries a copy of `resolveMediaSrc`:
 * `shared-util-email` is tagged `scope:shared`, the module-boundary rule makes
 * shared libs leaves, and the arrow points the other way so every send site
 * can pull the email renderer without the framework.
 *
 * `email-nodes-drift.spec.ts` in the console — which may import both — runs
 * the two implementations over one table of inputs, so a divergence fails a
 * build rather than silently changing what a recipient receives.
 *
 * ## Why an email loader needs this at all
 *
 * An email version's `nodes` is stored in the same two live forms every other
 * besigner document uses: a plain Firestore map, and msgpack bytes. Reading
 * the field raw is not a loud failure — a `Buffer` walks, `Object.keys` over
 * one returns BYTE INDICES rather than nothing, so an emptiness guard passes
 * and the send renders an empty email instead of falling back to its built-in
 * copy.
 */
export function decodeEmailNodes<T = Record<string, unknown>>(
  raw: unknown,
): T | null {
  if (raw === null || raw === undefined) return null
  const bytes = ArrayBuffer.isView(raw)
    ? // Offset and length, ALWAYS. firebase-admin hands back POOLED Buffers,
      // so a small field is typically a view into a shared 8 KB allocation
      // and decoding the whole pool throws on the trailing bytes.
      new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    : byteSourceBytes(raw) ?? bufferEnvelopeBytes(raw)
  if (bytes) {
    try {
      return decode(bytes) as T
    } catch (error) {
      // Undecodable nodes must never read as "this template is empty" — that
      // is indistinguishable from a template nobody has designed yet.
      console.error('could not decode stored email nodes', error)
      return null
    }
  }
  return raw as T
}

/**
 * The client SDK's `Bytes`, structurally. Matched on the method rather than
 * the class so no Firestore package is imported here. A node map cannot
 * collide: its values are node OBJECTS, never functions.
 */
function byteSourceBytes(raw: unknown): Uint8Array | null {
  if (typeof raw !== 'object') return null
  const source = raw as { toUint8Array?: unknown }
  return typeof source.toUint8Array === 'function'
    ? (source.toUint8Array as () => Uint8Array)()
    : null
}

/**
 * A JSON-serialized Node `Buffer` — what `JSON.stringify` makes of one
 * (AGL-1391). The test is deliberately exact, because the alternative reading
 * is a node map with nodes called `type` and `data`; that map cannot exist,
 * since `type` would have to hold the literal string `'Buffer'` and `data` an
 * array, in the same document.
 */
function bufferEnvelopeBytes(raw: unknown): Uint8Array | null {
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as { type?: unknown; data?: unknown }
  if (value.type !== 'Buffer' || !Array.isArray(value.data)) return null
  if (Object.keys(value).length !== 2) return null
  return Uint8Array.from(value.data as number[])
}

export default decodeEmailNodes
