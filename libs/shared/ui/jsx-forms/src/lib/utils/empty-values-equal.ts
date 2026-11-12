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

/**
 * Whether two values of a text-like field are the same to the person looking
 * at it (AGL-4047): an empty box is an empty box, whether final-form holds it
 * as `undefined` (its default parse of `''`, and the renderer's clearedValue
 * for an emptied field), `null`, or the `''` a stored copy seeds back.
 *
 * final-form's own compare is `===`, so a field cleared and saved stayed
 * dirty against the `''` its stored copy reseeded, and the card kept saying
 * "Update" over a form that held exactly what was stored. Anything else is
 * still compared with `===`, the default it replaces.
 */
export function emptyValuesEqual(a: unknown, b: unknown): boolean {
  return a === b || (isEmptyValue(a) && isEmptyValue(b))
}

const isEmptyValue = (value: unknown): boolean => value === undefined || value === null || value === ''

export default emptyValuesEqual
