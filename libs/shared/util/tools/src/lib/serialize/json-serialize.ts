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

/**
 * Generates a string with **_JSON_** representation of a value
 *
 * @see {@link jsonDeserialize}
 * @see {@link JSON.parse}
 * @see {@link JSON.stringify}
 */
export function jsonSerialize(...args: Parameters<typeof JSON.stringify>): ReturnType<typeof JSON.stringify> {
  return JSON.stringify(...args)
}
export default jsonSerialize
