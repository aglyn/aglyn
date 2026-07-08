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
  collection,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'
import { useEffect, useRef, useState } from 'react'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5

export interface AdminHost extends DocumentData {
  $id: string
}

/**
 * Subscribes to `hosts` filtered on `admins.{uid}`, with its own retry —
 * NOT via `useFirestoreCollectionData` (reactfire), whose cached Observable
 * is a *terminated* RxJS stream once it errors: resubscribing (even from a
 * freshly remounted component) replays the same cached error forever rather
 * than opening a new Firestore listen. Right after sign-in, `useUser()` can
 * report a signed-in user a beat before Firestore's own credential provider
 * has attached that user's ID token, so this first listen can hit one
 * transient `permission-denied`. Registering a genuinely fresh `onSnapshot`
 * listener on a short backoff resolves it once the token has propagated
 * (AGL-216).
 */
export function useAdminHosts(
  firestore: Firestore,
  uid: string | undefined,
): { hosts: AdminHost[]; ready: boolean } {
  const [hosts, setHosts] = useState<AdminHost[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(false)
    if (!uid) return

    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const subscribe = () => {
      const q = query(
        collection(firestore, 'hosts'),
        where(`admins.${uid}`, '==', true),
      )
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (cancelled) return
          attempt = 0
          setReady(true)
          setHosts(
            snapshot.docs.map((doc) => ({ $id: doc.id, ...doc.data() })),
          )
        },
        () => {
          if (cancelled) return
          unsubscribe?.()
          if (attempt < MAX_RETRIES) {
            attempt += 1
            timer = setTimeout(subscribe, RETRY_DELAY_MS)
          } else {
            // Give up gracefully rather than crash the app — render with an
            // empty list once retries are exhausted.
            setReady(true)
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
  }, [firestore, uid])

  return { hosts, ready }
}

export default useAdminHosts
