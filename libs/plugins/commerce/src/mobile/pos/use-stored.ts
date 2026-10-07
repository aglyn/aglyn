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

import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * State kept on the device under `key` (AGL-3618): the basket, the quick
 * keys, the sale in progress. `ready` is false until the stored copy has
 * been read, so a screen never writes its initial value over a saved one.
 * A storage failure leaves the in-memory state working.
 */
export function useStoredState<T>(
  key: string,
  read: (raw: unknown) => T,
  initial: T,
): [T, (next: T | ((current: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial)
  const [ready, setReady] = useState(false)
  const readRef = useRef(read)
  readRef.current = read
  const initialRef = useRef(initial)

  useEffect(() => {
    let active = true
    setReady(false)
    setValue(initialRef.current)
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!active || raw === null) return
        try {
          setValue(readRef.current(JSON.parse(raw)))
        } catch {
          // An unreadable copy is no copy.
        }
      })
      .catch(() => undefined)
      .finally(() => active && setReady(true))
    return () => {
      active = false
    }
  }, [key])

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next
        const write =
          resolved === null || resolved === undefined
            ? AsyncStorage.removeItem(key)
            : AsyncStorage.setItem(key, JSON.stringify(resolved))
        write.catch(() => undefined)
        return resolved
      })
    },
    [key],
  )

  return [value, update, ready]
}
