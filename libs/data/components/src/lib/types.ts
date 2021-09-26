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
  AglynEmitterPayload,
  AglynExtensionInstance,
  AglynTypeFields,
  AglynUniqueId,
  EXTENSION_TYPE,
  MODULE_TYPE,
  PayloadData,
  RestrictFlag,
} from '@aglyn/data-framework'
import '@aglyn/data-framework'
import { IconId as MdiIconId } from '@aglyn/shared-data-mdi'
import { FormSchema, InnerRefProp } from '@aglyn/shared-ui-jsx'
import { AnyProps, JSXIntrinsicElement, JSXNode, ResolveProps } from '@aglyn/shared-data-types'
import { ComponentClass, FunctionComponent } from 'react'

export type AglynComponentTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof EXTENSION_TYPE>

export type AglynComponentClassElement<P = any> = ComponentClass<P>
export type AglynComponentFunctionElement<P = any> = FunctionComponent<P>
export type AglynComponentIntrinsicElement<P = any> = JSXIntrinsicElement<P>
export type AglynComponentElementType<P = any> =
  | AglynComponentClassElement<P>
  | AglynComponentFunctionElement<P>
  | AglynComponentIntrinsicElement<P>

export type PluginId = string
export type SelfComponentId = string
export type PluginNsComponentSep = '::'
export type Pid = PluginId
export type ScId = SelfComponentId
export type PnCs = PluginNsComponentSep
export type PluginComponentIdTuple = [Pid, ScId]
export type PluginComponentIdString = `${Pid}${PnCs}${ScId}`
export type PluginComponentId = PluginComponentIdTuple | PluginComponentIdString
export type ComponentId = SelfComponentId | PluginComponentId

export type RegistryEntry = [id: ComponentId, component: AglynComponent]
export type ComponentsRegistryEntries = RegistryEntry[]
export type ComponentsRegistryKeys = ComponentId[]
export type RegistryValue = AglynComponent
export type ComponentsRegistryValues = RegistryValue[]
export type RegistryPluginMap = Map<PluginId, AglynComponentsPlugin>
export type RegistryComponentsMap = Map<ComponentId, AglynComponent>

export type AglynComponent<P = any> = AglynComponentClassElement<P & InnerRefProp<any>> &
  AglynComponentFields

export type GetComponentPayload = PayloadData<{ componentId: string }>
export type RegisterComponentPayload = PayloadData<{ component: AglynComponent }>
export type UnregisterComponentPayload = PayloadData<{ componentId: string }>
export type RegisterPluginPayload = PayloadData<{ plugin: AglynComponentsPlugin }>
export type UnregisterPluginPayload = PayloadData<{ pluginId: string }>

export enum AglynComponentEventFlag {
  COMPONENT_GET = 'module:extension:components:get-component',
  COMPONENTS_GET = 'module:extension:components:get-components',
  COMPONENT_REGISTER = 'module:extension:components:register-component',
  COMPONENT_UNREGISTER = 'module:extension:components:unregister-component',
  COMPONENTS_PLUGIN_REGISTER = 'module:extension:components:register-components-plugin',
  COMPONENTS_PLUGIN_UNREGISTER = 'module:extension:components:unregister-components-plugin',
}

export interface AglynComponentsExtension extends AglynExtensionInstance {
  getAllComponentsValues(): ComponentsRegistryValues
  getAllComponentsKeys(): ComponentsRegistryKeys
  getAllComponents(): ComponentsRegistryEntries
  getComponent(payload: GetComponentPayload): AglynComponent
  unregisterComponent(payload: UnregisterComponentPayload): this
  registerComponent(payload: RegisterComponentPayload): this
  registerComponentsPlugin(payload: RegisterPluginPayload): this
  unregisterComponentsPlugin(payload: UnregisterPluginPayload): this
}

export interface ComponentsRegistry {
  plugins: RegistryPluginMap
  components: RegistryComponentsMap
}

export interface AglynModuleEventParams
  extends Record<AglynComponentEventFlag, AglynEmitterPayload> {
  [AglynComponentEventFlag.COMPONENT_GET]: GetComponentPayload
  [AglynComponentEventFlag.COMPONENTS_GET]: undefined
  [AglynComponentEventFlag.COMPONENT_REGISTER]: UnregisterComponentPayload
  [AglynComponentEventFlag.COMPONENT_UNREGISTER]: UnregisterComponentPayload
  [AglynComponentEventFlag.COMPONENTS_PLUGIN_REGISTER]: RegisterPluginPayload
  [AglynComponentEventFlag.COMPONENTS_PLUGIN_UNREGISTER]: UnregisterPluginPayload
}

export namespace ComponentOptions {
  export type Essential = {
    displayName: string
  }
  export type Metadata = {
    title?: string
    subtitle?: string
    description?: string
    icon?: MdiIconId | JSXNode
  }
  export type Props<P = any> = {
    propsFormSchema?: FormSchema
    propsDefaults?: Partial<P>
    propsResolver?: ResolveProps<P>
  }
  export type ElementRef = { disableRef?: boolean } | { innerRef?: boolean }
  export type BuilderFeatures = {
    disableActions?: boolean
    disableBadge?: boolean
    disableCopying?: boolean
    disableDragging?: boolean
    disableDropping?: boolean
    disableEditing?: boolean
    disableOutline?: boolean
    disableRemoving?: boolean
    disableSelecting?: boolean
  }
  export type RendererFeatures = {
    disableStyled?: boolean
  }
  export type HierarchyRestriction = [type: RestrictFlag, componentIds: ComponentId[]]
  export type RestrictHierarchy = {
    restrictChildren?: HierarchyRestriction
    restrictParents?: HierarchyRestriction
  }
  export type Deactivators<T> = {
    [K in keyof T as `disable${Capitalize<string & K>}`]: T[K]
  }
}

export type AglynComponentOptions<P = any> = ComponentOptions.Props<P> &
  ComponentOptions.Essential &
  ComponentOptions.Metadata &
  ComponentOptions.ElementRef &
  ComponentOptions.RestrictHierarchy &
  ComponentOptions.Deactivators<ComponentOptions.BuilderFeatures> &
  ComponentOptions.Deactivators<ComponentOptions.RendererFeatures>

export interface AglynComponentFields extends AglynUniqueId, AglynComponentTypeFields {
  options: AglynComponentOptions
}

export interface AglynComponentPluginOptions {
  displayName: string
}

export interface AglynComponentsPlugin extends AglynUniqueId, AglynComponentTypeFields {
  options: AglynComponentPluginOptions
  components: RegistryComponentsMap
}

export interface AglynComponentData extends AglynUniqueId {
  component?: ComponentId
  plugin?: PluginId
  children?: (AglynComponentData | string)[]
  props?: AnyProps
  temporary?: boolean
  parent?: string
  name?: string
  description?: string
}
