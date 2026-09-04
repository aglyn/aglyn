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

import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn'
import { Bytes, type DocumentReference } from 'firebase/firestore'

/**
 * Compression at rest for a besigner document that has no converter of its
 * own — the two EMAIL editors (AGL-1151).
 *
 * ## Why a converter rather than decoding at the read site
 *
 * Both email besigners read their version with a bare `useFirestoreDoc` and
 * write it with `saveNodesGuarded` on a bare `doc(...)`, and `nodes` has to
 * be in ONE shape across four comparisons for either to work:
 *
 *  - `useBesignerDocument` diffs the arriving snapshot against its baseline to
 *    decide whether somebody else has written, and against the tree it just
 *    sent to recognise the echo of its own save;
 *  - `saveNodesGuarded` re-reads inside its transaction and compares the
 *    stored `nodes` against the baseline the editor presents.
 *
 * Decoding at the read site alone would leave the stored form on one side of
 * those comparisons and a decoded map on the other, so every save would look
 * like a conflict and be refused. A converter puts the decode BEFORE all four,
 * which is why the screen, layout, component and form editors — which have
 * carried converters since AGL-1151 — never had the problem.
 *
 * ## What it does not do
 *
 * It does not stamp `updatedAt`. The version converters do, because their
 * callers do not; both email editors pass their own stamp, and the seeding
 * writes pass the one they also put on the template document, so a stamp
 * applied here would silently replace a value the caller is coordinating.
 */
export const besignerNodesConverter = {
  toFirestore(data: Record<string, any>) {
    const { $id, ...rest } = data
    // Only emit `nodes` when the write actually carries them (AGL-1250).
    // Encoding `rest.nodes` unconditionally would make a partial
    // `setDoc(…, {merge: true})` — one that set some other field — ship an
    // empty map, and merge faithfully merges that emptiness over the real
    // tree, destroying the document.
    if (rest?.nodes === undefined) return rest
    const nodes = encodeStoredNodes(rest.nodes)
    // `encodeStoredNodes` passes an already-encoded value through, so a write
    // that round-trips what it read cannot double-encode. `Bytes` is what the
    // client SDK accepts for a bytes field.
    return { ...rest, ...(nodes ? { nodes: Bytes.fromUint8Array(nodes) } : {}) }
  },
  fromFirestore(snapshot: any, options: any) {
    if (!snapshot.exists()) return undefined
    const data = snapshot.data(options)
    if (data?.nodes === undefined) return data
    // BOTH forms, permanently. Every email version written before this
    // converter is a plain map and nothing migrates them; `decodeStoredNodes`
    // returns a plain map unchanged, so one call serves both.
    return { ...data, nodes: decodeStoredNodes(data.nodes) }
  },
}

/**
 * The same document, read and written through {@link besignerNodesConverter}.
 *
 * A named wrapper rather than `.withConverter(...)` at each call site: an
 * editor has to apply it to BOTH the ref it reads and the ref it saves
 * through, and the failure when only one of them gets it is a save refused as
 * a phantom conflict rather than anything that looks like a missing converter.
 */
export function withBesignerNodes<T>(
  ref: DocumentReference<any>,
): DocumentReference<T> {
  return ref.withConverter(
    besignerNodesConverter as never,
  ) as DocumentReference<T>
}

export default besignerNodesConverter
