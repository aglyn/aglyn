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
import { compress, decompress } from '@aglyn/aglyn'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { DocumentReference } from '@firebase/firestore'
import { Bytes, doc } from 'firebase/firestore'
import {
  useFirestore,
  type FirestoreDocOptions,
} from './firebase/firebase-services'
import useDoc from './helpers/use-doc'

/**
 * A reusable component's working version (AGL-679), at
 * `hosts/{hostId}/components/{componentId}/versions/{versionId}`.
 *
 * Compressed at rest like screen and layout versions. Note the asymmetry
 * with those two: the component's PUBLISHED nodes live on the parent doc,
 * because the tenant runtime reads every component in one collection query
 * — pulling published content into version docs would make that N+1 per
 * page render. These docs are editing history only.
 */
export const useComponentVersionRef = ({
  hostId,
  componentId,
  versionId,
}: {
  hostId: string
  componentId: string
  versionId: string
}) => {
  const firestore = useFirestore()
  const ref = doc(
    firestore,
    'hosts',
    hostId,
    'components',
    componentId,
    'versions',
    versionId,
  )
  return ref.withConverter({
    toFirestore(data) {
      const { $id, ...rest } = data
      const nodes =
        rest?.nodes instanceof Bytes ? rest.nodes : Bytes.fromUint8Array(compress(rest?.nodes || {}))
      return { ...rest, nodes, updatedAt: Timestamp.now() }
    },
    fromFirestore(snapshot, options) {
      if (!snapshot.exists()) return undefined
      const data = snapshot.data(options)
      if (data?.nodes instanceof Bytes) {
        return {
          ...data,
          nodes: decompress(data.nodes),
        } as Aglyn.AglynHostComponentVersion
      }
      return data as Aglyn.AglynHostComponentVersion
    },
  }) as DocumentReference<Aglyn.AglynHostComponentVersion>
}

export const useComponentVersion = (
  data: {
    hostId: string
    componentId: string
    versionId: string
  },
  options?: FirestoreDocOptions<Aglyn.AglynHostComponentVersion>,
) => {
  return useDoc(useComponentVersionRef(data), options)
}

export default useComponentVersion
