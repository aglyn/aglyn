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
export type ComponentProp<T extends ElementType = any> = { component?: T } & InferElementTypeProps<T>
