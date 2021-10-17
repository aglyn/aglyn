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

import { Dictionary, Implements } from '@aglyn/shared-data-types'
import { SYMBOL_TYPE, TYPE_KIND, TYPE_OF } from './constants/symbol'
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

export enum AglynLifecycleFlag {
  UNREGISTERED = 0b0000,
  REGISTERED = 0b0010,
  INITIALIZED = 0b0100,
  LOADING = 0b1000,
  LOADED = 0b1010,
  UNLOADED = 0b1100,
  DESTROYED = 0b1110,
}

/** Observers to handle life cycle onInit/onDestroy events */
export interface AglynLifecycleObserver {
  /**
   * Should be invoked once immediately after instantiation
   */
  aglynOnInit?(props?: any): unknown
  /**
   * Should be invoked once as last step before garbage collection
   */
  aglynOnDestroy?(props?: any): unknown
}

export interface AglynLoadableObserver extends AglynLifecycleObserver {
  /**
   * Should be invoked each time the object is loaded
   */
  aglynOnLoad?(props?: any): unknown
  /**
   * Should be invoked each time the object is unloaded
   */
  aglynOnUnload?(props?: any): unknown
}
