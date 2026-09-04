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

import * as Aglyn from '@aglyn/aglyn'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { DocumentReference } from '@firebase/firestore'
import { Bytes, doc } from 'firebase/firestore'
import {
  useFirestore,
  type FirestoreDocOptions,
} from './firebase/firebase-services'
import useDoc from './helpers/use-doc'

/**
 * A saved template (AGL-681), at `hosts/{hostId}/templates/{templateId}`.
 *
 * Unlike screens and layouts there is no version subcollection: a template
 * is inert — nothing renders from it until it is used to create something
 * — so there is no published-versus-draft distinction to keep.
 *
 * Compressed at rest like every other besigner document (AGL-1151). A
 * template is the one kind whose whole content arrives by COPY — "save as
 * template" duplicates a screen's entire tree into a single document with no
 * version to spread it across — so it reaches the 1 MiB ceiling at exactly
 * the size the source page does, and about 1.4x sooner stored as a map.
 */
export const useHostTemplateRef = ({
  hostId,
  templateId,
}: {
  hostId: Aglyn.HostUid
  templateId: string
}) => {
  const firestore = useFirestore()
  const ref = doc(firestore, 'hosts', hostId, 'templates', templateId)
  return ref.withConverter({
    toFirestore(data: Aglyn.AglynTemplate) {
      // `source` is server-managed and frozen in rules (AGL-666) — stripping
      // it here means an ordinary save can never trip that guard.
      const { $id, source, ...rest } = data as Record<string, unknown> & {
        $id?: string
        source?: unknown
      }
      // Only emit `nodes` when the write actually carries them (AGL-1250).
      // The besigner's save writes `placeholders` and `editedAt` alongside
      // the tree through a merging `setDoc`, and the template detail page
      // writes a name on its own — encoding unconditionally would ship an
      // empty map on the second of those and merge it over the design.
      if (rest?.nodes === undefined) return { ...rest, updatedAt: Timestamp.now() }
      const nodes = encodeStoredNodes(rest.nodes)
      return {
        ...rest,
        ...(nodes ? { nodes: Bytes.fromUint8Array(nodes) } : {}),
        updatedAt: Timestamp.now(),
      }
    },
    fromFirestore(snapshot, options) {
      if (!snapshot.exists()) return undefined
      const data = snapshot.data(options)
      if (data?.['nodes'] === undefined) return data as Aglyn.AglynTemplate
      // BOTH stored forms, permanently. Every template written before this
      // converter compressed is a plain map and nothing migrates them;
      // `decodeStoredNodes` returns one unchanged.
      return {
        ...data,
        nodes: decodeStoredNodes(data['nodes']),
      } as Aglyn.AglynTemplate
    },
  }) as DocumentReference<Aglyn.AglynTemplate>
}

export const useHostTemplate = (
  data: { hostId: Aglyn.HostUid; templateId: string },
  options?: FirestoreDocOptions<Aglyn.AglynTemplate>,
) => {
  return useDoc(useHostTemplateRef(data), options)
}

export default useHostTemplate
