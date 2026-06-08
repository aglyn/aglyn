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

import { type DocumentReference } from 'firebase/firestore'
import {
  type ObservableStatus,
  type ReactFireOptions,
  useFirestoreDocData,
} from 'reactfire'
import useModifyDocCallback, {
  type UseModifyDocCallback,
} from './use-modify-doc-callback'


export function useDocData<T>(
  ref: DocumentReference<T>,
  options?: ReactFireOptions<T>,
): ObservableStatus<T> {
  return useFirestoreDocData(ref, { idField: '$id', ...options })
}
export type UseDocData<T> = typeof useDocData<T>

export function useDoc<T>(
  ref: DocumentReference<T>,
  options?: ReactFireOptions<T>,
): {doc: ReturnType<UseDocData<T>>, setDoc: ReturnType<UseModifyDocCallback<T>>} {
  return {doc: useDocData(ref, options), setDoc: useModifyDocCallback(ref)}
}


export default useDoc
