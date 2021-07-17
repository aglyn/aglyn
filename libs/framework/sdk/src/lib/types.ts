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

import type EventEmitter from 'events'
import type DdfSchema from '@data-driven-forms/react-form-renderer/common-types/schema'
import { RestrictFlag } from './constants/flag'
import { AnyProps } from '@aglyn/shared/util/types'


export type AppsMap = Map<string, WebApp>
export type AppExtMap = Map<string, AppExt>
export type EventListener<T = unknown> = (...args: T[]) => void
export type EventName = string | symbol

export interface WebApp {
  readonly mitt: EventEmitter
  readonly extensions: AppExtMap
  readonly created: string
  readonly name: string
  readonly options: AppOptions
}

export interface AppOptions {
  name?: string
}

export interface AppExt {
  $id?: string
  components: AppComponent[]
}

export interface AppComponent<T = unknown> {
  $id: string
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
    restrictChildren?: [type: RestrictFlag, ids: string[]]
    restrictParents?: [type: RestrictFlag, ids: string[]]
  }
}

export interface ElementData {
  $id: string
  component?: AppComponent | string
  children?: (ElementData | string)[]
  props: AnyProps
  temporary?: boolean
  parent?: string
  name?: string
  description?: string
}
