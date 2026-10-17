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

import { doc, type Firestore, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'

export interface LiveDoc<T> {
  /** The document as `{ $id, ...data }`, or null when it does not exist. */
  data: (T & { $id: string }) | null
  ready: boolean
  error: Error | null
}

/**
 * One document, live (AGL-3622), under the reader's own rules: a record
 * screen's subject, a site, a member's own row. A path with an empty
 * segment holds the read, so a screen can name it before it knows the id.
 */
export function useLiveDoc<T = Record<string, unknown>>(
  firestore: unknown,
  path: readonly (string | null | undefined)[] | null,
): LiveDoc<T> {
  const complete = Boolean(path && path.length >= 2 && path.every(Boolean))
  const key = complete && path ? path.join('/') : null
  const [state, setState] = useState<LiveDoc<T>>({ data: null, ready: false, error: null })
  useEffect(() => {
    setState({ data: null, ready: false, error: null })
    if (!key || !firestore) return
    const [first, ...rest] = key.split('/')
    return onSnapshot(
      doc(firestore as Firestore, first, ...rest),
      (snapshot) =>
        setState({
          data: snapshot.exists() ? ({ ...(snapshot.data() as T), $id: snapshot.id } as T & { $id: string }) : null,
          ready: true,
          error: null,
        }),
      (error) => setState({ data: null, ready: true, error }),
    )
  }, [firestore, key])
  return state
}
