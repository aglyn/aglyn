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

export enum Equality {
  STRICT = 'strict',
  LOOSE = 'loose',
  DEFAULT = STRICT,
}

export function _isEqualitySameType<T, U extends T>(
  value: T,
  options: { truthiness?: Equality } | null,
  ...possibilities: U[]
): value is U {
  for (const possibility of possibilities) {
    if (options?.truthiness === Equality.LOOSE) {
      // noinspection EqualityComparisonWithCoercionJS
      if (possibility == value) return true
    } else if (possibility === value) return true
  }
  return false
}
export default _isEqualitySameType
