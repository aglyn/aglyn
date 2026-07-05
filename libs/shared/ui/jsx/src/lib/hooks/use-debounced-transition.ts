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

import type {DebouncedFunc, DebounceSettings} from 'lodash-es/debounce'
import {DependencyList, useTransition} from 'react'
import useDebounce, {type DebouncedFuncLeading} from './use-debounce'


type TransitionParameters = Parameters<ReturnType<typeof useTransition>[1]>

export function useDebouncedTransition<T extends (...args: any) => any>(
  wait: number | undefined,
  options: DebounceSettings,
  deps?: DependencyList,
): [boolean, DebouncedFuncLeading<(func: T) => void>]
export function useDebouncedTransition<T extends (...args: any) => any>(
  wait?: number,
  options?: DebounceSettings,
  deps: DependencyList = [],
): [boolean, DebouncedFunc<(func: T) => void>] {
  const [transitioning, startTransition] = useTransition()
  const debounce = useDebounce((func: T) => {
    startTransition((...args: unknown[]) => {
      func(...args)
    })
  }, wait, options, deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return [transitioning, debounce]
}

export default useDebouncedTransition
