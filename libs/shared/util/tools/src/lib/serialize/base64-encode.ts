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
 * Encode a unicode value to base64 string, safely in BOM and Node
 * @param value - the unicode value to encode to base64
 * @param encoding - character encoding of value param 'utf8'|'utf16'|'unicode'
 */
export function base64Encode(value: string, encoding: BufferEncoding = 'utf8'): string {
  if (typeof window === 'undefined') {
    return Buffer.from(value, encoding).toString('base64')
  }
  return window.btoa(value)
}
export default base64Encode
