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

import {_isNull} from './_is-null'
import {_isUndT} from './_is-und-t'


/**
 * Is literal type null or undefined
 *
 * @export
 * @param {*} val
 * @returns {(val is null | undefined)}
 */
export function _isUndOrNull(val: unknown): val is null | undefined {
  return _isNull(val) || _isUndT(val)
}
