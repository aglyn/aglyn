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

import { unserialize as unserializeFromByteStream, isSerialized as isSerializedByteStream } from 'php-serialize'


/**
 * Generates a string with **_byte-stream_** representation of a value.
 *
 * **Note:**
 * that this is a binary string which may include null bytes, and needs to be
 * stored and handled as such. For example, serialize() output should generally
 * be stored in a BLOB field in a database, rather than a CHAR or TEXT field.
 *
 * @see {@link serializeToByteStream}
 * @see {@link serializeToJson}
 * @see {@link https://github.com/steelbrain/php-serialize PHP Serializer}
 *
 * ---
 *
 * @example

 export function unserialize(
 item: string,
 scope: Object = {},
 options: { strict: boolean, encoding: 'utf8' | 'binary' } = { strict: false, encoding: 'utf8' }
 ): any

 *
 * @example

 class User {
  constructor({ name, age }) {
    this.name = name
    this.age = age
  }
  serialize() {
    return JSON.stringify({ name: this.name, age: this.age })
  }
  unserialize(rawData) {
    const { name, age } = JSON.parse(rawData)
    this.name = name
    this.age = age
  }
 }
 const steel = new User({ name: 'Steel Brain', age: 17 })


 // Serialize to byte stream string
 const serialized = serializeToByteStream(steel)

 // Passing available classes and byte stream string
 const unserialized = unserializeFromByteStream(serialized, { User: User })

 * @example

 // Result: unserialized
 unserialized instanceof User = true

 *
 * @inheritDoc
 */
export { unserializeFromByteStream, isSerializedByteStream }
export default unserializeFromByteStream
