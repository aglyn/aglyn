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

import { compress } from './compress'
import { decompress, type ByteSource } from './decompress'

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
 * Every write path encodes, but the corpus does not: documents written before
 * a given path learned to are still plain maps and nothing migrates them.
 * Passing one through here is correct and is the point — a plain map returns
 * unchanged, so a reader never has to know which it has.
 *
 * The bytes arrive as a Node `Buffer` on the server and as a Firestore
 * `Bytes` on the CLIENT (AGL-1397), and only the first is an `ArrayBuffer`
 * view. `Bytes` is a wrapper — `decompress` has always accepted it via
 * `ByteSource`, but this helper used to route only views into `decompress`, so
 * a `Bytes` fell through to the plain-map branch and came back UNCHANGED.
 * That is the worst possible outcome for a client caller, because the wrapper
 * is walkable: its `_byteString.binaryString` is the msgpack payload held as a
 * latin-1 string, so `rewriteBindingTokensDeep` reads the page's text right
 * out of the encoded bytes, "normalizes" a token inside them, and hands back
 * `{_byteString: {binaryString: …}}` for something to write.
 *
 * A THIRD form arrives from outside Firestore: `{type: 'Buffer', data: […]}`,
 * which is what `JSON.stringify` makes of a Node `Buffer` (AGL-1391). Site
 * export bundles downloaded before that fix carry it, and it is the nastiest
 * of the three — an `ArrayBuffer` view survives this helper, but a envelope is
 * a plain object, so without this branch it returns UNCHANGED and every reader
 * downstream walks an object whose only keys are `type` and `data`.
 */
export function decodeStoredNodes<T = Record<string, any>>(
  raw: unknown,
): T | null {
  if (raw === null || raw === undefined) return null
  const bytes = ArrayBuffer.isView(raw)
    ? raw
    : byteSource(raw) ?? bufferEnvelopeBytes(raw)
  if (bytes) {
    try {
      return decompress<T>(bytes)
    } catch (error) {
      // Undecodable nodes must never read as "no references".
      console.error('could not decode stored nodes', error)
      return null
    }
  }
  return raw as T
}

/**
 * Which live storage form a `nodes` field is in.
 *
 * `absent` covers both "no field" and a scalar, because the only two things a
 * caller does with either are skip the document or write a fresh tree.
 */
export type StoredNodesForm = 'bytes' | 'map' | 'absent'

/**
 * Read the form off a stored field, so a partial update can write back the
 * way the document came out.
 *
 * Rewriting a compressed document as a plain map inflates it by roughly 1.4x,
 * which is the whole hazard this module exists to keep away from Firestore's
 * per-document ceiling. A writer that merges one field into a document it did
 * not fully read has no business changing the encoding of another.
 *
 * Recognises every form {@link decodeStoredNodes} does, and answers from the
 * same predicates, so "what form is this" and "how do I read it" can never
 * drift apart.
 */
export function storedNodesForm(raw: unknown): StoredNodesForm {
  if (raw === null || raw === undefined) return 'absent'
  if (ArrayBuffer.isView(raw)) return 'bytes'
  if (typeof raw !== 'object') return 'absent'
  if (byteSource(raw) || bufferEnvelopeBytes(raw)) return 'bytes'
  return 'map'
}

/**
 * A node map in the form it should be STORED in — msgpack bytes.
 *
 * The write-side twin of {@link decodeStoredNodes}, and deliberately in the
 * same file: a reader who finds one finds the other, which is what stops the
 * next write path from being added without an encoding.
 *
 * Returns a bare `Uint8Array` and knows NOTHING about Firestore, for the
 * reason `compress` documents — one value import of the client SDK's `Bytes`
 * pulls the whole Firestore client into the tenant bundle. The caller wraps:
 * `Bytes.fromUint8Array(...)` on the client SDK, `Buffer.from(...)` on the
 * Admin SDK, which is what each accepts for a bytes field.
 *
 * ALREADY-encoded input passes through rather than being encoded again. A
 * write path that copies a stored document — a version snapshot, an install
 * from a published artifact — receives whichever form that document held, and
 * msgpack of msgpack is a tree no reader can decode.
 *
 * Returns `null` for an absent field, so a caller can omit the key entirely
 * rather than writing an empty map over a real tree (AGL-1250).
 */
export function encodeStoredNodes(nodes: unknown): Uint8Array | null {
  if (nodes === null || nodes === undefined) return null
  if (ArrayBuffer.isView(nodes)) {
    // Offset and length, for the reason `decompress` documents: firebase-admin
    // hands back POOLED Buffers, so the whole backing ArrayBuffer is usually
    // somebody else's data.
    return new Uint8Array(nodes.buffer, nodes.byteOffset, nodes.byteLength)
  }
  if (typeof nodes !== 'object') return null
  const source = byteSource(nodes)
  if (source) return source.toUint8Array()
  const envelope = bufferEnvelopeBytes(nodes)
  if (envelope) return envelope
  return compress(nodes)
}

/**
 * The tree in the form the document already used.
 *
 * For the partial-update case: a writer that changes one field of a document
 * it did not create must not also change how `nodes` is encoded. Pass the
 * form read off the stored field and this hands back something to write.
 *
 * `absent` encodes, because a document with no stored form yet is a new one
 * and new documents are compressed.
 */
export function matchStoredNodesForm<T>(
  nodes: T,
  form: StoredNodesForm,
): Uint8Array | T | null {
  return form === 'map' ? nodes : encodeStoredNodes(nodes)
}

/**
 * The client SDK's `Bytes`, structurally, or `null` for anything else.
 *
 * Matched on the method rather than the class so `firebase/firestore` stays
 * out of this library — the same reason `decompress` types its input as
 * `ByteSource`. A node map cannot collide: its values are node OBJECTS, never
 * functions.
 */
function byteSource(raw: unknown): ByteSource | null {
  if (typeof raw !== 'object') return null
  return typeof (raw as ByteSource).toUint8Array === 'function'
    ? (raw as ByteSource)
    : null
}

/**
 * A JSON-serialized Node `Buffer`, or `null` for anything else.
 *
 * The test is deliberately exact — `type === 'Buffer'`, an array `data`, and
 * NOTHING else — because the alternative reading of this object is a node map
 * with nodes called `type` and `data`. That map cannot exist: a node map's
 * values are node objects, so `type` would have to hold the literal string
 * `'Buffer'` and `data` an array, at the same time, in the same document.
 */
function bufferEnvelopeBytes(raw: unknown): Uint8Array | null {
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as { type?: unknown; data?: unknown }
  if (value.type !== 'Buffer' || !Array.isArray(value.data)) return null
  if (Object.keys(value).length !== 2) return null
  return Uint8Array.from(value.data as number[])
}

export default decodeStoredNodes
