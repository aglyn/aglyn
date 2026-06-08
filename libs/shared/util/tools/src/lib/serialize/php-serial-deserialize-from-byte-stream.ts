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

import {unserialize as phpSerialDeserializeFromByteStream} from 'php-serialize'


/**
 * Generates a string with **_byte-stream_** representation of a value.
 *
 * **Note:**
 * that this is a binary string which may include null bytes, and needs to be
 * stored and handled as such. For example, serialize() output should generally
 * be stored in a BLOB field in a database, rather than a CHAR or TEXT field.
 *
 * ---
 *
 * @example
 * export function serialize(
 *    item: any,
 *    phpToJsScope: Object = {},
 *    options: { encoding: 'utf8' | 'binary' } = { encoding: 'utf8' }
 *  ): string
 *
 * @example
 * class User {
 *   constructor({ name, age }) {
 *     this.name = name
 *     this.age = age
 *   }
 *   serialize() {
 *     return JSON.stringify({ name: this.name, age: this.age })
 *   }
 *   unserialize(rawData) {
 *     const { name, age } = JSON.parse(rawData)
 *     this.name = name
 *     this.age = age
 *   }
 *  }
 *  const steel = new User({ name: 'Steel Brain', age: 17 })
 *
 *
 *  // Serialize to byte stream string
 *  const serialized = serializeToByteStream(steel)
 *
 *  // Serialize User class to given name
 *  const serializedForNamespace = serializeToByteStream(steel, {
 *   'MyApp\\User': User,
 *  })
 *
 * @example
 * // Result: serialized
 *  "C:4:\"User\":31:{{\"name\":\"Steel Brain\",\"age\":17}}"
 *
 *  // Result: serializedForNamespace
 *  "C:10:\"MyApp\\User\":31:{{\"name\":\"Steel Brain\",\"age\":17}}"
 *
 * @example
 * // Result: unserialized
 * unserialized instanceof User = true
 *
 * @see {@link phpSerialIsSerialized}
 * @see {@link phpSerialSerialize}
 * @see {@link https://github.com/steelbrain/php-serialize|PHP Serializer}
 */
export {phpSerialDeserializeFromByteStream}
export default phpSerialDeserializeFromByteStream
