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

import { HOST_UNPERSISTED_FIELDS, ORG_UNPERSISTED_FIELDS } from '@aglyn/aglyn'
import {
  type DocumentReference,
  serverTimestamp,
  setDoc,
  type SetOptions,
  type UpdateData,
  updateDoc,
} from 'firebase/firestore'
import { useCallback } from 'react'

/**
 * Every UI write stamps `updatedAt` (AGL-455) — the "last updated" columns
 * read it, and callers historically forgot it. Spread order lets a caller's
 * explicit `updatedAt` win (backfills, imports).
 */
function stampUpdatedAt<D extends object>(data: D): D {
  return { updatedAt: serverTimestamp(), ...data }
}

/**
 * Keys that are never document fields, taken from where that is written down
 * (AGL-1429). `HOST_UNPERSISTED_FIELDS` and `ORG_UNPERSISTED_FIELDS` each
 * declare the synthetic `$id` the readers attach; the INTERSECTION is used
 * deliberately, so this generic boundary only ever strips a key that every
 * declaration agrees is unpersisted. A key added to one map alone is not
 * silently stripped from the other collection's writes — the spec's drift
 * assertion fires instead, and someone decides.
 */
const UNPERSISTED_FIELDS: readonly string[] = Object.freeze(
  Object.keys(HOST_UNPERSISTED_FIELDS).filter(
    (key) => key in ORG_UNPERSISTED_FIELDS,
  ),
)

/**
 * Drop the reader-injected keys before the payload leaves for Firestore.
 *
 * This has to happen here rather than in the refs' converters, which is where
 * it used to live alone (`503f197ca` added the `$id` strip to `useHostRef`'s
 * `toFirestore`). `updateDoc` never applies a converter — `setDoc` calls
 * `applyFirestoreDataConverter` and `updateDoc` does not — so a converter
 * strip is a guarantee about ONE of the two SDK calls, and which one a write
 * gets is decided by whether its caller happened to pass `merge`. That is how
 * `hosts/-MtN17_cpfPPLwWjE6z4` came to hold a persisted `$id` (AGL-1423).
 *
 * Only exact top-level keys are removed. Dotted `updateDoc` paths address
 * nested maps, and besigner node maps legitimately store a `$id` per node —
 * matching those would be the same over-broad scan AGL-1423 warned about.
 */
function dropUnpersistedFields<D extends object>(data: D): D {
  if (!UNPERSISTED_FIELDS.some((key) => key in data)) return data
  const rest = { ...data } as Record<string, unknown>
  for (const key of UNPERSISTED_FIELDS) delete rest[key]
  return rest as D
}


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
  return useCallback(
    (data: UpdateData<T>) =>
      typedUpdateDoc(
        ref,
        stampUpdatedAt(dropUnpersistedFields(data as object)) as UpdateData<T>,
      ),
    [ref],
  )
}

export function useSetDocCallback<T>(
  ref: DocumentReference<T>,
): SetDocCallback<T> {
  return useCallback(
    (data: Partial<T>, options?: SetOptions) =>
      setDoc(
        ref,
        stampUpdatedAt(dropUnpersistedFields(data as object)) as Partial<T>,
        options ?? {},
      ),
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
      // serialization (e.g. screen-version node compression) — and with it
      // EVERY strip the converter performs, including `$id` (AGL-1429).
      //
      // Nothing downstream of this line may therefore be relied on to clean
      // a payload. Anything that must hold for both branches belongs above
      // it, which is where `dropUnpersistedFields` now runs.
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
