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

import { _isFnT } from '@aglyn/shared-util-tools'
import isEqual from 'lodash-es/isEqual'
import { type DependencyList, useCallback, useEffect, useState } from 'react'
import type {
  Observable as RxJsObservable,
  Unsubscribable as RxJsUnsubscribable,
} from 'rxjs'

export type SubscribableLike<T> = RxJsObservable<T> | Observable<T>
export type MapObservable<V, R> = (newValue: V, prevValue: R) => R

export interface Observable<T> {
  subscribe: (listener: (value: T) => void) => {
    unsubscribe: () => void
  }
  pipe?(...args): any
}

export function useSubscribable<T>(
  $subscribable: SubscribableLike<T>,
): T | undefined
export function useSubscribable<
  T,
  U = any,
  M extends MapObservable<U, U | T | undefined> = MapObservable<
    U,
    U | T | undefined
  >,
>(
  $subscribable: SubscribableLike<U>,
  initialValue: U | T,
  mapValue?: M,
  dependencies?: DependencyList,
): U | T
export function useSubscribable<
  T,
  U = any,
  M extends MapObservable<U, U | T | undefined> = MapObservable<
    U,
    U | T | undefined
  >,
>(
  $subscribable: SubscribableLike<U>,
  initialValue?: U | T,
  mapValue?: M,
  dependencies: DependencyList = [],
): U | T | undefined {
  const [value, update] = useState<T | U | undefined>(() => initialValue)
  const _dependencies = [...(dependencies || [])]

  const mapUpdate = useCallback((newValue, prevValue) => {
    if (_isFnT(mapValue)) return mapValue(newValue, prevValue as T) as T
    return newValue as U
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, _dependencies)

  useEffect(() => {
    function handleChange(newValue) {
      update((prevValue) => {
        const value = mapUpdate(newValue, prevValue)
        if (isEqual(prevValue, value)) return prevValue
        return value
      })
    }

    const subscriber: RxJsUnsubscribable =
      $subscribable?.subscribe(handleChange)
    return () => subscriber?.unsubscribe?.()
  }, [$subscribable, mapUpdate])

  return value
}

export default useSubscribable
