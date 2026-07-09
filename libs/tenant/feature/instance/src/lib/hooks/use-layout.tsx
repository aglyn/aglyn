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
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  doc,
  type DocumentSnapshot,
  type SnapshotOptions,
} from 'firebase/firestore'
import { useFirestore, type FirestoreDocOptions } from './firebase/firebase-services'
import useDoc from './helpers/use-doc'

export const useLayoutRef = ({
  hostId,
  layoutId,
}: {
  hostId: Aglyn.HostUid
  layoutId: Aglyn.LayoutUid
}) => {
  const firestore = useFirestore()
  const ref = doc(firestore, 'hosts', hostId, 'layouts', layoutId)
  return ref.withConverter({
    toFirestore(data: Aglyn.AglynLayout) {
      const { $id, ...rest } = data
      return { ...rest, updatedAt: Timestamp.now() }
    },
    fromFirestore(
      snapshot: DocumentSnapshot<Aglyn.AglynLayout>,
      options: SnapshotOptions,
    ) {
      if (!snapshot.exists()) return undefined
      const data = snapshot.data(options)
      return data as Aglyn.AglynLayout
    },
  })
}

export const useLayout = (
  data: {
    hostId: Aglyn.HostUid
    layoutId: Aglyn.LayoutUid
  },
  options?: FirestoreDocOptions<Aglyn.AglynLayout>,
) => {
  return useDoc(useLayoutRef(data), options)
}

export default useLayout
