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

import EventEmitter from 'events'
import DdfSchema from '@data-driven-forms/react-form-renderer/common-types/schema'
import { VERSION as version } from './version'


export const PRODUCTION = process.env.NODE_ENV === 'production'
export const VERSION = version
export const DEFAULT_ENTRY_NAME = '[DEFAULT]'

export namespace Flag {
  export enum EventFlag {
    INSTANCE_CREATED = 'website:app:created-instance',
    SET_MODULE = 'website:app:set-module',
    SET_COMPONENT = 'website:app:set-component',
  }

  export enum RestrictFlag {
    LIMIT = 'limit',
    DISALLOW = 'disallow',
  }
}

export const _emit: EventEmitter = new EventEmitter()
export const _modules: ModuleMap = new Map()
export const _apps: Map<string, WebApp> = new Map()

export interface WebApp {
  readonly CREATED?: string
}

export interface AppOptions {
  id?: string
}

export function initializeApp(options?: AppOptions) {

}

export type AnyProps = Record<string, unknown>

export interface Module {
  $id?: string
  declarations: Component[]
}

export type ModuleMap = Map<string, Module>

export interface Component<T = unknown> {
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
    restrictChildren?: [type: Flag.RestrictFlag, ids: string[]]
    restrictParents?: [type: Flag.RestrictFlag, ids: string[]]
  }
}

export interface ElementData {
  $id: string
  component?: Component | string
  children?: (ElementData | string)[]
  props: AnyProps
  temporary?: boolean
  parent?: string
  name?: string
  description?: string
}

export class WebApp {
  public static readonly VERSION: string = VERSION
  public static readonly PRODUCTION: boolean = PRODUCTION

  public static event: EventEmitter = new EventEmitter()
  public static modules: ModuleMap = new Map()
  public readonly CREATED = new Date().toUTCString()
  private static instance?: WebApp
  private constructor() {/*empty*/}
  public static getInstance(): WebApp {
    if (this.instance instanceof this) {
      return this.instance
    }
    this.instance = new this()
    this.event.emit(Flag.EventFlag.INSTANCE_CREATED, this, this.instance)
    return this.instance
  }


  public static init(): WebApp {
    return this.getInstance()
  }


  public static setModule(props: { $id: string; declarations: Component[] }) {
    const {$id, declarations} = props
    const module = {$id, declarations}
    this.modules.set($id, module)
    this.event.emit(Flag.EventFlag.SET_MODULE, this, module)
    return this
  }


  public static getComponent(props: { moduleId: string; componentId: string }) {
    const {moduleId, componentId} = props
    return this.modules.get(moduleId)?.declarations.find((m) => m.$id === componentId)
  }


  public static getComponents(props: { moduleId: string; componentId?: string[] }) {
    const {moduleId, componentId} = props
    return componentId
      ? componentId.map(i => this.getComponent({moduleId, componentId: i}))
      : this.modules.get(moduleId)?.declarations
  }


  public static setComponent(props: {
    moduleId: string
    $id: string
    ctor: Component['ctor']
    metadata?: Component['metadata']
  }) {
    const {moduleId, $id, ctor, metadata} = props
    const module = this.modules.get(moduleId) ?? {$id: moduleId, declarations: []}
    let component = module.declarations.find((i) => i.$id === $id)
    if (!component) {
      component = {$id, ctor, metadata}
      module.declarations.push(component)
    } else {
      component.$id = $id
      component.ctor = ctor
      component.metadata = metadata
    }
    this.modules.set(moduleId, module)
    this.event.emit(Flag.EventFlag.SET_COMPONENT, this, module)
    return this
  }
}

export const webApp = WebApp.getInstance()
