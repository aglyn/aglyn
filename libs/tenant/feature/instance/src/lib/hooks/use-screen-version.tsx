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

import { doc, setDoc, type SetOptions } from 'firebase/firestore'
import { useCallback } from 'react'
import {
  type ObservableStatus,
  type ReactFireOptions,
  useFirestore,
  useFirestoreDocDataOnce,
} from 'reactfire'

export type UseScreenVersionOptions = {
  screenId: string
  versionId: string
  useFirestoreDocDataOptions?: ReactFireOptions
}

export const useScreenVersion = <T,>(
  options: UseScreenVersionOptions,
): [ObservableStatus<T>, (value: T, options: SetOptions) => Promise<void>] => {
  const { screenId, versionId, useFirestoreDocDataOptions } = options
  const firestore = useFirestore()
  const reference = doc(firestore, 'screens', screenId, 'versions', versionId)

  const value = useFirestoreDocDataOnce(reference, {
    idField: '$id',
    ...useFirestoreDocDataOptions,
  }) as ObservableStatus<T>

  const update = useCallback(
    async (value, options: SetOptions) => {
      return await setDoc(reference, value, options)
    },
    [reference],
  )

  return [value, update]
}

export default useScreenVersion
