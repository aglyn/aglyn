/**
 * @license
 * Copyright 2022 Aglyn LLC
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
import { compress, decompress } from '@aglyn/core-util-app'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { DocumentReference } from '@firebase/firestore'
import { Bytes, doc } from 'firebase/firestore'
import { ReactFireOptions, useFirestore } from 'reactfire'
import useDoc from './helpers/use-doc'

export const useScreenVersionRef = ({ hostId, screenId, versionId }) => {
  const firestore = useFirestore()
  const ref = doc(
    firestore,
    'hosts',
    hostId,
    'screens',
    screenId,
    'versions',
    versionId,
  )
  return ref.withConverter({
    toFirestore(data) {
      if (!(data?.nodes instanceof Bytes)) {
        data.nodes = compress(data.nodes || {})
      }
      data.updatedAt = Timestamp.now()
      return data
    },
    fromFirestore(snapshot, options) {
      if (!snapshot.exists()) return undefined
      const data = snapshot.data(options)
      if (data?.nodes instanceof Bytes) {
        data.nodes = decompress(data.nodes)
      }
      return data as Aglyn.AglynScreenVersion
    },
  }) as DocumentReference<Aglyn.AglynScreenVersion>
}

export const useScreenVersion = (
  data: {
    screenId: string
    versionId: string
    hostId: string
  },
  options?: ReactFireOptions<Aglyn.AglynScreenVersion>,
) => {
  return useDoc(useScreenVersionRef(data), options)
}

export default useScreenVersion
