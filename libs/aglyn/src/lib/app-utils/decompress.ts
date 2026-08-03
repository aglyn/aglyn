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

import { decode } from '@msgpack/msgpack'

/**
 * The shape this needs, rather than the class it usually gets (AGL-1151).
 *
 * A structural type keeps `firebase/firestore` out of this module entirely.
 * The import here was type-only and therefore erased — it cost nothing — but
 * naming the shape says what is actually required and stops the next person
 * reaching for the class again.
 */
export interface ByteSource {
  toUint8Array(): Uint8Array
}

export function decompress<T>(value: ByteSource): T {
  return decode(value.toUint8Array()) as T
}
export default decompress
