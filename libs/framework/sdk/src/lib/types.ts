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

import {
  Dictionary,
  Implements,
  LifecycleFlag,
  LifecycleObserver,
  LoadableObserver,
  Serializable,
  StringLike,
} from '@aglyn/shared/util/types'
import { AglynCommandFlag, AglynExtension } from './constants'
import { Emitter } from 'mitt'
import { Timestamp } from '@aglyn/shared/feature/timestamp'
import { Logger } from '@aglyn/shared/feature/logger'
import {
  APP_TYPE,
  COMMAND_TYPE,
  EXTENSION_TYPE,
  MODULE_TYPE,
  SYMBOL_TYPE,
  TYPE_KIND,
  TYPE_OF,
} from './symbol'
import { AglynError } from './error'
import { Platform } from '@aglyn/shared/util/helpers'
import { AglynEmitter, AglynModuleEventFlag, AglynModuleEventPayload } from './emitter'


export type Payload<T = any> = { payload: T }
export type PayloadData<T extends Dictionary = any> = T
export type PayloadParams<T extends any> = { [K in keyof T]: T[K] }

export type AglynPlatform = Platform
export type AglynVersion = string
export type AglynAppsMap = Map<string, AglynAppInstance>
export type AglynExtensionsControllersMap = Map<string, AglynExtensionControllerInstance>
export type AglynCommandsControllersMap = Map<string, AglynCommandControllerInstance>
export type AglynExtensionMap = Map<string, AglynExtensionInstance>
export type AglynAppModule<T extends AglynUniqueId = any> = T
export type AglynLogger = Logger
export type AglynCommander = Emitter<AglynCommandParams>

export type AglynCommandParams = {
  [P in string | '*' | keyof AglynCommandFlag]: PayloadData<{ app: AglynAppInstance }>
}

export type AglynUniqueId<T extends boolean = false> = T extends boolean
  ? T extends true
    ? { getId(): string }
    : { readonly $id?: string }
  : never

export interface AglynNamed {
  name?: string
}

export type AglynLoads<K extends string, T extends AglynUniqueId> =
  Implements<'load', K, (...data: T[]) => void> &
  Implements<'unload', K, (...data: T[]) => void>

export type AglynRegistersType<K extends string, T extends AglynUniqueId> =
  Implements<'register', '', (type: K, data: T) => void> &
  Implements<'unregister', '', (type: K, id: T['$id']) => void>

export type AglynRegisters<K extends string, T1 extends any, T2 extends any = T1> =
  Implements<'register', K, (...data: T1[]) => void> &
  Implements<'unregister', K, (...data: (T2)[]) => void>

export type AglynTypeFields<T extends SYMBOL_TYPE, U extends SYMBOL_TYPE = never> = {
  readonly [TYPE_OF]?: T
  readonly [TYPE_KIND]?: U
}

export type AglynAppTypeFields = AglynTypeFields<typeof APP_TYPE>
export type AglynCommandTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMMAND_TYPE>
export type AglynExtensionTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof EXTENSION_TYPE>

export interface AglynEffectType<T, U = unknown> extends Payload<U> {
  type: T
}

export type AglynAppOptions = AglynNamed & {
  extensions?: Record<AglynExtension, boolean>
}
export type AglynExtensionOptions = {
  autoload?: boolean
}

export interface AglynBaseModelInstance extends StringLike, Serializable, LifecycleObserver {
  getCreatedAt(): Timestamp
  getErrorFactory(): AglynError
  setErrorFactory(value: AglynError): this
  getEmitter(): AglynEmitter
  setEmitter(value: AglynEmitter): this
  getLogger(): AglynLogger
  setLogger(value: AglynLogger): this
}

export interface AglynAppInstance extends AglynBaseModelInstance, AglynAppTypeFields {
  getName(): string
  getOptions(): AglynAppOptions
  getDeleted(): boolean
  setDeleted(deleted: boolean): void
  getCommandsController(): AglynCommandControllerInstance
  getExtensionsController(): AglynExtensionControllerInstance

  effect(data: AglynEffectType<AglynModuleEventFlag>): void
}

export interface AglynCommandControllerInstance extends AglynBaseModelInstance,
  AglynRegisters<'action',
    AglynModuleEventPayload[AglynModuleEventFlag.COMMAND_ACTION_REGISTER],
    AglynModuleEventPayload[AglynModuleEventFlag.COMMAND_ACTION_UNREGISTER]> {

  executeCommand(data: AglynModuleEventPayload[AglynModuleEventFlag.COMMAND_TRIGGER]): void
}

export interface AglynCommandHandler extends AglynUniqueId, AglynCommandTypeFields {
  (data: AglynCommandParams['*']): void
}

export interface AglynExtensionControllerInstance extends AglynBaseModelInstance,
  AglynRegisters<'extension',
    AglynModuleEventPayload[AglynModuleEventFlag.EXTENSION_REGISTER],
    AglynModuleEventPayload[AglynModuleEventFlag.EXTENSION_UNREGISTER]>,
  AglynLoads<'extension', AglynAppModule> {

  getExtensionByName(name: string): AglynExtensionInstance
  getAllExtensions(): AglynExtensionInstance[]
  unloadAllExtensions(): void
}

export interface AglynExtensionInstance<T = any> extends AglynBaseModelInstance,
  LoadableObserver,
  AglynExtensionTypeFields {
  readonly lifecycle?: LifecycleFlag | null
  getName(): string
  getOptions(): AglynExtensionOptions
  getContext(): T
  setContext(value: T): this
}
