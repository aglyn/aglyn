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
export type ModifyDocCallback<T> = (
  data: UpdateData<T> | Partial<T>,
  options?: ModifyDocOptions,
) => Promise<void>

// `updateDoc`'s overload resolution keys off `DocumentReference`'s
// `DbModelType` param, which defaults to the generic `DocumentData` when a
// caller only supplies `AppModelType` (as every hook here does) — that
// makes TS widen `UpdateData<T>` for unconstrained `T` and reject the
// match. Pin the call to the single-overload signature actually used.
const typedUpdateDoc = updateDoc as <T>(
  ref: DocumentReference<T>,
  data: UpdateData<T>,
) => Promise<void>

export function useUpdateDocCallback<T>(
  ref: DocumentReference<T>,
): UpdateDocCallback<T> {
  return useCallback((data: UpdateData<T>) => typedUpdateDoc(ref, data), [ref])
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
  const updateDocCb = useUpdateDocCallback(ref)
  const setDocCb = useSetDocCallback(ref)
  return useCallback(
    (data: UpdateData<T> | Partial<T>, options?: ModifyDocOptions) => {
      // SetOptions semantics (merge/mergeFields) require setDoc: updateDoc
      // ignores them and, critically, bypasses the ref's withConverter
      // serialization (e.g. screen-version node compression).
      const shouldSet =
        options?.shouldSet ||
        (options && 'merge' in options) ||
        (options && 'mergeFields' in options)
      if (shouldSet) return setDocCb(data as Partial<T>, options)
      return updateDocCb(data as UpdateData<T>)
    },
    [updateDocCb, setDocCb],
  )
}


export type UseModifyDocCallback<T> = typeof useModifyDocCallback<T>

export default useModifyDocCallback
