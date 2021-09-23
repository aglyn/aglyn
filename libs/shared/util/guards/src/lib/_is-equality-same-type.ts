/**
 * @license
 * Copyright 2021 Aglyn LLC
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


export enum Equality {
  STRICT,
  LOOSE,
  DEFAULT = STRICT,
}

export function _isEqualitySameType<T, U extends T>(
  value: T,
  ...possibilities: U[]
): value is U
export function _isEqualitySameType<T, U extends T>(
 value: T,
 possibilities: U[],
 options?: { equality?: 'strict' | 'loose' },
): value is U {
  const {equality = Equality.DEFAULT} = {...options}
  return possibilities.some((possibility) => {
    if (equality === 'loose') {
      // noinspection EqualityComparisonWithCoercionJS
      return possibility == value
    }
    return possibility === value
  })
}
