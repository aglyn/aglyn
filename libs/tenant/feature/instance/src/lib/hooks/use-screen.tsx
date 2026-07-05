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
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  doc,
  type DocumentSnapshot,
  type SnapshotOptions,
} from 'firebase/firestore'
import { ReactFireOptions, useFirestore } from 'reactfire'
import useDoc from './helpers/use-doc'

export const useScreenRef = ({ hostId, screenId }: { hostId: Aglyn.HostUid; screenId: Aglyn.ScreenUid }) => {
  const firestore = useFirestore()
  const ref = doc(firestore, 'hosts', hostId, 'screens', screenId)
  return ref.withConverter({
    toFirestore(data: Aglyn.AglynScreen) {
      const { $id, ...rest } = data
      return { ...rest, updatedAt: Timestamp.now() }
    },
    fromFirestore(
      snapshot: DocumentSnapshot<Aglyn.AglynScreen>,
      options: SnapshotOptions,
    ) {
      if (!snapshot.exists()) return undefined
      const data = snapshot.data(options)
      // data.nodes = data.versionRef?.get()
      return data as Aglyn.AglynScreen
    },
  })
}

export const useScreen = (
  data: {
    hostId: Aglyn.HostUid
    screenId: Aglyn.ScreenUid
  },
  options?: ReactFireOptions<Aglyn.AglynScreen>,
) => {
  return useDoc(useScreenRef(data), options)
}

export default useScreen
