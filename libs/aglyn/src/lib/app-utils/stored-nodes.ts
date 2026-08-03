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

import { decompress } from './decompress'

/**
 * A version document's `nodes` field, decoded to the map every reader wants
 * (AGL-1223).
 *
 * **`nodes` is stored in TWO live forms and both must be handled.** A plain
 * Firestore map, and msgpack bytes: `screenVersionConverter` compresses on
 * write (AGL-1151) and decodes only binary payloads on read, because "nodes
 * saved while updateDoc bypassed the client converter are plain maps rather
 * than compressed bytes". Server code that reads `snapshot.get('nodes')` raw
 * therefore gets a Node `Buffer` for the compressed majority.
 *
 * That is a SILENT failure, not a loud one, which is why this exists as a
 * shared helper rather than a note. Every scan predicate in this library
 * walks the map with `Object.values(nodes)`; over a Buffer that yields the
 * individual byte NUMBERS, none of which has a `props` or a `componentId`, so
 * the loop completes and reports no matches. The endpoint answers "used
 * nowhere" — for `/api/hosts/where-used` an invitation to delete something a
 * live page renders, and for the media scan the sentence the AGL-1045 scope
 * confirmation quotes before telling an author it is safe to restrict an
 * asset.
 *
 * Returns `null` for absent AND for undecodable, logging the latter: a caller
 * skipping a document is the same shape either way, and a decode failure that
 * threw would fail the whole scan rather than one document.
 *
 * Not every `nodes` field is compressed — component DOCUMENTS store theirs
 * plainly so the tenant runtime can read them without decoding, and email
 * template versions are written by a bare `setDoc` with no converter. Passing
 * those through here is still correct: a plain map returns unchanged.
 */
export function decodeStoredNodes<T = Record<string, any>>(
  raw: unknown,
): T | null {
  if (raw === null || raw === undefined) return null
  if (ArrayBuffer.isView(raw)) {
    try {
      return decompress<T>(raw)
    } catch (error) {
      // Undecodable nodes must never read as "no references".
      console.error('could not decode stored nodes', error)
      return null
    }
  }
  return raw as T
}

export default decodeStoredNodes
