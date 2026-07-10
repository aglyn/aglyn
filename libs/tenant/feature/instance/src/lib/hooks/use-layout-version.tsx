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
import { useFirestore, type FirestoreDocOptions } from './firebase/firebase-services'
import useDoc from './helpers/use-doc'

export const useLayoutVersionRef = ({
  hostId,
  layoutId,
  versionId,
}: {
  hostId: string
  layoutId: string
  versionId: string
}) => {
  const firestore = useFirestore()
  const ref = doc(
    firestore,
    'hosts',
    hostId,
    'layouts',
    layoutId,
    'versions',
    versionId,
  )
  // Same converter behavior as screen versions: nodes are compressed at rest.
  return ref.withConverter({
    toFirestore(data) {
      const { $id, ...rest } = data
      const nodes = rest?.nodes instanceof Bytes
        ? rest.nodes
        : compress(rest?.nodes || {})
      return { ...rest, nodes, updatedAt: Timestamp.now() }
    },
    fromFirestore(snapshot, options) {
      if (!snapshot.exists()) return undefined
      const data = snapshot.data(options)
      if (data?.nodes instanceof Bytes) {
        return {
          ...data,
          nodes: decompress(data.nodes),
        } as Aglyn.AglynLayoutVersion
      }
      return data as Aglyn.AglynLayoutVersion
    },
  }) as DocumentReference<Aglyn.AglynLayoutVersion>
}

export const useLayoutVersion = (
  data: {
    hostId: string
    layoutId: string
    versionId: string
  },
  options?: FirestoreDocOptions<Aglyn.AglynLayoutVersion>,
) => {
  return useDoc(useLayoutVersionRef(data), options)
}

export default useLayoutVersion
