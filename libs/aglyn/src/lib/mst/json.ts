/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { type IAnyType, types as t } from 'mobx-state-tree'

export const JsonPrimitive = t.union<
  // prettier-ignore
  undefined,
  undefined,
  undefined,
  // prettier-ignore
  null,
  null,
  null,
  // prettier-ignore
  string,
  string,
  string,
  // prettier-ignore
  number,
  number,
  number,
  // prettier-ignore
  number,
  number,
  number,
  // prettier-ignore
  number | Date,
  number,
  Date,
  // prettier-ignore
  boolean,
  boolean,
  boolean
>(t.undefined, t.null, t.string, t.number, t.integer, t.Date, t.boolean)
export const JsonMap = t.map(
  t.union(
    JsonPrimitive,
    t.late((): IAnyType => JsonMap),
    t.late((): IAnyType => JsonList),
  ),
)
export const JsonList = t.array(t.union(JsonPrimitive, JsonMap))
export const AnyJsonValue = t.union(JsonPrimitive, JsonMap, JsonList)
export const AnyJsonObject = t.union(JsonMap, JsonList)
