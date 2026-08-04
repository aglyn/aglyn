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

import { decodeStoredNodes } from '@aglyn/aglyn/server'
import { type UsageCandidate } from './scan-artifact-usage'

/**
 * Loading the documents a usage scan searches (AGL-1161).
 *
 * Lifted out of `/api/hosts/where-used` so the cache-drop path on publish uses
 * the SAME reader rather than a second copy. The copy is the dangerous part:
 * screen and layout node trees have two storage forms, and a reader that
 * handles only one reports "used nowhere" while blind to half the corpus —
 * which is precisely the bug AGL-1223 had to fix in the one existing reader.
 * A private second implementation would have reintroduced it silently, and on
 * a correctness path rather than an advisory one.
 */

export interface UsageCandidateRead {
  candidates: UsageCandidate[]
  /**
   * The collection held more documents than `limit` allowed, so the scan below
   * it is INCOMPLETE.
   *
   * Returned rather than logged, because the two callers owe the user
   * different things: an advisory "what would I break" can show a partial
   * answer and say so, while a cache drop that silently scans a prefix reports
   * a successful publish and leaves real pages stale.
   */
  truncated: boolean
}

/**
 * One collection's documents, with published nodes attached when the scan
 * needs to search them.
 *
 * `limit` is a real bound, not a guess: it is fetched with one extra document
 * so exceeding it is DETECTED rather than assumed away. A caller that ignores
 * `truncated` is choosing to be wrong quietly.
 */
export async function readUsageCandidates(
  hostRef: FirebaseFirestore.DocumentReference,
  collectionName: 'screens' | 'layouts' | 'components',
  options: { withNodes: boolean; limit: number },
): Promise<UsageCandidateRead> {
  const { withNodes, limit } = options
  // One over the limit: if the extra document comes back, there was more than
  // we are about to look at. Cheaper than a count() and exact.
  const docs = await hostRef.collection(collectionName).limit(limit + 1).get()
  const truncated = docs.size > limit
  const inScope = truncated ? docs.docs.slice(0, limit) : docs.docs

  const candidates = await Promise.all(
    inScope.map(async (docSnapshot) => {
      const versionId = docSnapshot.get('versionId')
      // Components keep their tree on the document; screens and layouts keep
      // it on the published version.
      //
      // Only the VERSION read is decoded (AGL-1223). A component document's
      // `nodes` is stored plainly on purpose, so the tenant runtime can read
      // it without decoding — `decodeStoredNodes` would pass it through
      // unchanged, but saying so here is cheaper than the next reader
      // re-deriving it.
      const nodes =
        collectionName === 'components'
          ? docSnapshot.get('nodes')
          : withNodes && versionId
            ? await docSnapshot.ref
                .collection('versions')
                .doc(String(versionId))
                .get()
                .then((version) => decodeStoredNodes(version.get('nodes')))
                .catch(() => null)
            : null
      return {
        id: docSnapshot.id,
        displayName: docSnapshot.get('displayName'),
        name: docSnapshot.get('name'),
        deletedAt: docSnapshot.get('deletedAt'),
        nodes,
        ...(versionId ? { versionId: String(versionId) } : {}),
        ...(docSnapshot.get('layoutId')
          ? { layoutId: String(docSnapshot.get('layoutId')) }
          : {}),
      } satisfies UsageCandidate
    }),
  )

  return { candidates, truncated }
}

export default readUsageCandidates
