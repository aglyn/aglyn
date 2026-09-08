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

import { urlAlphabet as urlSafe } from 'nanoid'
import {
  alphanumeric,
  lowercase,
  nolookalikes,
  nolookalikesSafe,
  numbers,
  uppercase,
} from 'nanoid-dictionary'

export type UidAlphabetDictionary = {
  alphanumeric: string
  lowercase: string
  nolookalikes: string
  nolookalikesSafe: string
  numbers: string
  uppercase: string
  urlSafe: string
}

/**
 * The alphabets `createUidWithAlphabet` can be pointed at — `nolookalikes` and
 * `nolookalikesSafe` in particular, for codes a human has to read back.
 *
 * Kept out of the `@aglyn/shared-util-vendor` index deliberately (AGL-2682):
 * `nanoid-dictionary` is a second package on top of the `nanoid` that
 * `unique-identification` already carries, and re-exporting it from the index
 * put it in front of every file that takes anything at all from that index —
 * which on the tenant is every published customer page. Import it by subpath.
 */
export const UidAlphabets: UidAlphabetDictionary = {
  alphanumeric,
  lowercase,
  nolookalikes,
  nolookalikesSafe,
  numbers,
  uppercase,
  urlSafe,
}
