/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Gets value from localstorage
function getValueFromLocalStorage<T>(key: string): T {
  if (typeof localStorage === 'undefined') return null
  const storedValue = localStorage.getItem(key) ?? 'null'
  try {
    return JSON.parse(storedValue)
  } catch (error) {
    console.error(error)
  }

  return storedValue as T
}

// Saves value to localstorage
function saveValueToLocalStorage<T>(key: string, value: T) {
  if (typeof localStorage === 'undefined') return null
  return localStorage.setItem(key, JSON.stringify(value))
}

/**
 * @param key Key of the localStorage object
 * @param initialState Default initial value
 */
function initialize<T>(key: string, initialState: T): T {
  const localStorageValue = getValueFromLocalStorage<T>(key)
  if (localStorageValue === null) return initialState
  else return localStorageValue
}

type LocalStorageItemState<T> = [
  value: T,
  setState: (newValue: T) => void,
  removeState: () => void,
]
type BroadcastCustomEvent<T> = CustomEvent<{ newValue: T }>

/**
 * useLocalStorageItemState hook
 * Tracks a value within localStorage and updates it
 *
 * @param {string} key - Key of the localStorage object
 * @param {any} initialState - Default initial value
 * @see https://rooks.vercel.app/docs/useLocalstorageState
 */
export function useLocalStorageItemState<T>(
  key: string,
  initialState?: T,
): LocalStorageItemState<T> {
  const [value, setValue] = useState<T>(() => initialize<T>(key, initialState))
  const isUpdateFromCrossDocumentListener = useRef(false)
  const isUpdateFromWithinDocumentListener = useRef(false)

  const customEventTypeName = useMemo(() => {
    return `localstorage-update-${key}`
  }, [key])

  useEffect(() => {
    /**
     * We need to ensure there is no loop of
     * storage events fired. Hence we are using a ref
     * to keep track of whether setValue is from another
     * storage event
     */
    if (
      !isUpdateFromCrossDocumentListener.current &&
      !isUpdateFromWithinDocumentListener.current
    ) {
      saveValueToLocalStorage<T>(key, value)
    }
  }, [key, value])

  const listenToCrossDocumentStorageEvents = useCallback(
    (event: StorageEvent) => {
      if (event.storageArea === localStorage && event.key === key) {
        try {
          isUpdateFromCrossDocumentListener.current = true
          const newValue = JSON.parse(event.newValue ?? 'null')
          if (value !== newValue) {
            setValue(newValue)
          }
        } catch (error) {
          console.warn(error)
        }
      }
    },
    [key, value],
  )

  // check for changes across documents
  useEffect(() => {
    // eslint-disable-next-line no-negated-condition
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', listenToCrossDocumentStorageEvents)

      return () => {
        window.removeEventListener(
          'storage',
          listenToCrossDocumentStorageEvents,
        )
      }
    } else {
      console.warn('useLocalStorageItemState: window is undefined.')

      return () => {}
    }
  }, [listenToCrossDocumentStorageEvents])

  const listenToCustomEventWithinDocument = useCallback(
    (event: BroadcastCustomEvent<T>) => {
      try {
        isUpdateFromWithinDocumentListener.current = true
        const { newValue } = event.detail
        if (value !== newValue) {
          setValue(newValue)
        }
      } catch (error) {
        console.warn(error)
      }
    },
    [value],
  )

  // check for changes within document
  useEffect(() => {
    // eslint-disable-next-line no-negated-condition
    if (typeof document !== 'undefined') {
      document.addEventListener(
        customEventTypeName,
        listenToCustomEventWithinDocument as EventListener,
      )

      return () => {
        document.removeEventListener(
          customEventTypeName,
          listenToCustomEventWithinDocument as EventListener,
        )
      }
    } else {
      console.warn('[useLocalStorageItemState] document is undefined.')

      return () => {}
    }
  }, [customEventTypeName, listenToCustomEventWithinDocument])

  const broadcastValueWithinDocument = useCallback(
    (newValue: T) => {
      // eslint-disable-next-line no-negated-condition
      if (typeof document !== 'undefined') {
        const event: BroadcastCustomEvent<T> = new CustomEvent(
          customEventTypeName,
          { detail: { newValue } },
        )
        document.dispatchEvent(event)
      } else {
        console.warn('[useLocalStorageItemState] document is undefined.')
      }
    },
    [customEventTypeName],
  )

  const setState = useCallback(
    (newValue: T) => {
      isUpdateFromCrossDocumentListener.current = false
      isUpdateFromWithinDocumentListener.current = false
      setValue(newValue)
      broadcastValueWithinDocument(newValue)
    },
    [broadcastValueWithinDocument],
  )

  const removeState = useCallback(() => {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.warn(error)
    }
  }, [key])

  return [value, setState, removeState]
}

export default useLocalStorageItemState
