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
import { EmitterFn } from '@aglyn/shared-util-emitter'
import type {
  createEffect as createEffectorEffect,
  createEvent as createEffectorEvent,
} from 'effector'
import { Emitter } from 'mitt'
import {
  AglynCommandListener,
  AglynCommandResolver,
} from '../controllers/aglyn-commands.controller'
import {
  AglynComponentElement,
  AglynComponentsBundle,
  AglynComponentSchema,
  AppUUN,
  BundleUId,
  CommandUId,
  ComponentId,
  ContextStoreUid,
  ExtensionUUN,
} from '../controllers/aglyn-components.controller'
import { ContextStore, ContextStoreOptions } from '../controllers/aglyn-contexts.controller'
import type { AglynExtension } from '../models/aglyn-extension.model'
import { PayloadData } from '../types'


export enum AglynAppEventFlag {
  APP_CREATING = 'event:app:creating', // 1
  APP_CREATED = 'event:app:created', // 2
  APP_INITIALIZING = 'event:app:initializing', // 3
  APP_INITIALIZING_MODULE = 'event:app:initializing-module', // 4
  APP_INITIALIZED_MODULE = 'event:app:initialized-module', // 5
  APP_INITIALIZED = 'event:app:initialized', // 6
  APP_DESTROYING = 'event:app:destroying', // 7
  APP_DESTROYING_MODULE = 'event:app:destroying-module', // 8
  APP_DESTROYED_MODULE = 'event:app:destroyed-module', // 9
  APP_DESTROYED = 'event:app:destroyed', // 10
  APP_DELETING = 'event:app:deleting', // 11
  APP_DELETED = 'event:app:deleted', // 12

  EXTENSION_REGISTERED = 'event:extensions:registered-extension',
  EXTENSION_INITIALIZED = 'event:extensions:initialized-extension',
  EXTENSION_LOADING = 'event:extensions:loading-extension',
  EXTENSION_LOADED = 'event:extensions:loaded-extension',
  EXTENSION_UNLOADING = 'event:extensions:unloading-extension',
  EXTENSION_UNLOADED = 'event:extensions:unloaded-extension',
  EXTENSION_DESTROYING = 'event:extensions:destroying-extension',
  EXTENSION_DESTROYED = 'event:extensions:destroyed-extension',

  COMMAND_REGISTERED_RESOLVER = 'event:commands:registered-resolver',
  COMMAND_REGISTERED_LISTENER = 'event:commands:registered-listener',
  COMMAND_UNREGISTERED_RESOLVER = 'event:commands:unregistered-resolver',
  COMMAND_UNREGISTERED_LISTENER = 'event:commands:unregistered-listener',
  COMMAND_TRIGGERED_RESOLVER = 'event:commands:triggered-resolver',
  COMMAND_TRIGGERED_LISTENER = 'event:commands:triggered-listener',

  COMPONENT_REGISTERING = 'event:components:registering-component',
  COMPONENT_REGISTERED = 'event:components:registered-component',
  COMPONENT_UNREGISTERING = 'event:components:unregistering-component',
  COMPONENT_UNREGISTERED = 'event:components:unregistered-component',
  COMPONENT_BUNDLE_REGISTERING = 'event:components:registering-bundle',
  COMPONENT_BUNDLE_REGISTERED = 'event:components:registered-bundle',
  COMPONENT_BUNDLE_UNREGISTERING = 'event:components:unregistering-bundle',
  COMPONENT_BUNDLE_UNREGISTERED = 'event:components:unregistered-bundle',
}

export interface AglynAppEventPayload extends Record<AglynAppEventFlag, AglynEmitterPayload> {
  [AglynAppEventFlag.APP_CREATING]: PayloadData<{ appName: AppUUN }>
  [AglynAppEventFlag.APP_CREATED]: PayloadData<{ appName: AppUUN }>
  [AglynAppEventFlag.APP_INITIALIZING]: PayloadData<{ appName: AppUUN }>
  [AglynAppEventFlag.APP_INITIALIZING_MODULE]: PayloadData<{ moduleName: string }>
  [AglynAppEventFlag.APP_INITIALIZED_MODULE]: PayloadData<{ moduleName: string }>
  [AglynAppEventFlag.APP_INITIALIZED]: PayloadData<{ appName: AppUUN }>
  [AglynAppEventFlag.APP_DESTROYING]: PayloadData<{ appName: AppUUN }>
  [AglynAppEventFlag.APP_DESTROYING_MODULE]: PayloadData<{ moduleName: string }>
  [AglynAppEventFlag.APP_DESTROYED_MODULE]: PayloadData<{ moduleName: string }>
  [AglynAppEventFlag.APP_DESTROYED]: PayloadData<{ appName: AppUUN }>
  [AglynAppEventFlag.APP_DELETING]: PayloadData<{ appName: AppUUN }>
  [AglynAppEventFlag.APP_DELETED]: PayloadData<{ appName: AppUUN }>

  [AglynAppEventFlag.EXTENSION_REGISTERED]: PayloadData<{ extensionName: ExtensionUUN }>
  [AglynAppEventFlag.EXTENSION_INITIALIZED]: PayloadData<{ extensionName: ExtensionUUN }>
  [AglynAppEventFlag.EXTENSION_LOADING]: PayloadData<{ extensionName: ExtensionUUN }>
  [AglynAppEventFlag.EXTENSION_LOADED]: PayloadData<{ extensionName: ExtensionUUN }>
  [AglynAppEventFlag.EXTENSION_UNLOADING]: PayloadData<{ extensionName: ExtensionUUN }>
  [AglynAppEventFlag.EXTENSION_UNLOADED]: PayloadData<{ extensionName: ExtensionUUN }>
  [AglynAppEventFlag.EXTENSION_DESTROYING]: PayloadData<{ extensionName: ExtensionUUN }>
  [AglynAppEventFlag.EXTENSION_DESTROYED]: PayloadData<{ extensionName: ExtensionUUN }>

  [AglynAppEventFlag.COMMAND_TRIGGERED_RESOLVER]: PayloadData<{ commandId: CommandUId }>
  [AglynAppEventFlag.COMMAND_REGISTERED_RESOLVER]: PayloadData<{ commandId: CommandUId }>
  [AglynAppEventFlag.COMMAND_UNREGISTERED_RESOLVER]: PayloadData<{ commandId: CommandUId }>
  [AglynAppEventFlag.COMMAND_TRIGGERED_LISTENER]: PayloadData<{ commandId: CommandUId }>
  [AglynAppEventFlag.COMMAND_REGISTERED_LISTENER]: PayloadData<{ commandId: CommandUId }>
  [AglynAppEventFlag.COMMAND_UNREGISTERED_LISTENER]: PayloadData<{ commandId: CommandUId }>

  [AglynAppEventFlag.COMPONENT_REGISTERING]: PayloadData<{ componentId: ComponentId, bundleId?: BundleUId }>
  [AglynAppEventFlag.COMPONENT_REGISTERED]: PayloadData<{ componentId: ComponentId, bundleId?: BundleUId }>
  [AglynAppEventFlag.COMPONENT_UNREGISTERING]: PayloadData<{ componentId: ComponentId, bundleId?: BundleUId }>
  [AglynAppEventFlag.COMPONENT_UNREGISTERED]: PayloadData<{ componentId: ComponentId, bundleId?: BundleUId }>
  [AglynAppEventFlag.COMPONENT_BUNDLE_REGISTERING]: PayloadData<{ bundleId: BundleUId }>
  [AglynAppEventFlag.COMPONENT_BUNDLE_REGISTERED]: PayloadData<{ bundleId: BundleUId }>
  [AglynAppEventFlag.COMPONENT_BUNDLE_UNREGISTERING]: PayloadData<{ bundleId: BundleUId }>
  [AglynAppEventFlag.COMPONENT_BUNDLE_UNREGISTERED]: PayloadData<{ bundleId: BundleUId }>
}

export enum AglynAppEffectFlag {
  EXTENSION_REGISTER = 'effect:extension:register',
  EXTENSION_LOAD = 'effect:extension:load',
  EXTENSION_UNLOAD = 'effect:extension:unload',
  EXTENSION_DESTROY = 'effect:extension:destroy',

  CONTEXTS_CREATE_STORE = 'effect:contexts:create-store',
  CONTEXTS_CREATE_EVENT = 'effect:contexts:create-event',
  CONTEXTS_CREATE_EFFECT = 'effect:contexts:create-effect',
  CONTEXTS_GET_STORE = 'effect:contexts:get-store',
  CONTEXTS_SET_STORE = 'effect:contexts:set-store',
  CONTEXTS_DELETE_STORE = 'effect:contexts:delete-store',

  COMMAND_ACTION_REGISTER_RESOLVER = 'effect:command:register-resolver',
  COMMAND_ACTION_UNREGISTER_RESOLVER = 'effect:command:unregister-resolver',
  COMMAND_ACTION_REGISTER_LISTENER = 'effect:command:register-listener',
  COMMAND_ACTION_UNREGISTER_LISTENER = 'effect:command:unregister-listener',
  COMMAND_TRIGGER = 'effect:command:trigger',

  COMPONENT_GET = 'effect:components:get-component',
  COMPONENT_SCHEMA_GET = 'effect:components:get-component-schema',
  COMPONENTS_GET = 'effect:components:get-components',
  COMPONENTS_BUNDLE_GET = 'effect:components:get-components-bundle',
  COMPONENT_REGISTER = 'effect:components:register-component',
  COMPONENT_UNREGISTER = 'effect:components:unregister-component',
  COMPONENTS_BUNDLE_REGISTER = 'effect:components:register-components-bundle',
  COMPONENTS_BUNDLE_UNREGISTER = 'effect:components:unregister-components-bundle',
}

export type ExtensionRegisterPayload = PayloadData<{ extension: AglynExtension }>
export type ExtensionDestroyPayload = PayloadData<{ extensionName: ExtensionUUN }>
export type ExtensionLoadPayload = PayloadData<{ extensionName: ExtensionUUN }>
export type ExtensionUnloadPayload = PayloadData<{ extensionName: ExtensionUUN }>

export type CreateEventOptions = { options: Parameters<typeof createEffectorEvent> }
export type CreateEffectOptions = { options: Parameters<typeof createEffectorEffect> }
export type ContextsCreateStorePayload<T = any> = PayloadData<{ defaultState: T, options?: ContextStoreOptions<T> }>
export type ContextsCreateEventPayload = PayloadData<CreateEventOptions>
export type ContextsCreateEffectPayload = PayloadData<CreateEffectOptions>
export type ContextsGetStorePayload = PayloadData<{ storeId: ContextStoreUid }>
export type ContextsSetStorePayload<T = any> = PayloadData<{ storeId: ContextStoreUid, store: ContextStore<T> }>
export type ContextsDeleteStorePayload = PayloadData<{ storeId: ContextStoreUid }>

export type ComponentGetPayload = PayloadData<{ componentId: CommandUId, bundleId?: BundleUId }>
export type ComponentsGetPayload = PayloadData<{ ids?: { componentId: CommandUId, bundleId?: BundleUId }[] }>
export type ComponentSchemaGetPayload = PayloadData<{ componentId: CommandUId, bundleId?: BundleUId }>
export type ComponentsBundleGetPayload = PayloadData<{ bundleId: BundleUId }>
export type ComponentRegisterPayload<P extends AnyProps = any> = PayloadData<{ schema: AglynComponentSchema<P>, component: AglynComponentElement<P> }>
export type ComponentUnregisterPayload = PayloadData<{ componentId: ComponentId, bundleId: BundleUId }>
export type ComponentsBundleRegisterPayload = PayloadData<{ bundle: Omit<AglynComponentsBundle, 'componentIds'>, components: ComponentRegisterPayload[] }>
export type ComponentsBundleUnregisterPayload = PayloadData<{ bundleId: BundleUId }>

export type CommandRegisterResolver = PayloadData<{ commandId?: CommandUId, resolver: AglynCommandResolver }>
export type CommandUnregisterResolver = PayloadData<{ commandId: CommandUId }>
export type CommandRegisterListener = PayloadData<{ commandId?: CommandUId, listener: AglynCommandListener }>
export type CommandUnregisterListener = PayloadData<{ commandId?: CommandUId, listener: AglynCommandListener }>
export type CommandTriggerPayload = PayloadData<{ commandId: CommandUId } & Dictionary>

export interface AglynModuleEffectPayload extends Record<AglynAppEffectFlag, AglynEmitterPayload> {
  [AglynAppEffectFlag.EXTENSION_REGISTER]: ExtensionRegisterPayload
  [AglynAppEffectFlag.EXTENSION_DESTROY]: ExtensionDestroyPayload
  [AglynAppEffectFlag.EXTENSION_LOAD]: ExtensionLoadPayload
  [AglynAppEffectFlag.EXTENSION_UNLOAD]: ExtensionUnloadPayload

  [AglynAppEffectFlag.CONTEXTS_CREATE_STORE]: ContextsCreateStorePayload
  [AglynAppEffectFlag.CONTEXTS_CREATE_EVENT]: ContextsCreateEventPayload
  [AglynAppEffectFlag.CONTEXTS_CREATE_EFFECT]: ContextsCreateEffectPayload
  [AglynAppEffectFlag.CONTEXTS_GET_STORE]: ContextsGetStorePayload
  [AglynAppEffectFlag.CONTEXTS_SET_STORE]: ContextsSetStorePayload
  [AglynAppEffectFlag.CONTEXTS_DELETE_STORE]: ContextsDeleteStorePayload

  [AglynAppEffectFlag.COMMAND_ACTION_REGISTER_RESOLVER]: CommandRegisterResolver
  [AglynAppEffectFlag.COMMAND_ACTION_UNREGISTER_RESOLVER]: CommandUnregisterResolver
  [AglynAppEffectFlag.COMMAND_ACTION_REGISTER_LISTENER]: CommandRegisterListener
  [AglynAppEffectFlag.COMMAND_ACTION_UNREGISTER_LISTENER]: CommandUnregisterListener
  [AglynAppEffectFlag.COMMAND_TRIGGER]: CommandTriggerPayload

  [AglynAppEffectFlag.COMPONENT_GET]: ComponentGetPayload
  [AglynAppEffectFlag.COMPONENT_SCHEMA_GET]: ComponentSchemaGetPayload
  [AglynAppEffectFlag.COMPONENTS_GET]: ComponentsGetPayload
  [AglynAppEffectFlag.COMPONENTS_BUNDLE_GET]: ComponentsBundleGetPayload
  [AglynAppEffectFlag.COMPONENT_REGISTER]: ComponentUnregisterPayload
  [AglynAppEffectFlag.COMPONENT_UNREGISTER]: ComponentUnregisterPayload
  [AglynAppEffectFlag.COMPONENTS_BUNDLE_REGISTER]: ComponentsBundleRegisterPayload
  [AglynAppEffectFlag.COMPONENTS_BUNDLE_UNREGISTER]: ComponentsBundleUnregisterPayload
}

export type EventPayload<T, K extends keyof T = keyof T> = Record<K, T[K]>
export type AglynEventPayloads = EventPayload<AglynAppEventPayload> &
  EventPayload<AglynModuleEffectPayload> &
  Record<string, AglynEmitterPayload>
export type AglynEmitterPayload = PayloadData<Dictionary>
export type AglynEmitter = Emitter<AglynEventPayloads>

export const AGLYN_EMITTER: AglynEmitter = EmitterFn()
