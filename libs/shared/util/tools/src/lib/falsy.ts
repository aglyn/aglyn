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

import truthy from './truthy'


export type FalsyParams = unknown[]

/**
 * Shortcut for checking multiple falsy values e.g., `!Boolean(i of val)`
 * @returns return true unless any value is truthy otherwise returns false
 */
export function falsy(...val: FalsyParams): boolean {
  return !truthy(...val)
}
export default falsy
