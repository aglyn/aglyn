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

/**
 * Shortcut for JSON.stringify(...)
 *
 * @export
 * @return {string}
 * @param data
 */
export function jsonS(data: Parameters<typeof JSON.stringify>[0]): ReturnType<typeof JSON.stringify>
export function jsonS(...args: Parameters<typeof JSON.stringify>): ReturnType<typeof JSON.stringify> {
  return JSON.stringify(...args)
}
