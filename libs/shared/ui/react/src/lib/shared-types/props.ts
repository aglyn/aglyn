/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
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
