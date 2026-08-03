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

import { encode } from '@msgpack/msgpack'

/**
 * Pack a value to msgpack bytes.
 *
 * Returns a plain `Uint8Array` and knows NOTHING about Firestore (AGL-1151).
 *
 * It used to return a Firestore `Bytes`, which meant one line —
 * `import { Bytes } from 'firebase/firestore'` — and that line put the entire
 * Firestore client SDK into the `@aglyn/aglyn` barrel. Every published tenant
 * page imports that barrel, so every visitor to every customer site downloaded
 * ~258 KB gzipped (~900 KB parsed) of database client to render static HTML
 * that never queries anything. A VALUE import of one class, for a wrapper
 * around a byte array.
 *
 * The three callers are all editor hooks that already import `Bytes`
 * themselves, so wrapping at the call site costs them nothing and keeps the
 * dependency where it is actually used.
 */
export function compress<T>(value: T): Uint8Array {
  return encode(value)
}
export default compress
