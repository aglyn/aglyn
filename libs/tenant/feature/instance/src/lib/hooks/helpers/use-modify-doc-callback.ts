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

import {
  type DocumentReference,
  setDoc,
  type SetOptions,
  type UpdateData,
  updateDoc,
} from 'firebase/firestore'
import { useCallback } from 'react'


export type UpdateDocCallback<T> = (data: UpdateData<T>) => Promise<void>
export type SetDocCallback<T> = (
  data: Partial<T>,
  options?: SetOptions,
) => Promise<void>
export type ModifyDocOptions = SetOptions & { shouldSet?: boolean }
export type ModifyDocCallback<T> = {
  (
    data: typeof options extends { shouldSet: true }
      ? Partial<T>
      : UpdateData<T>,
    options?: ModifyDocOptions,
  ): Promise<void>
  (data: UpdateData<T> | Partial<T>, options?: ModifyDocOptions): Promise<void>
}

export function useUpdateDocCallback<T>(
  ref: DocumentReference<T>,
): UpdateDocCallback<T> {
  return useCallback((data: UpdateData<T>) => updateDoc(ref, data), [ref])
}

export function useSetDocCallback<T>(
  ref: DocumentReference<T>,
): SetDocCallback<T> {
  return useCallback(
    (data: Partial<T>, options?: SetOptions) => setDoc(ref, data, options),
    [ref],
  )
}

export function useModifyDocCallback<T>(
  ref: DocumentReference<T>,
): ModifyDocCallback<T> {
  const updateDoc = useUpdateDocCallback(ref)
  const setDoc = useSetDocCallback(ref)
  return useCallback(
    (data: UpdateData<T> | Partial<T>, options?: ModifyDocOptions) => {
      if (options?.shouldSet) return setDoc(data as Partial<T>, options)
      return updateDoc(data as UpdateData<T>)
    },
    [updateDoc, setDoc],
  )
}


export type UseModifyDocCallback<T> = typeof useModifyDocCallback<T>

export default useModifyDocCallback
