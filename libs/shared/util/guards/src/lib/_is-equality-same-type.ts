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


import {_hasOwnProperty} from './_has-own-property'


export enum Equality {
  STRICT,
  LOOSE,
  DEFAULT = STRICT,
}

export interface IsEqualitySameTypeOptions {
  truthiness?: 'strict' | 'loose'
}

type IsEqualitySameTypeRestParams<T, U extends T> =
  | [...possibilities: U[]]
  | [...possibilities: U[], options: IsEqualitySameTypeOptions]

export function _isEqualitySameType<T, U extends T>(
  value: T,
  possibilities: U[],
  options?: IsEqualitySameTypeOptions,
): value is U
export function _isEqualitySameType<T, U extends T>(
  value: T,
  ...possibilities: U[]
): value is U
export function _isEqualitySameType<T, U extends T>(
  value: T,
  ...possibilities: IsEqualitySameTypeRestParams<T, U>
): value is U {
  const _lastItem = possibilities.pop(),
    _withOptions = _hasOwnProperty('equality', _lastItem),
    _options = {
      truthiness: Equality.DEFAULT,
      ..._withOptions ? _lastItem : undefined,
    }
  if (!_withOptions) {
    possibilities.push(_lastItem as U)
  }
  return possibilities.some((possibility) => {
    if (_options.truthiness === 'loose') {
      // noinspection EqualityComparisonWithCoercionJS
      return possibility == value
    }
    return possibility === value
  })
}
