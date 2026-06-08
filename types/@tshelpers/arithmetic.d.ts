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

declare global {
  type BuildTuple<L extends number, T extends any[] = []> = T extends {
    length: L
  }
    ? T
    : BuildTuple<L, [...T, any]>

  type Length<T extends any[]> = T extends { length: infer L } ? L : never

  type Add<A extends number, B extends number> = Length<
    [...BuildTuple<A>, ...BuildTuple<B>]
  >

  type Subtract<A extends number, B extends number> = BuildTuple<A> extends [
    ...infer U,
    ...BuildTuple<B>,
  ]
    ? Length<U>
    : never
}

export {}
