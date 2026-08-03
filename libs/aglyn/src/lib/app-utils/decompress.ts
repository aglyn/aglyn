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

/**
 * Either form the bytes arrive in: a Firestore `Bytes` (client SDK) or a bare
 * view (AGL-1223). The Admin SDK materialises a bytes field as a Node
 * `Buffer`, which has no `toUint8Array`, so server readers had to hand-roll an
 * adapter — and the obvious adapter is wrong (see below).
 */
export type CompressedValue = ByteSource | ArrayBufferView

function toBytes(value: CompressedValue): Uint8Array {
  if (ArrayBuffer.isView(value)) {
    // Offset and length, ALWAYS. firebase-admin hands back POOLED Buffers —
    // a 156-byte field is typically a view at some offset into a shared 8 KB
    // ArrayBuffer — so `new Uint8Array(value.buffer)` decodes the whole pool
    // and throws on the trailing garbage instead of returning the document.
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  return value.toUint8Array()
}

export function decompress<T>(value: CompressedValue): T {
  return decode(toBytes(value)) as T
}
export default decompress
