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

import type { AnyProps, Dictionary } from '@aglyn/shared-data-types'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import { EmitterFn } from '@aglyn/shared-util-emitter'
import type {
  createEffect as createEffectorEffect,
  createEvent as createEffectorEvent,
} from 'effector'
import type { AppUUN } from '../definitions/app.types'
import type { CanvasContext } from '../definitions/canvas.types'
import type {
  AglynCommandListener,
  AglynCommandResolver,
  CommandUId,
} from '../definitions/commands.types'
import type {
  AglynBundleSchema,
  AglynComponentSchema,
  AglynExoticComponent,
  AglynNodeItemDenormalized,
  AglynNodeItemNormalized,
  AglynNodesById,
  AglynNodesList,
  BundleId,
  ComponentId,
  NodeId,
} from '../definitions/components.types'
import type {
  ContextStore,
  ContextStoreOptions,
  ContextStoreUid,
} from '../definitions/contexts.types'
import type {
  AglynExtensionOptions,
  IAglynExtension,
} from '../definitions/extension.types'
import type {
  AglynExtensionLoader,
  ExtensionUUN,
} from '../definitions/extensions.types'
import type { PayloadData } from '../definitions/shared'

export enum AglynEventStateFlag {
  APP_CREATING = 'event:app:creating',
  APP_CREATED = 'event:app:created',
  APP_INITIALIZING = 'event:app:initializing',
  APP_INITIALIZED = 'event:app:initialized',
  APP_ACTIVATING = 'event:app:activating',
  APP_ACTIVATED = 'event:app:activated',
  APP_DEACTIVATING = 'event:app:deactivating',
  APP_DEACTIVATED = 'event:app:deactivated',
  APP_DESTROYING = 'event:app:destroying',
  APP_DESTROYED = 'event:app:destroyed',
  APP_DELETING = 'event:app:deleting',
  APP_DELETED = 'event:app:deleted',

  MODULE_INITIALIZING = 'event:module:initializing',
  MODULE_INITIALIZED = 'event:module:initialized',
  MODULE_ACTIVATING = 'event:module:activating',
  MODULE_ACTIVATED = 'event:module:activated',
  MODULE_DEACTIVATING = 'event:module:deactivating',
  MODULE_DEACTIVATED = 'event:module:deactivated',
  MODULE_DESTROYING = 'event:module:destroying',
  MODULE_DESTROYED = 'event:module:destroyed',

  EXTENSION_REGISTERING = 'event:extensions:registering-extension',
  EXTENSION_REGISTERED = 'event:extensions:registered-extension',
  EXTENSION_INITIALIZING = 'event:extensions:initializing-extension',
  EXTENSION_INITIALIZED = 'event:extensions:initialized-extension',
  EXTENSION_ACTIVATING = 'event:extensions:activating-extension',
  EXTENSION_ACTIVATED = 'event:extensions:activated-extension',
  EXTENSION_DEACTIVATING = 'event:extensions:deactivating-extension',
  EXTENSION_DEACTIVATED = 'event:extensions:deactivated-extension',
  EXTENSION_DESTROYING = 'event:extensions:destroying-extension',
  EXTENSION_DESTROYED = 'event:extensions:destroyed-extension',

  COMMAND_RESOLVER_SETTING = 'event:commands:setting-resolver',
  COMMAND_RESOLVER_SET = 'event:commands:set-resolver',
  COMMAND_LISTENER_REGISTERING = 'event:commands:registering-listener',
  COMMAND_LISTENER_REGISTERED = 'event:commands:registered-listener',
  COMMAND_RESOLVER_REMOVING = 'event:commands:unregistering-resolver',
  COMMAND_RESOLVER_REMOVED = 'event:commands:unregistered-resolver',
  COMMAND_LISTENER_UNREGISTERING = 'event:commands:unregistering-listener',
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

export enum AglynEventTriggerFlag {
  EXTENSION_REGISTER = 'effect:extension:register',
  EXTENSION_INITIALIZE = 'effect:extension:initialize',
  EXTENSION_ACTIVATE = 'effect:extension:activate',
  EXTENSION_DEACTIVATE = 'effect:extension:deactivate',
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

export type ExtensionHandleLoaderPayload = PayloadData<{
  loader: AglynExtensionLoader
  options?: Partial<AglynExtensionOptions>
}>
export type ExtensionRegisterPayload = PayloadData<{
  extension: IAglynExtension
}>
export type ExtensionInitializePayload = PayloadData<{
  extension: IAglynExtension
}>
export type ExtensionDestroyPayload = PayloadData<{
  extensionName: ExtensionUUN
}>
export type ExtensionLoadPayload = PayloadData<{ extensionName: ExtensionUUN }>
export type ExtensionUnloadPayload = PayloadData<{
  extensionName: ExtensionUUN
}>

export type ContextsCreateStorePayload<T = any> = PayloadData<{
  defaultState: T
  options?: ContextStoreOptions<T>
}>
export type ContextsCreateEventPayload = PayloadData<{
  options: Parameters<typeof createEffectorEvent>
}>
export type ContextsCreateEffectPayload = PayloadData<{
  options: Parameters<typeof createEffectorEffect>
}>
export type ContextsGetStorePayload = PayloadData<{ storeId: ContextStoreUid }>
export type ContextsGetStoreApiPayload = PayloadData<{
  storeId: ContextStoreUid
}>
export type ContextsSetStorePayload<T = any> = PayloadData<{
  storeId: ContextStoreUid
  store: ContextStore<T> | any
}>
export type ContextsDeleteStorePayload = PayloadData<{
  storeId: ContextStoreUid
}>

export type ComponentGetPayload = PayloadData<{
  componentId: ComponentId
  bundleId?: BundleId
}>
export type ComponentsGetPayload = PayloadData<{
  ids?: { componentId: ComponentId; bundleId?: BundleId }[]
}>
export type ComponentSchemaGetPayload = PayloadData<{
  componentId: ComponentId
  bundleId?: BundleId
}>
export type ComponentsBundleGetPayload = PayloadData<{ bundleId: BundleId }>
export type ComponentRegisterPayload<P extends AnyProps = any> = PayloadData<{
  schema: AglynComponentSchema<P>
  component: AglynExoticComponent<P>
}>
export type ComponentUnregisterPayload = PayloadData<{
  componentId: ComponentId
  bundleId: BundleId
}>
export type ComponentsBundleRegisterPayload = PayloadData<{
  bundle: Omit<AglynBundleSchema, 'componentIds'>
  components: ComponentRegisterPayload[]
}>
export type ComponentsBundleUnregisterPayload = PayloadData<{
  bundleId: BundleId
}>

export type CommandsSetResolverPayload = PayloadData<{
  commandId?: CommandUId
  resolver: AglynCommandResolver
}>
export type CommandsRemoveResolverPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandsRegisterListenerPayload = PayloadData<{
  commandId?: CommandUId
  listener: AglynCommandListener
}>
export type CommandsUnregisterListenerPayload = PayloadData<{
  commandId?: CommandUId
  listener: AglynCommandListener
}>
export type CommandsTriggerPayload = PayloadData<
  { commandId: CommandUId } & Dictionary
>

export type CanvasUndoPayload = PayloadData<
  { times?: number } | { first?: boolean }
>
export type CanvasRedoPayload = PayloadData<
  { times?: number } | { last?: boolean }
>
export type CanvasGetStorePayload<K extends keyof CanvasContext = any> =
  PayloadData<{ store: K }>
export type CanvasGetStatePayload = PayloadData<any>
export type CanvasNextStatePayload = PayloadData<CanvasContext>
export type CanvasSetElementsPayload = PayloadData<{
  type: 'normal' | 'denormal'
  elements: AglynNodesById | AglynNodesList
}>
export type CanvasGetElementsPastPayload = PayloadData<any>
export type CanvasGetElementsFuturePayload = PayloadData<any>
export type CanvasGetElementsPresentPayload = PayloadData<any>
export type CanvasGetElementsDenormalizedPayload = PayloadData<any>
export type CanvasGetElementsNormalizedPayload = PayloadData<any>
export type CanvasGetApiEventsPayload = PayloadData<any>
export type CanvasAddElementPayload = PayloadData<{
  parentId: NodeId
  index: number
  element: AglynNodeItemDenormalized
}>
export type CanvasGetElementPayload = PayloadData<{ $id: NodeId }>
export type CanvasUpdateElementPayload = PayloadData<{
  $id: NodeId
  update: (element: AglynNodeItemNormalized) => AglynNodeItemNormalized
}>
export type CanvasSetElementPayload = PayloadData<{
  element: AglynNodeItemNormalized
}>
export type CanvasDeleteElementPayload = PayloadData<{ $id: NodeId }>
export type CanvasMoveElementPayload = PayloadData<{
  $id: NodeId
  parentId: NodeId
  index: number
}>
export type CanvasDuplicateElementPayload = PayloadData<{ $id: NodeId }>

export type AppCreatingPayload = PayloadData<{ appName: AppUUN }>
export type AppCreatedPayload = PayloadData<{ appName: AppUUN }>
export type AppInitializingPayload = PayloadData<{ appName: AppUUN }>
export type AppInitializedPayload = PayloadData<{ appName: AppUUN }>
export type AppDestroyingPayload = PayloadData<{ appName: AppUUN }>
export type AppDestroyedPayload = PayloadData<{ appName: AppUUN }>
export type AppDeletingPayload = PayloadData<{ appName: AppUUN }>
export type AppDeletedPayload = PayloadData<{ appName: AppUUN }>

export type ModuleInitializingPayload = PayloadData<{ namespace: string }>
export type ModuleInitializedPayload = PayloadData<{ namespace: string }>
export type ModuleActivatingPayload = PayloadData<{ namespace: string }>
export type ModuleActivatedPayload = PayloadData<{ namespace: string }>
export type ModuleDeactivatingPayload = PayloadData<{ namespace: string }>
export type ModuleDeactivatedPayload = PayloadData<{ namespace: string }>
export type ModuleDestroyingPayload = PayloadData<{ namespace: string }>
export type ModuleDestroyedPayload = PayloadData<{ namespace: string }>

export type ExtensionRegisteringPayload = PayloadData<{ namespace: string }>
export type ExtensionRegisteredPayload = PayloadData<{ namespace: string }>
export type ExtensionInitializingPayload = PayloadData<{ namespace: string }>
export type ExtensionInitializedPayload = PayloadData<{ namespace: string }>
export type ExtensionActivatingPayload = PayloadData<{ namespace: string }>
export type ExtensionActivatedPayload = PayloadData<{ namespace: string }>
export type ExtensionDeactivatingPayload = PayloadData<{ namespace: string }>
export type ExtensionDeactivatedPayload = PayloadData<{ namespace: string }>
export type ExtensionDestroyingPayload = PayloadData<{ namespace: string }>
export type ExtensionDestroyedPayload = PayloadData<{ namespace: string }>

export type CommandResolverSettingPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandResolverSetPayload = PayloadData<{ commandId: CommandUId }>
export type CommandResolverTriggeringPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandResolverTriggeredPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandResolverRemovingPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandResolverRemovedPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandListenersTriggeringPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandListenersTriggeredPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandListenerRegisteringPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandListenerRegisteredPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandListenerUnregisteringPayload = PayloadData<{
  commandId: CommandUId
}>
export type CommandListenerUnregisteredPayload = PayloadData<{
  commandId: CommandUId
}>

export type ComponentRegisteringPayload = PayloadData<{
  componentId: ComponentId
  bundleId?: BundleId
}>
export type ComponentRegisteredPayload = PayloadData<{
  componentId: ComponentId
  bundleId?: BundleId
}>
export type ComponentUnregisteringPayload = PayloadData<{
  componentId: ComponentId
  bundleId?: BundleId
}>
export type ComponentUnregisteredPayload = PayloadData<{
  componentId: ComponentId
  bundleId?: BundleId
}>
export type ComponentBundleRegisteringPayload = PayloadData<{
  bundleId: BundleId
}>
export type ComponentBundleRegisteredPayload = PayloadData<{
  bundleId: BundleId
}>
export type ComponentBundleUnregisteringPayload = PayloadData<{
  bundleId: BundleId
}>
export type ComponentBundleUnregisteredPayload = PayloadData<{
  bundleId: BundleId
}>

export interface AglynEventStatePayload
  extends Record<AglynEventStateFlag, AglynEmitterPayload> {
  [AglynEventStateFlag.APP_CREATING]: AppCreatingPayload
  [AglynEventStateFlag.APP_CREATED]: AppCreatedPayload
  [AglynEventStateFlag.APP_INITIALIZING]: AppInitializingPayload
  [AglynEventStateFlag.APP_INITIALIZED]: AppInitializedPayload
  [AglynEventStateFlag.APP_DESTROYING]: AppDestroyingPayload
  [AglynEventStateFlag.APP_DESTROYED]: AppDestroyedPayload
  [AglynEventStateFlag.APP_DELETING]: AppDeletingPayload
  [AglynEventStateFlag.APP_DELETED]: AppDeletedPayload

  [AglynEventStateFlag.MODULE_INITIALIZING]: ModuleInitializingPayload
  [AglynEventStateFlag.MODULE_INITIALIZED]: ModuleInitializedPayload
  [AglynEventStateFlag.MODULE_ACTIVATING]: ModuleActivatingPayload
  [AglynEventStateFlag.MODULE_ACTIVATED]: ModuleActivatedPayload
  [AglynEventStateFlag.MODULE_DEACTIVATING]: ModuleDeactivatingPayload
  [AglynEventStateFlag.MODULE_DEACTIVATED]: ModuleDeactivatedPayload
  [AglynEventStateFlag.MODULE_DESTROYING]: ModuleDestroyingPayload
  [AglynEventStateFlag.MODULE_DESTROYED]: ModuleDestroyedPayload

  [AglynEventStateFlag.EXTENSION_REGISTERING]: ExtensionRegisteringPayload
  [AglynEventStateFlag.EXTENSION_REGISTERED]: ExtensionRegisteredPayload
  [AglynEventStateFlag.EXTENSION_INITIALIZING]: ExtensionInitializingPayload
  [AglynEventStateFlag.EXTENSION_INITIALIZED]: ExtensionInitializedPayload
  [AglynEventStateFlag.EXTENSION_ACTIVATING]: ExtensionActivatingPayload
  [AglynEventStateFlag.EXTENSION_ACTIVATED]: ExtensionActivatedPayload
  [AglynEventStateFlag.EXTENSION_DEACTIVATING]: ExtensionDeactivatingPayload
  [AglynEventStateFlag.EXTENSION_DEACTIVATED]: ExtensionDeactivatedPayload
  [AglynEventStateFlag.EXTENSION_DESTROYING]: ExtensionDestroyingPayload
  [AglynEventStateFlag.EXTENSION_DESTROYED]: ExtensionDestroyedPayload

  [AglynEventStateFlag.COMMAND_RESOLVER_SETTING]: CommandResolverSettingPayload
  [AglynEventStateFlag.COMMAND_RESOLVER_SET]: CommandResolverSetPayload
  [AglynEventStateFlag.COMMAND_RESOLVER_REMOVING]: CommandResolverRemovingPayload
  [AglynEventStateFlag.COMMAND_RESOLVER_REMOVED]: CommandResolverRemovedPayload
  [AglynEventStateFlag.COMMAND_RESOLVER_TRIGGERING]: CommandResolverTriggeringPayload
  [AglynEventStateFlag.COMMAND_RESOLVER_TRIGGERED]: CommandResolverTriggeredPayload
  [AglynEventStateFlag.COMMAND_LISTENERS_TRIGGERING]: CommandListenersTriggeringPayload
  [AglynEventStateFlag.COMMAND_LISTENERS_TRIGGERED]: CommandListenersTriggeredPayload
  [AglynEventStateFlag.COMMAND_LISTENER_REGISTERING]: CommandListenerRegisteringPayload
  [AglynEventStateFlag.COMMAND_LISTENER_REGISTERED]: CommandListenerRegisteredPayload
  [AglynEventStateFlag.COMMAND_LISTENER_UNREGISTERING]: CommandListenerUnregisteringPayload
  [AglynEventStateFlag.COMMAND_LISTENER_UNREGISTERED]: CommandListenerUnregisteredPayload

  [AglynEventStateFlag.COMPONENT_REGISTERING]: ComponentRegisteringPayload
  [AglynEventStateFlag.COMPONENT_REGISTERED]: ComponentRegisteredPayload
  [AglynEventStateFlag.COMPONENT_UNREGISTERING]: ComponentUnregisteringPayload
  [AglynEventStateFlag.COMPONENT_UNREGISTERED]: ComponentUnregisteredPayload
  [AglynEventStateFlag.COMPONENT_BUNDLE_REGISTERING]: ComponentBundleRegisteringPayload
  [AglynEventStateFlag.COMPONENT_BUNDLE_REGISTERED]: ComponentBundleRegisteredPayload
  [AglynEventStateFlag.COMPONENT_BUNDLE_UNREGISTERING]: ComponentBundleUnregisteringPayload
  [AglynEventStateFlag.COMPONENT_BUNDLE_UNREGISTERED]: ComponentBundleUnregisteredPayload
}

export interface AglynEventTriggerPayload
  extends Record<AglynEventTriggerFlag, AglynEmitterPayload> {
  [AglynEventTriggerFlag.EXTENSION_REGISTER]: ExtensionRegisterPayload
  [AglynEventTriggerFlag.EXTENSION_INITIALIZE]: ExtensionInitializePayload
  [AglynEventTriggerFlag.EXTENSION_DESTROY]: ExtensionDestroyPayload
  [AglynEventTriggerFlag.EXTENSION_ACTIVATE]: ExtensionLoadPayload
  [AglynEventTriggerFlag.EXTENSION_DEACTIVATE]: ExtensionUnloadPayload

  [AglynEventTriggerFlag.CONTEXTS_CREATE_STORE]: ContextsCreateStorePayload
  [AglynEventTriggerFlag.CONTEXTS_CREATE_EVENT]: ContextsCreateEventPayload
  [AglynEventTriggerFlag.CONTEXTS_CREATE_EFFECT]: ContextsCreateEffectPayload
  [AglynEventTriggerFlag.CONTEXTS_GET_STORE]: ContextsGetStorePayload
  [AglynEventTriggerFlag.CONTEXTS_GET_STORE_API]: ContextsGetStoreApiPayload
  [AglynEventTriggerFlag.CONTEXTS_SET_STORE]: ContextsSetStorePayload
  [AglynEventTriggerFlag.CONTEXTS_DELETE_STORE]: ContextsDeleteStorePayload

  [AglynEventTriggerFlag.COMMANDS_RESOLVER_SET]: CommandsSetResolverPayload
  [AglynEventTriggerFlag.COMMANDS_RESOLVER_REMOVE]: CommandsRemoveResolverPayload
  [AglynEventTriggerFlag.COMMANDS_LISTENER_REGISTER]: CommandsRegisterListenerPayload
  [AglynEventTriggerFlag.COMMANDS_LISTENER_UNREGISTER]: CommandsUnregisterListenerPayload
  [AglynEventTriggerFlag.COMMANDS_TRIGGER]: CommandsTriggerPayload

  [AglynEventTriggerFlag.COMPONENT_GET]: ComponentGetPayload
  [AglynEventTriggerFlag.COMPONENT_SCHEMA_GET]: ComponentSchemaGetPayload
  [AglynEventTriggerFlag.COMPONENTS_GET]: ComponentsGetPayload
  [AglynEventTriggerFlag.COMPONENTS_BUNDLE_GET]: ComponentsBundleGetPayload
  [AglynEventTriggerFlag.COMPONENT_REGISTER]: ComponentUnregisterPayload
  [AglynEventTriggerFlag.COMPONENT_UNREGISTER]: ComponentUnregisterPayload
  [AglynEventTriggerFlag.COMPONENTS_BUNDLE_REGISTER]: ComponentsBundleRegisterPayload
  [AglynEventTriggerFlag.COMPONENTS_BUNDLE_UNREGISTER]: ComponentsBundleUnregisterPayload
}

export type EventPayload<T, K extends keyof T = keyof T> = Record<K, T[K]>
export type AglynEventPayloads = EventPayload<AglynEventStatePayload> &
  EventPayload<AglynEventTriggerPayload> &
  Record<string, AglynEmitterPayload>
export type AglynEmitterPayload = PayloadData<Dictionary>
export type AglynEmitter = EmitterFn<AglynEventPayloads>

export const AGLYN_EMITTER: AglynEmitter = EmitterFn()
