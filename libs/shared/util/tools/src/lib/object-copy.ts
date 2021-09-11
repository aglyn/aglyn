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

import { PKey } from '@aglyn/shared/util/types'


/**
 * Shallow copy iterable properties in iterable or array
 * @param {Record<PKey, T>} target
 * @returns {Record<PKey, T>}
 */
export function objectCopy<T>(target: Record<PKey, T>): typeof target {
  return {...target}
}
