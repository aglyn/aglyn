/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import DdfSchema from '@data-driven-forms/react-form-renderer/common-types/schema'
import type { RestrictType } from '../const'


export type AnyProps = Record<string, unknown>

export interface Module {
  _id?: string
  declarations: Component[]
}

export interface Component<T = unknown> {
  _id: string
  ctor: T
  metadata: {
    displayName?: string
    description?: string
    title?: string
    subtitle?: string
    icon?: any
    propsSchema?: DdfSchema
    defaultProps?: Partial<AnyProps>
    resolveProps?: <T>(...args: T[]) => Partial<AnyProps> | void
    disableActions?: boolean
    disableBadge?: boolean
    disableCopying?: boolean
    disableDragging?: boolean
    disableDropping?: boolean
    disableEditing?: boolean
    disableNesting?: boolean
    disableOutline?: boolean
    disableRemoving?: boolean
    disableSelecting?: boolean
    restrictChildren?: [type: RestrictType, ids: string[]]
    restrictParents?: [type: RestrictType, ids: string[]]
  }
}

export interface Element {
  _id: string
  component?: Component | string
  children?: Element[]
  props: AnyProps
  temp?: boolean
  parent?: string
  name?: string
  description?: string
}

export type ModulesMap = Map<string, Module>

export function core() {
  return 'core'
}
