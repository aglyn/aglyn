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

import { Dictionary, Implements, KeyValueMap } from '@aglyn/shared-data-types'
import { CANVAS_ROOT_ELEMENT_ID } from './constants/canvas'
import { SYMBOL_TYPE, TYPE_KIND, TYPE_OF } from './constants/symbol'
import {
  AglynComponentElementDataDenormalized,
  AglynComponentElementDataNormalized,
} from './controllers/aglyn-components.controller'
import type { AglynExtension } from './models/aglyn-extension.model'


export type Payload<T = any> = { payload: T }
export type PayloadData<T extends Dictionary = any> = T
export type PayloadParams<T extends any> = { [K in keyof T]: T[K] }

export type AglynExtensionMap = Map<string, AglynExtension>
export type AglynAppModule<T extends AglynUniqueId = any> = T

export type AglynUniqueId<T extends boolean = false> = T extends boolean
  ? T extends true
    ? { getId(): string }
    : { readonly $id: string }
  : never

export type AglynLoads<K extends string, T extends AglynUniqueId> = Implements<'load',
  K,
  (...data: T[]) => void> &
  Implements<'unload', K, (...data: T[]) => void>

export type AglynRegistersType<K extends string, T extends AglynUniqueId> = Implements<'register',
  '',
  (type: K, data: T) => void> &
  Implements<'unregister', '', (type: K, id: T['$id']) => void>

export type AglynRegisters<K extends string, T1 extends any, T2 extends any = T1> = Implements<'register',
  K,
  (...data: T1[]) => void> &
  Implements<'unregister', K, (...data: T2[]) => void>

export type AglynTypeFields<T extends SYMBOL_TYPE, U extends SYMBOL_TYPE = never> = {
  readonly [TYPE_OF]?: T
  readonly [TYPE_KIND]?: U
}

export interface AglynNamed {
  name?: string
}

/** Observers to handle life cycle onInit/onDestroy events */
export interface AglynLifecycleObserver<T = any> {
  /**
   * Should be invoked once immediately after instantiation
   */
  aglynOnInit?(props?: T): void
  /**
   * Should be invoked once as last step before garbage collection
   */
  aglynOnDestroy?(props?: T): void
}

export interface AglynLoadableObserver<T1 = any, T2 = any> extends AglynLifecycleObserver<T1> {
  /**
   * Should be invoked each time the object is loaded
   */
  aglynOnLoad?(props?: T2): void
  /**
   * Should be invoked each time the object is unloaded
   */
  aglynOnUnload?(props?: T2): void
}

export type AppUUN = string
export type ExtensionUUN = string
export type BundleUId = string
export type ComponentId = string
export type TemplateId = string
export type ElementId = string
export type CommandUId = string
export type ContextStoreUid = string

export type AglynComponentElementDataNormalizedMap = KeyValueMap<ComponentId, AglynComponentElementDataNormalized>
export type AglynComponentElementDataNormalizedArray = AglynComponentElementDataDenormalized<any>[]

export type AglynComponentElementHierarchy<$ID extends ElementId = null> =
  $ID extends ElementId ? (
    | [root: CANVAS_ROOT_ELEMENT_ID, $id: $ID]
    | [root: CANVAS_ROOT_ELEMENT_ID, ...parentIds: ElementId[], $id: $ID]
    ) : [root: CANVAS_ROOT_ELEMENT_ID]


export interface ModificationHistoryState<T> {
  past: [previous?: T, ...more: T[]],
  present: T
  future: [next?: T, ...more: T[]],
}
