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


import { AnyProps, Dictionary } from '@aglyn/shared-data-types'
import { StyledElement } from '@aglyn/shared-feature-themes'
import { EmitterFn } from '@aglyn/shared-util-emitter'
import { Emitter } from 'mitt'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynCommandHandler, AglynCommandResolver } from '../controllers/aglyn-command.controller'
import {
  AglynComponentElement,
  AglynComponentsBundle,
  AglynComponentSchema,
  BundleId,
  ComponentId,
} from '../controllers/aglyn-components.controller'
import type { AglynExtension } from '../models/aglyn-extension.model'
import { PayloadData } from '../types'


export enum AglynAppEventFlag {
  APP_CREATED = 'event:app-created',
  APP_PRE_INIT = 'event:app-pre-init',
  APP_INITIALIZED = 'event:app-initialized',
  APP_PRE_DESTROY = 'event:app-pre-destroy',
  APP_DESTROYED = 'event:app-destroyed',
  BEFORE_DELETE_APP = 'event:before-delete-app',
  APP_DELETED = 'event:app-deleted',

  REGISTERED_EXTENSION = 'event:registered-extension',
  UNREGISTERED_EXTENSION = 'event:unregistered-extension',
  LOADED_EXTENSION = 'event:loaded-extension',
  UNLOADED_EXTENSION = 'event:unloaded-extension',

  TRIGGERED_COMMAND_RESOLVER = 'event:trigger-command-resolver',
  REGISTERED_COMMAND_RESOLVER = 'event:registered-command-resolver',
  UNREGISTERED_COMMAND_RESOLVER = 'event:unregistered-command-resolver',
  TRIGGERED_COMMAND_LISTENER = 'event:triggered-command-listener',
  REGISTERED_COMMAND_LISTENER = 'event:registered-command-listener',
  UNREGISTERED_COMMAND_LISTENER = 'event:unregistered-command-listener',

  REGISTERED_COMPONENT = 'event:registered-component',
  UNREGISTERED_COMPONENT = 'event:unregistered-component',
  REGISTERED_COMPONENT_BUNDLE = 'event:registered-component-bundle',
  UNREGISTERED_COMPONENT_BUNDLE = 'event:unregistered-component-bundle',
}

export enum AglynModuleActionFlag {
  EXTENSION_REGISTER = 'module:extension:register',
  EXTENSION_UNREGISTER = 'module:extension:unregister',
  EXTENSION_LOAD = 'module:extension:load',
  EXTENSION_UNLOAD = 'module:extension:unload',

  COMMAND_ACTION_REGISTER_RESOLVER = 'module:command:register-resolver',
  COMMAND_ACTION_UNREGISTER_RESOLVER = 'module:command:unregister-resolver',
  COMMAND_ACTION_REGISTER_LISTENER = 'module:command:register-listener',
  COMMAND_ACTION_UNREGISTER_LISTENER = 'module:command:unregister-listener',
  COMMAND_TRIGGER = 'module:command:trigger',

  COMPONENT_GET = 'module:components:get-component',
  COMPONENTS_GET = 'module:components:get-components',
  COMPONENT_REGISTER = 'module:components:register-component',
  COMPONENT_UNREGISTER = 'module:components:unregister-component',
  COMPONENTS_BUNDLE_REGISTER = 'module:components:register-components-bundle',
  COMPONENTS_BUNDLE_UNREGISTER = 'module:components:unregister-components-bundle',
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
export type RegisterComponentPayload<P extends AnyProps = any> = PayloadData<{
  schema: AglynComponentSchema<P>
  component: AglynComponentElement<P>
}>
export type RegisterBundlePayload = PayloadData<{
  bundle: Omit<AglynComponentsBundle, 'componentIds'>
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
  [AglynAppEventFlag.APP_PRE_INIT]: PayloadData<{ app: AglynAppController }>
  [AglynAppEventFlag.APP_INITIALIZED]: PayloadData<{ app: AglynAppController }>
  [AglynAppEventFlag.APP_PRE_DESTROY]: PayloadData<{ app: AglynAppController }>
  [AglynAppEventFlag.APP_DESTROYED]: PayloadData<{ app: AglynAppController }>
  [AglynAppEventFlag.BEFORE_DELETE_APP]: PayloadData<{ app: AglynAppController }>
  [AglynAppEventFlag.APP_DELETED]: PayloadData<{ appName: string }>

  [AglynAppEventFlag.REGISTERED_EXTENSION]: PayloadData<{ name: string }>
  [AglynAppEventFlag.UNREGISTERED_EXTENSION]: PayloadData<{ name: string }>
  [AglynAppEventFlag.LOADED_EXTENSION]: PayloadData<{ extension: AglynExtension }>
  [AglynAppEventFlag.UNLOADED_EXTENSION]: PayloadData<{ extension: AglynExtension }>

  [AglynAppEventFlag.TRIGGERED_COMMAND_RESOLVER]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.REGISTERED_COMMAND_RESOLVER]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.UNREGISTERED_COMMAND_RESOLVER]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.TRIGGERED_COMMAND_LISTENER]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.REGISTERED_COMMAND_LISTENER]: PayloadData<{ commandId: string }>
  [AglynAppEventFlag.UNREGISTERED_COMMAND_LISTENER]: PayloadData<{ commandId: string }>

  [AglynAppEventFlag.REGISTERED_COMPONENT]: PayloadData<{ componentId: ComponentId, bundleId?: BundleId }>
  [AglynAppEventFlag.UNREGISTERED_COMPONENT]: PayloadData<{ componentId: ComponentId, bundleId?: BundleId }>
  [AglynAppEventFlag.REGISTERED_COMPONENT_BUNDLE]: PayloadData<{ bundleId: BundleId }>
  [AglynAppEventFlag.UNREGISTERED_COMPONENT_BUNDLE]: PayloadData<{ bundleId: BundleId }>
}

export interface AglynModuleActionPayload extends Record<AglynModuleActionFlag, AglynEmitterPayload> {
  [AglynModuleActionFlag.EXTENSION_REGISTER]: PayloadData<{ extension: AglynExtension }>
  [AglynModuleActionFlag.EXTENSION_UNREGISTER]: PayloadData<{ name: string }>
  [AglynModuleActionFlag.EXTENSION_LOAD]: PayloadData<{ name: string }>
  [AglynModuleActionFlag.EXTENSION_UNLOAD]: PayloadData<{ name: string }>

  [AglynModuleActionFlag.COMMAND_ACTION_REGISTER_RESOLVER]: PayloadData<{ handler: AglynCommandResolver }>
  [AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER_RESOLVER]: PayloadData<{ handler: AglynCommandResolver }>
  [AglynModuleActionFlag.COMMAND_ACTION_REGISTER_LISTENER]: PayloadData<{ handler: AglynCommandHandler }>
  [AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER_LISTENER]: PayloadData<{ handler: AglynCommandHandler }>
  [AglynModuleActionFlag.COMMAND_TRIGGER]: PayloadData<{ commandId: string } & Dictionary>

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
