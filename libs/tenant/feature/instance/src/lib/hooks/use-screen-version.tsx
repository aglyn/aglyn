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

import type { AglynScreenVersion } from '@aglyn/core-data-foundation'
import { compress, decompress } from '@aglyn/core-util-app'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { copy } from '@aglyn/shared-util-tools'
import { Bytes, doc, setDoc, type SetOptions } from 'firebase/firestore'
import { useCallback, useMemo } from 'react'
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

export type UpdateScreenVersion = {
  (value: Partial<AglynScreenVersion>, options: SetOptions): Promise<void>
}
export type UpdateScreenResult = ObservableStatus<AglynScreenVersion>

export function useScreenVersion(
  options: UseScreenVersionOptions,
): [UpdateScreenResult, UpdateScreenVersion] {
  const { screenId, versionId, useFirestoreDocDataOptions } = options
  const firestore = useFirestore()
  const reference = doc(firestore, 'screens', screenId, 'versions', versionId)

  const value = useFirestoreDocDataOnce(reference, {
    idField: '$id',
    ...useFirestoreDocDataOptions,
  }) as ObservableStatus<AglynScreenVersion>

  const response = useMemo(() => {
    const copied = copy(value)
    const elements = copied?.data?.elements
    if (elements && elements instanceof Bytes) {
      copied.data.elements = decompress(elements)
    }
    return copied
  }, [value])

  const update = useCallback(
    async (value, options: SetOptions) => {
      if (value.elements) value.elements = compress(value.elements)
      value.updatedAt = Timestamp.now()
      return await setDoc(reference, value, options)
    },
    [reference],
  )

  return [response, update]
}

export default useScreenVersion
