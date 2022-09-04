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

import type { AglynScreen } from '@aglyn/core-data-foundation'
import type { OrUndef } from '@aglyn/shared-data-types'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  doc,
  type FirestoreDataConverter,
  setDoc,
  type SetOptions,
} from 'firebase/firestore'
import { useCallback } from 'react'
import {
  type ObservableStatus,
  type ReactFireOptions,
  useFirestore,
  useFirestoreDocDataOnce,
} from 'reactfire'

const converter: FirestoreDataConverter<AglynScreen> = {
  toFirestore(data) {
    if (data.$id) delete data.$id
    data.updatedAt = Timestamp.now()
    return data
  },
  fromFirestore(snapshot, options) {
    if (!snapshot.exists()) return undefined
    const data = snapshot.data(options)
    data.$id = snapshot.id
    return data as AglynScreen
  },
}

export type UseScreenOptions = {
  screenId: string
  useFirestoreDocDataOptions?: ReactFireOptions
}

type Response = [
  $screen: ObservableStatus<OrUndef<AglynScreen>>,
  setScreen: (
    value: Partial<AglynScreen>,
    options: SetOptions,
  ) => Promise<void>,
]

export function useScreen(options: UseScreenOptions): Response {
  const { screenId, useFirestoreDocDataOptions } = options
  const firestore = useFirestore()
  const reference = doc(firestore, 'screens', screenId).withConverter(converter)

  const $screen = useFirestoreDocDataOnce(reference, {
    idField: '$id',
    ...useFirestoreDocDataOptions,
  }) as ObservableStatus<OrUndef<AglynScreen>>

  const setScreen = useCallback(
    async function setScreen(value: Partial<AglynScreen>, options: SetOptions) {
      const { $id, ...fields } = value
      return await setDoc(reference, fields, options)
    },
    [reference],
  )

  return [$screen, setScreen]
}

export default useScreen
