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

import { onSnapshot, type DocumentReference } from 'firebase/firestore'
import { useEffect, useRef, useState } from 'react'
import type { ObservableStatus, FirestoreDocOptions } from '../firebase/firebase-services'
import {
  DENIAL_STREAK_TO_REPORT,
  subscribeFirestoreSessionHeal,
} from '../firestore-denial-reporter'
import useModifyDocCallback, {
  type UseModifyDocCallback,
} from './use-modify-doc-callback'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5
/** See `use-firestore-collection`'s copy of this (AGL-1066). */
const REFUSED_RETRY_DELAY_MS = 2_000

/**
 * Raw `onSnapshot` listener with its own retry/backoff instead of
 * reactfire's `useFirestoreDocData` — that hook caches the query's RxJS
 * Observable, and once it errors the Observable is *terminated forever*:
 * remounting the component never reopens the Firestore subscription, so a
 * single transient `permission-denied` (e.g. right after sign-in, before
 * Firestore's own credential provider has attached the user's ID token)
 * permanently breaks every caller of `useHost`/`useLayout`/`useScreen`/
 * `useScreenVersion`/`useLayoutVersion` for the rest of the session
 * (AGL-216/217/223). A fresh `onSnapshot` call each retry opens a genuinely
 * new listener, so it recovers once the token has propagated.
 */
export function useDocData<T>(
  ref: DocumentReference<T>,
  options?: FirestoreDocOptions<T>,
): ObservableStatus<T> {
  const idField = options?.idField
  const initialData = options?.initialData
  const [status, setStatus] = useState<'loading' | 'error' | 'success'>(
    initialData !== undefined ? 'success' : 'loading',
  )
  const [data, setData] = useState<T>(initialData as T)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [hasEmitted, setHasEmitted] = useState(initialData !== undefined)
  const [hasPendingWrites, setHasPendingWrites] = useState(false)
  // Un-confirmed until a snapshot says otherwise (AGL-1066).
  const [fromCache, setFromCache] = useState(true)
  const [serverDenied, setServerDenied] = useState(false)
  const resolveFirstValueRef = useRef<(() => void) | undefined>(undefined)
  const firstValuePromiseRef = useRef<Promise<void> | undefined>(undefined)
  if (!firstValuePromiseRef.current) {
    firstValuePromiseRef.current = new Promise((resolve) => {
      resolveFirstValueRef.current = resolve
    })
  }

  useEffect(() => {
    setStatus('loading')
    setError(undefined)

    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    /**
     * Refusals since the last SERVER snapshot (AGL-1066).
     *
     * Still distinct from `attempt` after the flip: `attempt` is a BUDGET
     * that the heal broadcast may refund, whereas this is EVIDENCE about the
     * server that only a server snapshot may clear. Counted here to publish
     * `serverDenied` and to decide the slow cadence — the `session-health`
     * reporting the other two listener hooks do is a separate decision, and
     * this hook's callers (the besigner document family) are exactly the ones
     * a false verdict would hurt most.
     */
    let deniedStreak = 0
    /**
     * The retry budget is spent and the server's last word was a refusal —
     * what keeps `status: 'error'` from being undone by the cached emission
     * that precedes every reopened refusal (AGL-1066). See the longer note
     * on the same variable in `use-firestore-collection`.
     */
    let terminal = false

    const subscribe = () => {
      unsubscribe = onSnapshot(
        ref,
        (snapshot) => {
          if (cancelled) return
          // Only the SERVER answering refunds the retry budget, and only a
          // server snapshot ends a refusal (AGL-1066).
          if (!snapshot.metadata.fromCache) {
            attempt = 0
            terminal = false
            deniedStreak = 0
            setServerDenied(false)
          } else if (deniedStreak === 0) {
            // Cached, but nothing has been refused since the server last
            // answered — not the AGL-1066 fault, so the budget is refunded
            // exactly as it always was. This is what keeps offline inert:
            // `unavailable` never enters `deniedStreak`.
            attempt = 0
          }
          if (!terminal) {
            setStatus('success')
            setError(undefined)
          }
          // Always true after ANY emission, cached included: this is what
          // tells a consumer "I have data, the server refused" apart from "I
          // never had data" — the distinction the besigner editors and the
          // host setup Theme tab blank on (AGL-1066).
          setHasEmitted(true)
          // Kept, not dropped: a snapshot that still carries this client's
          // own queued write is not evidence of what the store holds
          // (AGL-1262). Callers that record a "last saved" state need to
          // know the difference.
          setHasPendingWrites(snapshot.metadata.hasPendingWrites)
          setFromCache(snapshot.metadata.fromCache)
          const value = snapshot.exists()
            ? ({
                ...(snapshot.data() as object),
                ...(idField ? { [idField]: snapshot.id } : {}),
              } as T)
            : (undefined as T)
          setData(value)
          resolveFirstValueRef.current?.()
        },
        (err) => {
          if (cancelled) return
          unsubscribe?.()
          // Only a refusal — a lost network produces no error callback at
          // all, and anything that does surface one carries `unavailable`,
          // which must never read as a dead session.
          if ((err as { code?: string })?.code === 'permission-denied') {
            deniedStreak += 1
            if (deniedStreak >= DENIAL_STREAK_TO_REPORT) setServerDenied(true)
          }
          if (attempt < MAX_RETRIES) {
            attempt += 1
            timer = setTimeout(
              subscribe,
              deniedStreak > MAX_RETRIES
                ? REFUSED_RETRY_DELAY_MS
                : RETRY_DELAY_MS,
            )
          } else {
            terminal = true
            setStatus('error')
            setError(err)
            resolveFirstValueRef.current?.()
            // A refusal streak keeps a slow road back for a recovery nobody
            // announced — see the same branch in `use-firestore-collection`.
            if (deniedStreak > MAX_RETRIES) {
              timer = setTimeout(subscribe, REFUSED_RETRY_DELAY_MS)
            }
          }
        },
      )
    }
    subscribe()

    /**
     * Reopen when the session heals — see the long note on the same
     * subscription in `use-firestore-collection` (AGL-1066).
     *
     * This hook is where it counts most: its deps are `[ref.firestore,
     * ref.path]`, neither of which moves when a `stale` re-auth signs the
     * same uid back in, and it is what every besigner editor reads through.
     * Nothing else was ever going to bring those pages back without a reload.
     */
    const unsubscribeHeal = subscribeFirestoreSessionHeal(() => {
      if (cancelled || deniedStreak === 0) return
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      unsubscribe?.()
      attempt = 0
      subscribe()
    })

    return () => {
      cancelled = true
      unsubscribeHeal()
      if (timer) clearTimeout(timer)
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.firestore, ref.path])

  return {
    status,
    hasEmitted,
    isComplete: false,
    data,
    error,
    firstValuePromise: firstValuePromiseRef.current,
    hasPendingWrites,
    fromCache,
    serverDenied,
  }
}
export type UseDocData<T> = typeof useDocData<T>

export function useDoc<T>(
  ref: DocumentReference<T>,
  options?: FirestoreDocOptions<T>,
): {doc: ReturnType<UseDocData<T>>, setDoc: ReturnType<UseModifyDocCallback<T>>} {
  return {doc: useDocData(ref, options), setDoc: useModifyDocCallback(ref)}
}


export default useDoc
