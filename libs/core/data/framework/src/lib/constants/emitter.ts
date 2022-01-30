/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {type AnyProps, type Dictionary, RequiredPickAlt} from '@aglyn/shared-data-types'
import {EmitterFn} from '@aglyn/shared-util-emitter'
import {
  type createEffect as createEffectorEffect,
  type createEvent as createEffectorEvent,
} from 'effector'

import {type AppUUN} from '../types/aglyn-app.types'
import {
  type AglynCommandListener,
  type AglynCommandResolver,
  type CommandUId,
} from '../types/aglyn-commands.types'
import {
  type AglynComponentsBundle,
  type AglynComponentSchema,
  type BundleUId,
  type ComponentId,
  type IAglynComponent,
} from '../types/aglyn-components.types'
import {
  type ContextStore,
  type ContextStoreOptions,
  type ContextStoreUid,
} from '../types/aglyn-contexts.types'
import {
  type AglynElementDenormalized,
  type AglynElementNormalized,
  type AglynElementsById,
  type ElementId,
} from '../types/aglyn-elements.types'
import {type AglynExtensionOptions, type IAglynExtension} from '../types/aglyn-extension.types'
import {type AglynExtensionLoader, type ExtensionUUN} from '../types/aglyn-extensions.types'
import {type PayloadData} from '../types/generic.types'


export enum AglynAppEventFlag {
  APP_CREATING = 'event:app:creating', // 1
  APP_CREATED = 'event:app:created', // 2
  APP_INITIALIZING = 'event:app:initializing', // 3
  APP_INITIALIZED = 'event:app:initialized', // 6
  APP_DESTROYING = 'event:app:destroying', // 7
  APP_DESTROYED = 'event:app:destroyed', // 10
  APP_DELETING = 'event:app:deleting', // 11
  APP_DELETED = 'event:app:deleted', // 12

  APP_MODULE_INITIALIZING = 'event:module:initializing', // 4
  APP_MODULE_INITIALIZED = 'event:module:initialized', // 5
  APP_MODULE_DESTROYING = 'event:module:destroying', // 8
  APP_MODULE_DESTROYED = 'event:module:destroyed', // 9

  EXTENSION_REGISTERED = 'event:extensions:registered-extension',
  EXTENSION_INITIALIZING = 'event:extensions:initializing-extension',
  EXTENSION_INITIALIZED = 'event:extensions:initialized-extension',
  EXTENSION_LOADING = 'event:extensions:loading-extension',
  EXTENSION_LOADED = 'event:extensions:loaded-extension',
  EXTENSION_UNLOADING = 'event:extensions:unloading-extension',
  EXTENSION_UNLOADED = 'event:extensions:unloaded-extension',
  EXTENSION_DESTROYING = 'event:extensions:destroying-extension',
  EXTENSION_DESTROYED = 'event:extensions:destroyed-extension',

  COMMAND_RESOLVER_SET = 'event:commands:set-resolver',
  COMMAND_LISTENER_REGISTERED = 'event:commands:registered-listener',
  COMMAND_RESOLVER_REMOVED = 'event:commands:unregistered-resolver',
  COMMAND_LISTENER_UNREGISTERED = 'event:commands:unregistered-listener',
  COMMAND_RESOLVER_TRIGGERING = 'event:commands:triggering-resolver',
  COMMAND_RESOLVER_TRIGGERED = 'event:commands:triggered-resolver',
  COMMAND_LISTENERS_TRIGGERING = 'event:commands:triggering-listeners',
  COMMAND_LISTENERS_TRIGGERED = 'event:commands:triggered-listeners',

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
  [AglynAppEventFlag.APP_CREATING]: PayloadData<{appName: AppUUN}>
  [AglynAppEventFlag.APP_CREATED]: PayloadData<{appName: AppUUN}>
  [AglynAppEventFlag.APP_INITIALIZING]: PayloadData<{appName: AppUUN}>
  [AglynAppEventFlag.APP_MODULE_INITIALIZING]: PayloadData<{namespace: string}>
  [AglynAppEventFlag.APP_MODULE_INITIALIZED]: PayloadData<{namespace: string}>
  [AglynAppEventFlag.APP_INITIALIZED]: PayloadData<{appName: AppUUN}>
  [AglynAppEventFlag.APP_DESTROYING]: PayloadData<{appName: AppUUN}>
  [AglynAppEventFlag.APP_MODULE_DESTROYING]: PayloadData<{namespace: string}>
  [AglynAppEventFlag.APP_MODULE_DESTROYED]: PayloadData<{namespace: string}>
  [AglynAppEventFlag.APP_DESTROYED]: PayloadData<{appName: AppUUN}>
  [AglynAppEventFlag.APP_DELETING]: PayloadData<{appName: AppUUN}>
  [AglynAppEventFlag.APP_DELETED]: PayloadData<{appName: AppUUN}>

  [AglynAppEventFlag.EXTENSION_REGISTERED]: PayloadData<{extensionName: ExtensionUUN}>
  [AglynAppEventFlag.EXTENSION_INITIALIZING]: PayloadData<{extensionName: ExtensionUUN}>
  [AglynAppEventFlag.EXTENSION_INITIALIZED]: PayloadData<{extensionName: ExtensionUUN}>
  [AglynAppEventFlag.EXTENSION_LOADING]: PayloadData<{extensionName: ExtensionUUN}>
  [AglynAppEventFlag.EXTENSION_LOADED]: PayloadData<{extensionName: ExtensionUUN}>
  [AglynAppEventFlag.EXTENSION_UNLOADING]: PayloadData<{extensionName: ExtensionUUN}>
  [AglynAppEventFlag.EXTENSION_UNLOADED]: PayloadData<{extensionName: ExtensionUUN}>
  [AglynAppEventFlag.EXTENSION_DESTROYING]: PayloadData<{extensionName: ExtensionUUN}>
  [AglynAppEventFlag.EXTENSION_DESTROYED]: PayloadData<{extensionName: ExtensionUUN}>

  [AglynAppEventFlag.COMMAND_RESOLVER_TRIGGERING]: PayloadData<{commandId: CommandUId}>
  [AglynAppEventFlag.COMMAND_RESOLVER_TRIGGERED]: PayloadData<{commandId: CommandUId}>
  [AglynAppEventFlag.COMMAND_RESOLVER_SET]: PayloadData<{commandId: CommandUId}>
  [AglynAppEventFlag.COMMAND_RESOLVER_REMOVED]: PayloadData<{commandId: CommandUId}>
  [AglynAppEventFlag.COMMAND_LISTENERS_TRIGGERING]: PayloadData<{commandId: CommandUId}>
  [AglynAppEventFlag.COMMAND_LISTENERS_TRIGGERED]: PayloadData<{commandId: CommandUId}>
  [AglynAppEventFlag.COMMAND_LISTENER_REGISTERED]: PayloadData<{commandId: CommandUId}>
  [AglynAppEventFlag.COMMAND_LISTENER_UNREGISTERED]: PayloadData<{commandId: CommandUId}>

  [AglynAppEventFlag.COMPONENT_REGISTERING]: PayloadData<{componentId: ComponentId, bundleId?: BundleUId}>
  [AglynAppEventFlag.COMPONENT_REGISTERED]: PayloadData<{componentId: ComponentId, bundleId?: BundleUId}>
  [AglynAppEventFlag.COMPONENT_UNREGISTERING]: PayloadData<{componentId: ComponentId, bundleId?: BundleUId}>
  [AglynAppEventFlag.COMPONENT_UNREGISTERED]: PayloadData<{componentId: ComponentId, bundleId?: BundleUId}>
  [AglynAppEventFlag.COMPONENT_BUNDLE_REGISTERING]: PayloadData<{bundleId: BundleUId}>
  [AglynAppEventFlag.COMPONENT_BUNDLE_REGISTERED]: PayloadData<{bundleId: BundleUId}>
  [AglynAppEventFlag.COMPONENT_BUNDLE_UNREGISTERING]: PayloadData<{bundleId: BundleUId}>
  [AglynAppEventFlag.COMPONENT_BUNDLE_UNREGISTERED]: PayloadData<{bundleId: BundleUId}>
}

export enum AglynAppEffectFlag {
  EXTENSION_REGISTER = 'effect:extension:register',
  EXTENSION_INITIALIZE = 'effect:extension:initialize',
  EXTENSION_LOAD = 'effect:extension:load',
  EXTENSION_UNLOAD = 'effect:extension:unload',
  EXTENSION_DESTROY = 'effect:extension:destroy',

  CONTEXTS_CREATE_STORE = 'effect:contexts:create-store',
  CONTEXTS_CREATE_EVENT = 'effect:contexts:create-event',
  CONTEXTS_CREATE_EFFECT = 'effect:contexts:create-effect',
  CONTEXTS_GET_STORE = 'effect:contexts:get-store',
  CONTEXTS_GET_STORE_API = 'effect:contexts:get-store-api',
  CONTEXTS_SET_STORE = 'effect:contexts:set-store',
  CONTEXTS_DELETE_STORE = 'effect:contexts:delete-store',

  COMMANDS_RESOLVER_SET = 'effect:commands:register-resolver',
  COMMANDS_RESOLVER_REMOVE = 'effect:commands:unregister-resolver',
  COMMANDS_LISTENER_REGISTER = 'effect:commands:register-listener',
  COMMANDS_LISTENER_UNREGISTER = 'effect:commands:unregister-listener',
  COMMANDS_TRIGGER = 'effect:commands:trigger',

  COMPONENT_GET = 'effect:components:get-component',
  COMPONENT_SCHEMA_GET = 'effect:components:get-component-schema',
  COMPONENTS_GET = 'effect:components:get-components',
  COMPONENTS_BUNDLE_GET = 'effect:components:get-components-bundle',
  COMPONENT_REGISTER = 'effect:components:register-component',
  COMPONENT_UNREGISTER = 'effect:components:unregister-component',
  COMPONENTS_BUNDLE_REGISTER = 'effect:components:register-components-bundle',
  COMPONENTS_BUNDLE_UNREGISTER = 'effect:components:unregister-components-bundle',
}

export type ExtensionHandleLoaderPayload = PayloadData<{loader: AglynExtensionLoader, options?: Partial<AglynExtensionOptions>}>
export type ExtensionRegisterPayload = PayloadData<{extension: IAglynExtension}>
export type ExtensionInitializePayload = PayloadData<{extension: IAglynExtension}>
export type ExtensionDestroyPayload = PayloadData<{extensionName: ExtensionUUN}>
export type ExtensionLoadPayload = PayloadData<{extensionName: ExtensionUUN}>
export type ExtensionUnloadPayload = PayloadData<{extensionName: ExtensionUUN}>

export type ContextsCreateStorePayload<T = any> = PayloadData<{defaultState: T, options?: ContextStoreOptions<T>}>
export type ContextsCreateEventPayload = PayloadData<{options: Parameters<typeof createEffectorEvent>}>
export type ContextsCreateEffectPayload = PayloadData<{options: Parameters<typeof createEffectorEffect>}>
export type ContextsGetStorePayload = PayloadData<{storeId: ContextStoreUid}>
export type ContextsGetStoreApiPayload = PayloadData<{storeId: ContextStoreUid}>
export type ContextsSetStorePayload<T = any> = PayloadData<{storeId: ContextStoreUid, store: ContextStore<T> | any}>
export type ContextsDeleteStorePayload = PayloadData<{storeId: ContextStoreUid}>

export type ComponentGetPayload = PayloadData<{componentId: ComponentId, bundleId?: BundleUId}>
export type ComponentsGetPayload = PayloadData<{ids?: {componentId: ComponentId, bundleId?: BundleUId}[]}>
export type ComponentSchemaGetPayload = PayloadData<{componentId: ComponentId, bundleId?: BundleUId}>
export type ComponentsBundleGetPayload = PayloadData<{bundleId: BundleUId}>
export type ComponentRegisterPayload<P extends AnyProps = any> = PayloadData<{schema: AglynComponentSchema<P>, component: IAglynComponent<P>}>
export type ComponentUnregisterPayload = PayloadData<{componentId: ComponentId, bundleId: BundleUId}>
export type ComponentsBundleRegisterPayload = PayloadData<{bundle: Omit<AglynComponentsBundle, 'componentIds'>, components: ComponentRegisterPayload[]}>
export type ComponentsBundleUnregisterPayload = PayloadData<{bundleId: BundleUId}>

export type CommandsSetResolverPayload = PayloadData<{commandId?: CommandUId, resolver: AglynCommandResolver}>
export type CommandsRemoveResolverPayload = PayloadData<{commandId: CommandUId}>
export type CommandsRegisterListenerPayload = PayloadData<{commandId?: CommandUId, listener: AglynCommandListener}>
export type CommandsUnregisterListenerPayload = PayloadData<{commandId?: CommandUId, listener: AglynCommandListener}>
export type CommandsTriggerPayload = PayloadData<{commandId: CommandUId} & Dictionary>

export type CanvasUndoPayload = PayloadData<any>
export type CanvasRedoPayload = PayloadData<any>
export type CanvasGetStorePayload = PayloadData<any>
export type CanvasSetElementsPayload = PayloadData<{elements: AglynElementsById}>
export type CanvasGetElementsDenormalizedPayload = PayloadData<any>
export type CanvasGetElementsNormalizedPayload = PayloadData<any>
export type CanvasGetApiEventsPayload = PayloadData<any>
export type CanvasAddElementPayload = PayloadData<{parentId: ElementId, index: number, element: AglynElementNormalized}>
export type CanvasGetElementPayload = PayloadData<{$id: ElementId}>
export type CanvasUpdateElementPayload = PayloadData<{element: RequiredPickAlt<AglynElementDenormalized, '$id'>}>
export type CanvasSetElementPayload = PayloadData<{element: AglynElementDenormalized}>
export type CanvasDeleteElementPayload = PayloadData<{$id: ElementId}>
export type CanvasMoveElementPayload = PayloadData<{$id: ElementId, parentId: ElementId, index: number}>
export type CanvasDuplicateElementPayload = PayloadData<{$id: ElementId}>

export interface AglynModuleEffectPayload extends Record<AglynAppEffectFlag, AglynEmitterPayload> {
  [AglynAppEffectFlag.EXTENSION_REGISTER]: ExtensionRegisterPayload
  [AglynAppEffectFlag.EXTENSION_INITIALIZE]: ExtensionInitializePayload
  [AglynAppEffectFlag.EXTENSION_DESTROY]: ExtensionDestroyPayload
  [AglynAppEffectFlag.EXTENSION_LOAD]: ExtensionLoadPayload
  [AglynAppEffectFlag.EXTENSION_UNLOAD]: ExtensionUnloadPayload

  [AglynAppEffectFlag.CONTEXTS_CREATE_STORE]: ContextsCreateStorePayload
  [AglynAppEffectFlag.CONTEXTS_CREATE_EVENT]: ContextsCreateEventPayload
  [AglynAppEffectFlag.CONTEXTS_CREATE_EFFECT]: ContextsCreateEffectPayload
  [AglynAppEffectFlag.CONTEXTS_GET_STORE]: ContextsGetStorePayload
  [AglynAppEffectFlag.CONTEXTS_GET_STORE_API]: ContextsGetStoreApiPayload
  [AglynAppEffectFlag.CONTEXTS_SET_STORE]: ContextsSetStorePayload
  [AglynAppEffectFlag.CONTEXTS_DELETE_STORE]: ContextsDeleteStorePayload

  [AglynAppEffectFlag.COMMANDS_RESOLVER_SET]: CommandsSetResolverPayload
  [AglynAppEffectFlag.COMMANDS_RESOLVER_REMOVE]: CommandsRemoveResolverPayload
  [AglynAppEffectFlag.COMMANDS_LISTENER_REGISTER]: CommandsRegisterListenerPayload
  [AglynAppEffectFlag.COMMANDS_LISTENER_UNREGISTER]: CommandsUnregisterListenerPayload
  [AglynAppEffectFlag.COMMANDS_TRIGGER]: CommandsTriggerPayload

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
export type AglynEmitter = EmitterFn<AglynEventPayloads>

export const AGLYN_EMITTER: AglynEmitter = EmitterFn()
