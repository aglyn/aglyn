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
import {
  AglynAppEventFlag,
  AglynCommandFlag,
  AglynExtension,
  AglynModuleTriggerFlag,
} from './constants'
import { Emitter } from 'mitt'
import { Timestamp } from '@aglyn/shared/feature/timestamp'
import { NsErrorFactory } from '@aglyn/shared/util/errors'
import { Logger } from '@aglyn/shared/feature/logger'
import {
  AglynComponent,
  AglynComponentOptions,
} from './models/extensions/components-types.extension'
import {
  APP_TYPE,
  COMMAND_TYPE,
  EXTENSION_TYPE,
  MODULE_TYPE,
  TAG_TYPE,
  TypeKind,
  TypeOf,
} from './aglyn-symbol'
import { AglynErrorEventFlag } from './error'
import { Platform } from '@aglyn/shared/util/helpers'


export type Payload<T = any> = { payload: T }
export type PayloadData<T extends Dictionary = any> = T

export type AglynPlatform = Platform
export type AglynVersion = string
export type AglynAppsMap = Map<string, AglynAppInstance>
export type AglynExtensionsControllersMap = Map<string, AglynExtensionControllerInstance>
export type AglynCommandsControllersMap = Map<string, AglynCommandControllerInstance>
export type AglynExtensionMap = Map<string, AglynExtensionInstance>
export type AglynAppModule<T extends AglynUniqueId = any> = T
export type AglynEmitterParams = AglynAppEventParams & AglynModuleTriggerParams
export type AglynEmitter = Emitter<AglynEmitterParams>
export type AglynError = NsErrorFactory<AglynErrorEventFlag, AglynErrorEventParams>
export type AglynLogger = Logger
export type AglynCommander = Emitter<AglynCommandParams>

export type AglynErrorEventParams = {
  [AglynErrorEventFlag.NO_APP]: PayloadData<{ appName: string }>
  [AglynErrorEventFlag.BAD_APP_NAME]: PayloadData<{ appName: string }>
  [AglynErrorEventFlag.DUPLICATE_APP]: PayloadData<{ appName: string }>
  [AglynErrorEventFlag.APP_DELETED]: PayloadData<{ appName: string }>
  [AglynErrorEventFlag.INVALID_APP_ARG]: PayloadData<{ appName: string }>
  [AglynErrorEventFlag.NO_APP_EXTENSION]: PayloadData<{ name: string }>
  [AglynErrorEventFlag.INVALID_LOG_ARG]: undefined
  [AglynErrorEventFlag.NO_MODULE]: undefined
  [AglynErrorEventFlag.INVALID_MODULE_ARG]: PayloadData<{ moduleName: string, appName: string }>
}
export type AglynAppEventParams = {
  [AglynAppEventFlag.APP_CREATED]: PayloadData<{ app: AglynAppInstance }>
  [AglynAppEventFlag.BEFORE_DELETE_APP]: PayloadData<{ app: AglynAppInstance }>
  [AglynAppEventFlag.APP_LOADED]: PayloadData<{ appName: string }>
  [AglynAppEventFlag.APP_UNLOADED]: PayloadData<{ appName: string }>
  [AglynAppEventFlag.APP_DELETED]: PayloadData<{ appName: string }>
  [AglynAppEventFlag.REGISTERED_EXTENSION]: PayloadData<{ extension: AglynExtensionInstance }>
  [AglynAppEventFlag.UNREGISTERED_EXTENSION]: PayloadData<{ name: string }>
  [AglynAppEventFlag.LOADED_EXTENSION]: PayloadData<{ name: string }>
  [AglynAppEventFlag.UNLOADED_EXTENSION]: PayloadData<{ name: string }>
  [AglynAppEventFlag.REGISTERED_COMMAND]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.UNREGISTERED_COMMAND]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.TRIGGERED_COMMAND]: PayloadData<{ commandId: string }>
}
export type AglynModuleTriggerParams = {
  [AglynModuleTriggerFlag.EXTENSION_REGISTER]: PayloadData<{ extension: AglynExtensionInstance }>
  [AglynModuleTriggerFlag.EXTENSION_UNREGISTER]: PayloadData<{ name: string }>
  [AglynModuleTriggerFlag.EXTENSION_LOAD]: PayloadData<{ name: string }>
  [AglynModuleTriggerFlag.EXTENSION_UNLOAD]: PayloadData<{ name: string }>
  [AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER]: PayloadData<{ handler: AglynCommandHandler }>
  [AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER]: PayloadData<{ handler: AglynCommandHandler }>
  [AglynModuleTriggerFlag.COMMAND_TRIGGER]: PayloadData<{ commandId: string }>
  [AglynModuleTriggerFlag.EXTENSION_COMPONENT_GET]: PayloadData<{ componentId: string }>
  [AglynModuleTriggerFlag.EXTENSION_COMPONENTS_GET]: undefined
  [AglynModuleTriggerFlag.EXTENSION_COMPONENT_REGISTER]: PayloadData<{ componentId: string, component: AglynComponent, options?: Partial<AglynComponentOptions> }>
  [AglynModuleTriggerFlag.EXTENSION_COMPONENT_UNREGISTER]: PayloadData<{ componentId: string }>
}
export type AglynCommandParams = {
  [P in string | '*' | AglynCommandFlag]: PayloadData<{ app: AglynAppInstance }>
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

export interface AglynType<T extends TAG_TYPE,
  U extends TAG_TYPE = never> {
  readonly [TypeOf]?: T
  readonly [TypeKind]?: U
}

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

export interface AglynAppInstance extends AglynBaseModelInstance,
  AglynType<typeof APP_TYPE> {

  getName(): string
  getOptions(): AglynAppOptions
  getDeleted(): boolean
  setDeleted(deleted: boolean): void
  getCommandsController(): AglynCommandControllerInstance
  getExtensionsController(): AglynExtensionControllerInstance

  effect(data: AglynEffectType<AglynModuleTriggerFlag>): void
}

export interface AglynCommandControllerInstance extends AglynBaseModelInstance,
  AglynRegisters<'action',
    AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER],
    AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER]> {

  executeCommand(data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_TRIGGER]): void
}

export interface AglynCommandHandler extends AglynUniqueId,
  AglynType<typeof MODULE_TYPE, typeof COMMAND_TYPE> {
  (data: AglynCommandParams['*']): void
}

export interface AglynExtensionControllerInstance extends AglynBaseModelInstance,
  AglynRegisters<'extension',
    AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_REGISTER],
    AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_UNREGISTER]>,
  AglynLoads<'extension', AglynAppModule> {

  getExtensionByName(name: string): AglynExtensionInstance
  getAllExtensions(): AglynExtensionInstance[]
  unloadAllExtensions(): void
}

export interface AglynExtensionInstance<T = any> extends AglynBaseModelInstance,
  LoadableObserver,
  AglynType<typeof MODULE_TYPE, typeof EXTENSION_TYPE> {
  readonly lifecycle?: LifecycleFlag | null
  getName(): string
  getOptions(): AglynExtensionOptions
  getContext(): T
  setContext(value: T): this
}
