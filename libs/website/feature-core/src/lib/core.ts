/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import DdfSchema from '@data-driven-forms/react-form-renderer/common-types/schema'
import EventEmitter from 'events'
import { RestrictType, } from '../const'
import { App } from './app'


export type AnyProps = Record<string, unknown>
export type ClassOrFunction = ((...args: unknown[])=>unknown) | (new (...args: unknown[])=>unknown)

export interface Component {
  _id: string
  Component?: ClassOrFunction | any
  name: string
  description?: string
  title?: string
  subtitle?: string
  icon?: any
  defaultProps?: Partial<AnyProps>
  propsSchema?: DdfSchema
  resolveProps?: <T>(...args: T[]) => Partial<AnyProps> | void
  options?: {
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

export class ComponentController {
  constructor(public readonly model: Component, protected readonly app: App) {

  }
}

export const eventEmitter: EventEmitter = new EventEmitter()
export const components: Map<string, ComponentController> = new Map()

export function core() {
  return 'core'
}
