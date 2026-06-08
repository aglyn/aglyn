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

import debounce, {type DebouncedFunc, type DebounceSettings} from 'lodash-es/debounce'
import {DependencyList, useCallback} from 'react'


export interface DebouncedFuncLeading<T extends (...args: any[]) => any> extends DebouncedFunc<T> {
  (...args: Parameters<T>): ReturnType<T>;
  flush(): ReturnType<T>;
}

export function useDebounce<T extends (...args: any) => any>(
  func: T,
  wait: number | undefined,
  options: DebounceSettings,
  deps?: DependencyList,
): DebouncedFuncLeading<T>
export function useDebounce<T extends (...args: any) => any>(
  func: T,
  wait?: number,
  options?: DebounceSettings,
  deps: DependencyList = [],
): DebouncedFunc<T> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(debounce(func, wait, options), deps)
}

export default useDebounce
