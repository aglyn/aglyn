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
import { type ObservableStatus, type ReactFireOptions } from 'reactfire'
import useModifyDocCallback, {
  type UseModifyDocCallback,
} from './use-modify-doc-callback'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5

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
  options?: ReactFireOptions<T>,
): ObservableStatus<T> {
  const idField = options?.idField
  const initialData = options?.initialData
  const [status, setStatus] = useState<'loading' | 'error' | 'success'>(
    initialData !== undefined ? 'success' : 'loading',
  )
  const [data, setData] = useState<T>(initialData as T)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [hasEmitted, setHasEmitted] = useState(initialData !== undefined)
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

    const subscribe = () => {
      unsubscribe = onSnapshot(
        ref,
        (snapshot) => {
          if (cancelled) return
          attempt = 0
          setStatus('success')
          setError(undefined)
          setHasEmitted(true)
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
          if (attempt < MAX_RETRIES) {
            attempt += 1
            timer = setTimeout(subscribe, RETRY_DELAY_MS)
          } else {
            setStatus('error')
            setError(err)
            resolveFirstValueRef.current?.()
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
  }, [ref.firestore, ref.path])

  return {
    status,
    hasEmitted,
    isComplete: false,
    data,
    error,
    firstValuePromise: firstValuePromiseRef.current,
  }
}
export type UseDocData<T> = typeof useDocData<T>

export function useDoc<T>(
  ref: DocumentReference<T>,
  options?: ReactFireOptions<T>,
): {doc: ReturnType<UseDocData<T>>, setDoc: ReturnType<UseModifyDocCallback<T>>} {
  return {doc: useDocData(ref, options), setDoc: useModifyDocCallback(ref)}
}


export default useDoc
