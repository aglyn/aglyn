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
  Serializable,
  StringLike,
} from '@aglyn/shared/util/types'
import {
  AglynAppEventFlag,
  AglynCommandFlag,
  AglynErrorEventFlag,
  AglynModuleTriggerFlag,
  AglynSymbol,
} from './constants'
import { Emitter } from 'mitt'
import { Timestamp } from '@aglyn/shared/feature/timestamp'
import { NsErrorFactory } from '@aglyn/shared/util/errors'
import { Logger } from '@aglyn/shared/feature/logger'
import { AglynComponent, AglynComponentOptions } from './extensions/components-type.extension'


export type Payload<T = any> = { payload: T }
export type PayloadData<T extends Dictionary = any> = T

export type AglynAppsMap = Map<string, AglynApp>
export type AglynAppModule<T extends AglynUniqueId = any> = T
export type AglynExtensionMap = Map<string, AglynExtension>
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
  [AglynErrorEventFlag.NO_APP_EXTENSION]: PayloadData<{ extensionId: string }>
  [AglynErrorEventFlag.INVALID_LOG_ARG]: undefined
  [AglynErrorEventFlag.NO_MODULE]: undefined
  [AglynErrorEventFlag.INVALID_MODULE_ARG]: PayloadData<{ moduleName: string, appName: string }>
}
export type AglynAppEventParams = {
  [AglynAppEventFlag.APP_CREATED]: PayloadData<{ app: AglynApp }>
  [AglynAppEventFlag.BEFORE_DELETE_APP]: PayloadData<{ app: AglynApp }>
  [AglynAppEventFlag.APP_LOADED]: PayloadData<{ appName: string }>
  [AglynAppEventFlag.APP_UNLOADED]: PayloadData<{ appName: string }>
  [AglynAppEventFlag.APP_DELETED]: PayloadData<{ appName: string }>
  [AglynAppEventFlag.REGISTERED_EXTENSION]: PayloadData<{ extension: AglynExtension }>
  [AglynAppEventFlag.UNREGISTERED_EXTENSION]: PayloadData<{ extensionId: string }>
  [AglynAppEventFlag.LOADED_EXTENSION]: PayloadData<{ extensionId: string }>
  [AglynAppEventFlag.UNLOADED_EXTENSION]: PayloadData<{ extensionId: string }>
  [AglynAppEventFlag.REGISTERED_COMMAND]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.UNREGISTERED_COMMAND]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.TRIGGERED_COMMAND]: PayloadData<{ commandId: string }>
}
export type AglynModuleTriggerParams = {
  [AglynModuleTriggerFlag.EXTENSION_REGISTER]: PayloadData<{ extension: AglynExtension }>
  [AglynModuleTriggerFlag.EXTENSION_UNREGISTER]: PayloadData<{ extensionId: string }>
  [AglynModuleTriggerFlag.EXTENSION_LOAD]: PayloadData<{ extensionId: string }>
  [AglynModuleTriggerFlag.EXTENSION_UNLOAD]: PayloadData<{ extensionId: string }>
  [AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER]: PayloadData<{ handler: AglynCommandHandler }>
  [AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER]: PayloadData<{ handler: AglynCommandHandler }>
  [AglynModuleTriggerFlag.COMMAND_TRIGGER]: PayloadData<{ commandId: string }>
  [AglynModuleTriggerFlag.EXTENSION_COMPONENT_GET]: PayloadData<{ componentId: string }>
  [AglynModuleTriggerFlag.EXTENSION_COMPONENTS_GET]: undefined
  [AglynModuleTriggerFlag.EXTENSION_COMPONENT_REGISTER]: PayloadData<{ componentId: string, component: AglynComponent, options?: Partial<AglynComponentOptions> }>
  [AglynModuleTriggerFlag.EXTENSION_COMPONENT_UNREGISTER]: PayloadData<{ componentId: string }>
}
export type AglynCommandParams = {
  [P in string | '*' | AglynCommandFlag]: PayloadData<{ app: AglynApp }>
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

export interface AglynBaseModel extends StringLike, Serializable {

}

export interface AglynAppOptions extends AglynNamed {

}

export interface AglynExtensionConfig extends AglynUniqueId {
  autoload?: boolean
}

export interface AglynType<T extends AglynSymbol.TAG_TYPE,
  U extends AglynSymbol.TAG_TYPE = never> {
  readonly [AglynSymbol.TypeOf]?: T
  readonly [AglynSymbol.TypeKind]?: U
}

export interface AglynEffectType<T, U = unknown> extends Payload<U> {
  type: T
}

export interface AglynApp extends AglynBaseModel,
  LifecycleObserver,
  AglynType<typeof AglynSymbol.APP_TYPE> {

  readonly deleted?: boolean
  readonly event: AglynEmitter
  readonly log: AglynLogger
  readonly commands: AglynCommandController
  readonly extensions: AglynExtensionController

  effect(data: AglynEffectType<AglynModuleTriggerFlag>): void
  getCreatedAt(): Timestamp
  getName(): string
  getOptions(): AglynAppOptions
}

export interface AglynModuleController extends AglynBaseModel,
  LifecycleObserver {

}

export interface AglynCommandController extends AglynModuleController,
  AglynRegisters<'action',
    AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER],
    AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER]> {

  executeCommand(data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_TRIGGER]): void
}

export interface AglynCommandHandler extends AglynUniqueId,
  AglynType<typeof AglynSymbol.MODULE_TYPE, typeof AglynSymbol.COMMAND_TYPE> {
  (data: AglynCommandParams['*']): void
}

export interface AglynExtensionController extends AglynModuleController,
  AglynRegisters<'extension',
    AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_REGISTER],
    AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_UNREGISTER]>,
  AglynLoads<'extension', AglynAppModule> {

  getExtension(id: string): AglynExtension
  getExtensions(): AglynExtension[]
  unloadExtensions(): void
}

export interface AglynExtension extends AglynBaseModel,
  LifecycleObserver,
  AglynUniqueId,
  AglynType<typeof AglynSymbol.MODULE_TYPE, typeof AglynSymbol.EXTENSION_TYPE> {
  readonly lifecycle?: LifecycleFlag | null
  readonly config?: AglynExtensionConfig
}
