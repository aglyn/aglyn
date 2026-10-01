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

// A TYPE-only namespace: every `Aglyn.` reference below is a type, and held
// as a VALUE the namespace pins every module the barrel reaches into the
// console shell that renders these hooks. `import type` erases instead.
import type * as Aglyn from '@aglyn/aglyn'
import { compress, decompress } from '@aglyn/aglyn'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import type { DocumentReference } from 'firebase/firestore'
import { Bytes, doc } from 'firebase/firestore'
import {
  useFirestore,
  type FirestoreDocOptions,
} from './firebase/firebase-services'
import useDoc from './helpers/use-doc'

/**
 * A plugin document's working version, at
 * `hosts/{hostId}/{collection}/{docId}/versions/{versionId}` — the storage a
 * kind declared in `besignerDocuments` keeps (`plugin-manager/
 * besigner-documents.ts`).
 *
 * Compressed at rest, and carrying the same asymmetry a component version
 * does: the PUBLISHED tree lives on the parent document, because a placed
 * document has to resolve on the hot path of a page render and one
 * collection query reaches every one on the site. These documents are
 * editing history — the besigner's draft surface — and nothing renders from
 * them.
 */
export interface HostDocumentVersion {
  displayName?: string
  /** The node a placed copy grafts from; absent on a tree never published. */
  rootId?: Aglyn.NodeId
  nodes?: Record<Aglyn.NodeId, Aglyn.AglynNodeSchema>
  updatedAt?: unknown
}

export interface HostDocumentVersionIds {
  hostId: string
  /** The subcollection under `hosts/{hostId}` the document lives in. */
  collection: string
  docId: string
  versionId: string
}

export const useHostDocumentVersionRef = ({
  hostId,
  collection,
  docId,
  versionId,
}: HostDocumentVersionIds) => {
  const firestore = useFirestore()
  const ref = doc(
    firestore,
    'hosts',
    hostId,
    collection,
    docId,
    'versions',
    versionId,
  )
  return ref.withConverter({
    toFirestore(data) {
      const { $id, ...rest } = data
      // Only emit `nodes` when the write carries them — see the note in
      // use-screen-version (AGL-1250). A partial write that compressed
      // `undefined` would replace the stored tree with an empty one.
      if (rest?.nodes === undefined)
        return { ...rest, updatedAt: Timestamp.now() }
      const nodes =
        rest.nodes instanceof Bytes
          ? rest.nodes
          : Bytes.fromUint8Array(compress(rest.nodes))
      return { ...rest, nodes, updatedAt: Timestamp.now() }
    },
    fromFirestore(snapshot, options) {
      if (!snapshot.exists()) return undefined
      const data = snapshot.data(options)
      if (data?.nodes instanceof Bytes) {
        return {
          ...data,
          nodes: decompress(data.nodes),
        } as HostDocumentVersion
      }
      return data as HostDocumentVersion
    },
  }) as DocumentReference<HostDocumentVersion>
}

export const useHostDocumentVersion = (
  ids: HostDocumentVersionIds,
  options?: FirestoreDocOptions<HostDocumentVersion>,
) => {
  return useDoc(useHostDocumentVersionRef(ids), options)
}

export default useHostDocumentVersion
