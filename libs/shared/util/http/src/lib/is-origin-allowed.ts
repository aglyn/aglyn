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

import type {StaticOrigin} from './types'


export function isOriginAllowed(origin: string, allowed: StaticOrigin): boolean {
  return Array.isArray(allowed)
    ? allowed.some((o) => isOriginAllowed(origin, o))
    : typeof allowed === 'string'
      ? origin === allowed
      : allowed instanceof RegExp
        ? allowed.test(origin)
        : !!allowed
}

export default isOriginAllowed
