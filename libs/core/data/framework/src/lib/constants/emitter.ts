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


import { Dictionary } from '@aglyn/shared-data-types'
import { EmitterFn } from '@aglyn/shared-util-emitter'
import { Emitter } from 'mitt'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynCommandHandler } from '../controllers/aglyn-command.controller'
import {
  BundleId,
  ComponentId,
  IAglynComponentElement,
  IAglynComponentsBundle,
  IAglynComponentSchema,
} from '../controllers/aglyn-components.controller'
import type { AglynExtension } from '../models/aglyn-extension.model'
import { PayloadData } from '../types'


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
}

export enum AglynModuleActionFlag {
  EXTENSION_REGISTER = 'module:extension:register',
  EXTENSION_UNREGISTER = 'module:extension:unregister',
  EXTENSION_LOAD = 'module:extension:load',
  EXTENSION_UNLOAD = 'module:extension:unload',

  COMMAND_ACTION_REGISTER = 'module:command:register',
  COMMAND_ACTION_UNREGISTER = 'module:command:unregister',
  COMMAND_TRIGGER = 'module:command:trigger',

  COMPONENT_GET = 'module:extension:components:get-component',
  COMPONENTS_GET = 'module:extension:components:get-components',
  COMPONENT_REGISTER = 'module:extension:components:register-component',
  COMPONENT_UNREGISTER = 'module:extension:components:unregister-component',
  COMPONENTS_BUNDLE_REGISTER = 'module:extension:components:register-components-bundle',
  COMPONENTS_BUNDLE_UNREGISTER = 'module:extension:components:unregister-components-bundle',
}

export type EventPayload<T, K extends keyof T = keyof T> = Record<K, T[K]>

export type GetComponentPayload = PayloadData<{
  componentId: string
  bundleId?: string
}>
export type GetComponentsPayload = PayloadData<{
  ids?: { componentId: string, bundleId?: string }[]
}>
export type GetComponentSchemaPayload = PayloadData<{
  componentId: string
  bundleId?: string
}>
export type GetBundlePayload = PayloadData<{
  bundleId: string
}>
export type RegisterComponentPayload<P = any> = PayloadData<{
  schema: IAglynComponentSchema<P>
  component: IAglynComponentElement<P>
}>
export type RegisterBundlePayload = PayloadData<{
  bundle: IAglynComponentsBundle
  components: RegisterComponentPayload[]
}>
export type UnregisterComponentPayload = PayloadData<{
  componentId: ComponentId
  bundleId: BundleId
}>
export type UnregisterBundlePayload = PayloadData<{
  bundleId: BundleId
}>

export interface AglynAppEventPayload extends Record<AglynAppEventFlag, AglynEmitterPayload> {
  [AglynAppEventFlag.APP_CREATED]: PayloadData<{ app: AglynAppController }>
  [AglynAppEventFlag.APP_LOADED]: PayloadData<{ app: AglynAppController }>
  [AglynAppEventFlag.APP_UNLOADED]: PayloadData<{ app: AglynAppController }>
  [AglynAppEventFlag.BEFORE_DELETE_APP]: PayloadData<{ app: AglynAppController }>
  [AglynAppEventFlag.APP_DELETED]: PayloadData<{ appName: string }>

  [AglynAppEventFlag.REGISTERED_EXTENSION]: PayloadData<{ name: string }>
  [AglynAppEventFlag.UNREGISTERED_EXTENSION]: PayloadData<{ name: string }>
  [AglynAppEventFlag.LOADED_EXTENSION]: PayloadData<{ extension: AglynExtension }>
  [AglynAppEventFlag.UNLOADED_EXTENSION]: PayloadData<{ extension: AglynExtension }>

  [AglynAppEventFlag.REGISTERED_COMMAND]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.UNREGISTERED_COMMAND]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.TRIGGERED_COMMAND]: PayloadData<{ commandId: string }>
}

export interface AglynModuleActionPayload extends Record<AglynModuleActionFlag, AglynEmitterPayload> {
  [AglynModuleActionFlag.EXTENSION_REGISTER]: PayloadData<{ extension: AglynExtension }>
  [AglynModuleActionFlag.EXTENSION_UNREGISTER]: PayloadData<{ name: string }>
  [AglynModuleActionFlag.EXTENSION_LOAD]: PayloadData<{ name: string }>
  [AglynModuleActionFlag.EXTENSION_UNLOAD]: PayloadData<{ name: string }>

  [AglynModuleActionFlag.COMMAND_ACTION_REGISTER]: PayloadData<{ handler: AglynCommandHandler }>
  [AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER]: PayloadData<{ handler: AglynCommandHandler }>
  [AglynModuleActionFlag.COMMAND_TRIGGER]: PayloadData<{ commandId: string }>

  [AglynModuleActionFlag.COMPONENT_GET]: GetComponentPayload
  [AglynModuleActionFlag.COMPONENTS_GET]: GetComponentsPayload
  [AglynModuleActionFlag.COMPONENT_REGISTER]: UnregisterComponentPayload
  [AglynModuleActionFlag.COMPONENT_UNREGISTER]: UnregisterComponentPayload
  [AglynModuleActionFlag.COMPONENTS_BUNDLE_REGISTER]: RegisterBundlePayload
  [AglynModuleActionFlag.COMPONENTS_BUNDLE_UNREGISTER]: UnregisterBundlePayload
}

export type AglynEventPayloads = EventPayload<AglynAppEventPayload> &
  EventPayload<AglynModuleActionPayload> &
  Record<string, AglynEmitterPayload>
export type AglynEmitterPayload = PayloadData<Dictionary>
export type AglynEmitter = Emitter<AglynEventPayloads>

export const AGLYN_EMITTER: AglynEmitter = EmitterFn()
