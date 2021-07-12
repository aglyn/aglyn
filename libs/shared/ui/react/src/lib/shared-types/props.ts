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

import { ElementType } from 'react'


export type AnyProps = Record<string, unknown>
export type InferElementTypeProps<T> = T extends ElementType<infer P> ? P : never
export type ComponentProp<T extends ElementType = any> = { component?: T } //& InferElementTypeProps<T>

/** Allows conditional typing ype alias */
export type Conditional<X, T, A, B = never> = X extends T ? A : B

/** If X extends true then Y */
export type IF<X, Y> = Conditional<X, true, Y>

/** Plain old dictionary of key(K)-value(T) pairs with string signatures */
export type KV<T = unknown, K extends string = string> = Record<K, T>

/** The index signature type of T */
export type KeyOf<T> = keyof T

/** The index value type of T  */
export type IndexOf<T, K extends KeyOf<T> = KeyOf<T>> = T[K]
