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
'use client'

import {
  onSnapshot,
  type DocumentData,
  type FirestoreError,
  type Query,
} from 'firebase/firestore'
import { useEffect, useRef, useState, type DependencyList } from 'react'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5

export type FirestoreCollectionStatus = 'loading' | 'success' | 'error'

export interface UseFirestoreCollectionOptions {
  idField?: string
}

export interface UseFirestoreCollectionResult<T> {
  data: T[]
  status: FirestoreCollectionStatus
  error: FirestoreError | undefined
}

/**
 * Collection-query counterpart to reactfire's `useFirestoreCollectionData`,
 * but backed by a raw `onSnapshot` listener with its own retry/backoff
 * instead of reactfire's cached Observable. That cache terminates forever on
 * its first error — a transient `permission-denied` right after sign-in
 * (before Firestore's own credential provider has attached the user's ID
 * token) permanently breaks the query for the rest of the session, even
 * across remounts. A fresh `onSnapshot` call each retry reopens a genuinely
 * new listener, so it recovers once the token has propagated (AGL-216/217).
 *
 * `buildQuery` is re-invoked from `deps` the same way a `useEffect`/`useMemo`
 * callback would be — pass the same primitive values (ids, uid, firestore)
 * you'd put in a `useMemo` dependency array, not the `Query` object itself.
 */
export function useFirestoreCollection<T = DocumentData>(
  buildQuery: () => Query<DocumentData> | null | undefined,
  deps: DependencyList,
  options: UseFirestoreCollectionOptions = {},
): UseFirestoreCollectionResult<T> {
  const [data, setData] = useState<T[]>([])
  const [status, setStatus] = useState<FirestoreCollectionStatus>('loading')
  const [error, setError] = useState<FirestoreError | undefined>(undefined)
  const buildQueryRef = useRef(buildQuery)
  buildQueryRef.current = buildQuery
  const idField = options.idField

  useEffect(() => {
    setStatus('loading')
    setError(undefined)

    const q = buildQueryRef.current()
    if (!q) {
      setData([])
      return
    }

    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const subscribe = () => {
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (cancelled) return
          attempt = 0
          setStatus('success')
          setError(undefined)
          setData(
            snapshot.docs.map((docSnap) => {
              const value = { ...docSnap.data() } as Record<string, unknown>
              if (idField) value[idField] = docSnap.id
              return value as T
            }),
          )
        },
        (err) => {
          if (cancelled) return
          unsubscribe?.()
          if (attempt < MAX_RETRIES) {
            attempt += 1
            timer = setTimeout(subscribe, RETRY_DELAY_MS)
          } else {
            setStatus('error')
            setError(err)
          }
        },
      )
    }
    subscribe()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, status, error }
}

export default useFirestoreCollection
