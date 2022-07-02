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

/** Tuple with exactly two elements */
export interface Tuple<T1, T2 = T1> extends Array<T1 | T2> {
  0: T1
  1: T2
  length: 2 // using the numeric literal type '2'
}

/** Tuple with a guaranteed minimum of one (1) item */
export interface TupleMin1<T> extends Array<T> {
  0: T
}

/** Tuple with a guaranteed minimum of two (2) items */
export interface TupleMin2<T1, T2 = T1> extends TupleMin1<T1 | T2> {
  1: T2
}
