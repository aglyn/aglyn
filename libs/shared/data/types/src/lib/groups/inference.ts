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

import {type Dictionary, type IndexOf, type KeyOf} from './basic'


export type Bool = boolean
export type Bytes = Uint8Array | string
export type TimestampSeconds = number
export type Float = number
export type Int32 = number
export type Int64 = number
export type Null = null
export type Text = string
export type Coordinates = Record<'longitude' | 'latitude', number>
export type Mapped<T = any> = Dictionary<T>
export type Sorted<T = any> = T extends any[] ? never : T[]
export type Nestable<T = any> = Mapped<T> | Sorted<T>

export type DataTypeFlags = {
  'bool': 0x1
  0x1: 'bool'
  'bytes': 0x2
  0x2: 'bytes'
  'coordinates': 0x3
  0x3: 'coordinates'
  'float': 0x4
  0x4: 'float'
  'int32': 0x5
  0x5: 'int32'
  'int64': 0x6
  0x6: 'int64'
  'mapped': 0x7
  0x7: 'mapped'
  'nil': 0x8
  0x8: 'nil'
  'sorted': 0x9
  0x9: 'sorted'
  'text': 0xA
  0xA: 'text'
  'timestamp': 0xB
  0xB: 'timestamp'
}

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

/** Match Type from Tag symbol */
export type DataTypeInferred<Kind extends IndexOf<DataTypeFlags> | KeyOf<DataTypeFlags>> =
  Kind extends DataTypeFlags['bool'] ? Bool
    : Kind extends 'bool' ? DataTypeFlags['bool']
      : Kind extends DataTypeFlags['bytes'] ? Uint8Array
        : Kind extends 'bytes' ? DataTypeFlags['bytes']
          : Kind extends DataTypeFlags['timestamp'] ? TimestampSeconds
            : Kind extends 'timestamp' ? DataTypeFlags['timestamp']
              : Kind extends DataTypeFlags['float'] ? Float
                : Kind extends 'float' ? DataTypeFlags['float']
                  : Kind extends DataTypeFlags['int32'] ? Int32
                    : Kind extends 'int32' ? DataTypeFlags['int32']
                      : Kind extends DataTypeFlags['int64'] ? Int64
                        : Kind extends 'int64' ? DataTypeFlags['int64']
                          : Kind extends DataTypeFlags['nil'] ? Null
                            : Kind extends 'nil' ? DataTypeFlags['nil']
                              : Kind extends DataTypeFlags['text'] ? Text
                                : Kind extends 'text' ? DataTypeFlags['text']
                                  : Kind extends DataTypeFlags['coordinates'] ? Coordinates
                                    : Kind extends 'coordinates' ? DataTypeFlags['coordinates']
                                      : Kind extends DataTypeFlags['mapped'] ? Mapped<InferValueTypeAny>
                                        : Kind extends 'mapped' ? DataTypeFlags['mapped']
                                          : Kind extends DataTypeFlags['sorted'] ? Sorted<InferValueTypeAny>
                                            : Kind extends 'sorted' ? DataTypeFlags['sorted']
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
