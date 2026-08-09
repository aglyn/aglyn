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
  type DocumentReference,
  type FirestoreError,
} from 'firebase/firestore'
import { useEffect, useRef, useState, type DependencyList } from 'react'
import {
  DENIAL_STREAK_TO_REPORT,
  denialLabelForQuery,
  reportFirestoreDenial,
  reportFirestoreServerRead,
} from './firestore-denial-reporter'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5

export type FirestoreDocStatus = 'loading' | 'success' | 'error'

export interface UseFirestoreDocOptions {
  idField?: string
}

export interface UseFirestoreDocResult<T> {
  data: T | undefined
  status: FirestoreDocStatus
  error: FirestoreError | undefined
  /**
   * `data` still carries writes this client made that the server has NOT
   * acknowledged. Carried rather than dropped for the same reason as
   * `ObservableStatus.hasPendingWrites` — see that comment (AGL-1262).
   */
  hasPendingWrites: boolean
  /**
   * `data` came from the local cache and the server has not confirmed it
   * (AGL-1066). See `ObservableStatus.fromCache` for why this matters and
   * why it is the signal to reach for rather than `staleSession`.
   */
  fromCache: boolean
}

/**
 * Single-document counterpart to `useFirestoreCollection` — see that hook's
 * doc comment for why this exists instead of reactfire's
 * `useFirestoreDocData` (AGL-216/217).
 *
 * `buildRef` is re-invoked from `deps` the same way a `useEffect`/`useMemo`
 * callback would be — pass the same primitive values (ids, uid, firestore)
 * you'd put in a `useMemo` dependency array, not the `DocumentReference`
 * object itself.
 */
export function useFirestoreDoc<T = DocumentData>(
  buildRef: () => DocumentReference<DocumentData> | null | undefined,
  deps: DependencyList,
  options: UseFirestoreDocOptions = {},
): UseFirestoreDocResult<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [status, setStatus] = useState<FirestoreDocStatus>('loading')
  const [error, setError] = useState<FirestoreError | undefined>(undefined)
  const [hasPendingWrites, setHasPendingWrites] = useState(false)
  // Un-confirmed until a snapshot says otherwise: a hook that has not heard
  // from the server yet must not read as server-confirmed.
  const [fromCache, setFromCache] = useState(true)
  const buildRefRef = useRef(buildRef)
  buildRefRef.current = buildRef
  const idField = options.idField

  useEffect(() => {
    setStatus('loading')
    setError(undefined)
    // Clear on every dep change (AGL-591): a scope move between two live
    // refs must not keep showing the previous doc until the new snapshot
    // arrives. Mirrors use-firestore-collection.
    setData(undefined)
    setHasPendingWrites(false)
    setFromCache(true)

    const ref = buildRefRef.current()
    if (!ref) {
      return
    }

    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    // Refusals since the last SERVER snapshot (AGL-1066) — see the note on
    // `DENIAL_STREAK_TO_REPORT` for why this is not `attempt`.
    let deniedStreak = 0
    let denialReported = false
    const denialLabel = denialLabelForQuery(ref)

    const subscribe = () => {
      unsubscribe = onSnapshot(
        ref,
        (snapshot) => {
          if (cancelled) return
          attempt = 0
          setStatus('success')
          setError(undefined)
          setHasPendingWrites(snapshot.metadata.hasPendingWrites)
          setFromCache(snapshot.metadata.fromCache)
          // Only the SERVER answering is evidence the session can read.
          if (!snapshot.metadata.fromCache) {
            deniedStreak = 0
            denialReported = false
            // Proof the session can read — stronger than any accumulated
            // denial, and what stops a scoped collaborator's by-design
            // denials from ever adding up to a re-auth prompt.
            reportFirestoreServerRead()
          }
          if (!snapshot.exists()) {
            setData(undefined)
            return
          }
          const value = { ...snapshot.data() } as Record<string, unknown>
          if (idField) value[idField] = snapshot.id
          setData(value as T)
        },
        (err) => {
          if (cancelled) return
          unsubscribe?.()
          // Say so once per outage, and only for a refusal — a lost network
          // produces no error callback at all, so this cannot fire offline.
          if (err?.code === 'permission-denied') {
            deniedStreak += 1
            if (deniedStreak >= DENIAL_STREAK_TO_REPORT && !denialReported) {
              denialReported = true
              reportFirestoreDenial(denialLabel)
            }
          }
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

  return { data, status, error, hasPendingWrites, fromCache }
}

export default useFirestoreDoc
