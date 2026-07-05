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

export type DataTypeFlag = {
  bool: 0x1
  [0x1]: 'bool'

  bytes: 0x2
  [0x2]: 'bytes'

  coordinates: 0x3
  [0x3]: 'coordinates'

  float: 0x4
  [0x4]: 'float'

  int32: 0x5
  [0x5]: 'int32'

  int64: 0x6
  [0x6]: 'int64'

  number: 0x7
  [0x7]: 'number'

  mapped: 0x8
  [0x8]: 'mapped'

  nil: 0x9
  [0x9]: 'nil'

  sorted: 10
  [0xa]: 'sorted'

  text: 0xb
  [0xb]: 'text'

  timestamp: 0xc
  [0xc]: 'timestamp'
}

/* private */
type KeyOf<T> = keyof T
export type IndexOf<T, K extends KeyOf<T> = KeyOf<T>> = T[K]

/* Value data types, support same as Firestore */
export type Bool = boolean
export type Bytes = Uint8Array | string
export type TimestampSeconds = number
export type Float = number
export type Int32 = number
export type Int64 = number
export type Number = Float | Int32 | Int64
export type Null = null
export type Text = string
export type Coordinates = Record<'longitude' | 'latitude', number>
export type Mapped<T = any, K extends string | symbol = string> = Record<K, T>
export type Sorted<T = any> = T extends any[] ? never : T[]
export type Nestable<T = any> = Mapped<T> | Sorted<T>

/**
 * Any value data type of those seen above
 */
export type InferValueTypeAny<T extends InferValueTypeAny = any> =
  | Bool
  | Bytes
  | Coordinates
  | Float
  | Int32
  | Int64
  | Mapped<T>
  | Null
  | Sorted<Exclude<T, Sorted>>
  | Text
  | TimestampSeconds

/**
 * Match Type from Tag symbol
 */
// prettier-ignore
export type DataTypeInferred<Kind extends IndexOf<DataTypeFlag> | KeyOf<DataTypeFlag>> =
  Kind extends DataTypeFlag['bool'] ? Bool
    : Kind extends 'bool' ? DataTypeFlag['bool']
      : Kind extends DataTypeFlag['bytes'] ? Uint8Array
        : Kind extends 'bytes' ? DataTypeFlag['bytes']
          : Kind extends DataTypeFlag['timestamp'] ? TimestampSeconds
            : Kind extends 'timestamp' ? DataTypeFlag['timestamp']
              : Kind extends DataTypeFlag['float'] ? Float
                : Kind extends 'float' ? DataTypeFlag['float']
                  : Kind extends DataTypeFlag['int32'] ? Int32
                    : Kind extends 'int32' ? DataTypeFlag['int32']
                      : Kind extends DataTypeFlag['int64'] ? Int64
                        : Kind extends 'int64' ? DataTypeFlag['int64']
                          : Kind extends DataTypeFlag['number'] ? Int64
                            : Kind extends 'number' ? DataTypeFlag['number']
                              : Kind extends DataTypeFlag['nil'] ? Null
                                : Kind extends 'nil' ? DataTypeFlag['nil']
                                  : Kind extends DataTypeFlag['text'] ? Text
                                    : Kind extends 'text' ? DataTypeFlag['text']
                                      : Kind extends DataTypeFlag['coordinates'] ? Coordinates
                                        : Kind extends 'coordinates' ? DataTypeFlag['coordinates']
                                          : Kind extends DataTypeFlag['mapped'] ? Mapped<InferValueTypeAny>
                                            : Kind extends 'mapped' ? DataTypeFlag['mapped']
                                              : Kind extends DataTypeFlag['sorted'] ? Sorted<InferValueTypeAny>
                                                : Kind extends 'sorted' ? DataTypeFlag['sorted']
                                                  : never

// export enum DataTypeFlag {
//   BOOL = 0x1,
//   BYTES = 0x2,
//   COORDINATES = 0x3,
//   FLOAT = 0x4,
//   INT32 = 0x5,
//   INT64 = 0x6,
//   MAPPED = 0x7,
//   NIL = 0x8,
//   SORTED = 0x9,
//   TEXT = 0xA,
//   TIMESTAMP = 0xB,
// }

// export const DataTypeFlagToString: Record<DataTypeFlag, DataTypeStringValue> = {
//   [DataTypeFlag.BOOL]: 'bool',
//   [DataTypeFlag.BYTES]: 'bytes',
//   [DataTypeFlag.TIMESTAMP]: 'timestamp',
//   [DataTypeFlag.FLOAT]: 'float',
//   [DataTypeFlag.INT32]: 'int32',
//   [DataTypeFlag.INT64]: 'int64',
//   [DataTypeFlag.NIL]: 'nil',
//   [DataTypeFlag.TEXT]: 'text',
//   [DataTypeFlag.COORDINATES]: 'coordinates',
//   [DataTypeFlag.MAPPED]: 'mapped',
//   [DataTypeFlag.SORTED]: 'sorted',
// }
//
// export const DataTypeStringToFlag: Record<DataTypeStringValue, DataTypeFlag> = {
//   'bool': DataTypeFlag.BOOL,
//   'bytes': DataTypeFlag.BYTES,
//   'timestamp': DataTypeFlag.TIMESTAMP,
//   'float': DataTypeFlag.FLOAT,
//   'int32': DataTypeFlag.INT32,
//   'int64': DataTypeFlag.INT64,
//   'nil': DataTypeFlag.NIL,
//   'text': DataTypeFlag.TEXT,
//   'coordinates': DataTypeFlag.COORDINATES,
//   'mapped': DataTypeFlag.MAPPED,
//   'sorted': DataTypeFlag.SORTED,
// }
