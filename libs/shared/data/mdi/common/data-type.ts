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

export type Key = string

export namespace Normal {
  export type KeyList<K extends keyof any = string> = K[]
  export type KeysFromList<List> = List extends KeyList<infer K> ? K : never
  export type Keys<K = Key> = K extends KeyList ? KeysFromList<K> : K extends Key ? K : never

  export type Lookup<T, K extends keyof any = Key> = Record<K, T>
  export type Values<T> = T extends Lookup<infer U> ? U : never
}
