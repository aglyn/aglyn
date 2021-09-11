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

import { EmitterFn } from '@aglyn/shared/feature/emitter'
import { Emitter } from 'mitt'
import {
  AglynAppInstance,
  AglynCommandHandler,
  AglynExtensionInstance,
  PayloadData,
} from './types'
import { Dictionary } from '@aglyn/shared/util/types'


export enum AglynAppEventFlag {
  APP_CREATED = 'event:app-created',
  BEFORE_DELETE_APP = 'event:before-delete-app',
  APP_LOADED = 'event:app-loaded',
  APP_UNLOADED = 'event:app-unloaded',
  APP_DELETED = 'event:app-deleted',
  REGISTERED_EXTENSION = 'event:registered-extension',
  UNREGISTERED_EXTENSION = 'event:unregistered-extension',
  LOADED_EXTENSION = 'event:loaded-extension',
  UNLOADED_EXTENSION = 'event:unloaded-extension',
  REGISTERED_COMMAND = 'event:registered-command',
  UNREGISTERED_COMMAND = 'event:unregistered-command',
  TRIGGERED_COMMAND = 'event:triggered-command',
  SET_COMPONENT = 'event:set-component',
}

export enum AglynModuleEventFlag {
  COMMAND_ACTION_REGISTER = 'module:command:register',
  COMMAND_ACTION_UNREGISTER = 'module:command:unregister',
  COMMAND_TRIGGER = 'module:command:trigger',

  EXTENSION_REGISTER = 'module:extension:register',
  EXTENSION_UNREGISTER = 'module:extension:unregister',
  EXTENSION_LOAD = 'module:extension:load',
  EXTENSION_UNLOAD = 'module:extension:unload',
}

export interface AglynAppEventPayload extends Record<AglynAppEventFlag, AglynEmitterPayload> {
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

export interface AglynModuleEventPayload extends Record<AglynModuleEventFlag, AglynEmitterPayload> {
  [AglynModuleEventFlag.EXTENSION_REGISTER]: PayloadData<{ extension: AglynExtensionInstance }>
  [AglynModuleEventFlag.EXTENSION_UNREGISTER]: PayloadData<{ name: string }>
  [AglynModuleEventFlag.EXTENSION_LOAD]: PayloadData<{ name: string }>
  [AglynModuleEventFlag.EXTENSION_UNLOAD]: PayloadData<{ name: string }>

  [AglynModuleEventFlag.COMMAND_ACTION_REGISTER]: PayloadData<{ handler: AglynCommandHandler }>
  [AglynModuleEventFlag.COMMAND_ACTION_UNREGISTER]: PayloadData<{ handler: AglynCommandHandler }>
  [AglynModuleEventFlag.COMMAND_TRIGGER]: PayloadData<{ commandId: string }>
}

export type AglynEventPayloads = AglynAppEventPayload & AglynModuleEventPayload & Record<string, AglynEmitterPayload>
export type AglynEmitterPayload = PayloadData<Dictionary>
export type AglynEmitter = Emitter<AglynEventPayloads>

export const AGLYN_EMITTER: AglynEmitter = EmitterFn()
