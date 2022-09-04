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
import {
  Bytes,
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

const converter: FirestoreDataConverter<AglynScreenVersion> = {
  toFirestore(data) {
    if (data.nodes) data.nodes = compress(data.nodes) as any
    if (data.elements) data.elements = compress(data.elements) as any
    if (data.$id) delete data.$id
    data.updatedAt = Timestamp.now()
    return data
  },
  fromFirestore(snapshot, options) {
    if (!snapshot.exists()) return undefined
    const data = snapshot.data(options)
    if (data?.nodes instanceof Bytes) {
      data.nodes = decompress(data.nodes)
    }
    if (data?.elements instanceof Bytes) {
      data.elements = decompress(data.elements)
    }
    data.$id = snapshot.id
    return data as AglynScreenVersion
  },
}

export type UseScreenVersionOptions = {
  screenId: string
  versionId: string
  useFirestoreDocDataOptions?: ReactFireOptions
}

type Response = [
  $version: ObservableStatus<AglynScreenVersion>,
  setVersion: (
    value: Partial<AglynScreenVersion>,
    options: SetOptions,
  ) => Promise<void>,
]

export function useScreenVersion(options: UseScreenVersionOptions): Response {
  const { screenId, versionId, useFirestoreDocDataOptions } = options
  const firestore = useFirestore()
  const versionRef = doc(
    firestore,
    'screens',
    screenId,
    'versions',
    versionId,
  ).withConverter(converter)

  const $version = useFirestoreDocDataOnce(versionRef, {
    idField: '$id',
    ...useFirestoreDocDataOptions,
  }) as ObservableStatus<AglynScreenVersion>

  // const response = useMemo(() => {
  //   const copied = copy(value)
  //   const elements = copied?.data?.elements
  //   if (elements && elements instanceof Bytes) {
  //     copied.data.elements = decompress(elements)
  //   }
  //   return copied
  // }, [value])

  const setVersion = useCallback(
    async (
      value: Partial<AglynScreenVersion>,
      options: SetOptions,
      onReject?: (e?: any) => void,
    ) => {
      await setDoc(versionRef, value, options)
        .then(async () => {
          const screenRef = doc(firestore, 'screens', screenId, 'updatedAt')
          return await setDoc(screenRef, Timestamp.now())
        })
        .catch((e) => {
          console.error(e)
          onReject && onReject(e)
        })
    },
    [firestore, screenId, versionRef],
  )

  return [$version, setVersion]
}

export default useScreenVersion
