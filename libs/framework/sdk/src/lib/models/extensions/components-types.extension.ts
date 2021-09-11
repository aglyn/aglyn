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

// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import { FormSchema, InnerRefProp } from '@aglyn/shared/ui/react'
import { AnyProps } from '@aglyn/shared/util/types'
import { ComponentClass, FunctionComponent } from 'react'
import { RestrictFlag } from '../../constants'
import { AglynEmitterPayload } from '../../emitter'
import '../../emitter'
import { EXTENSION_TYPE, MODULE_TYPE } from '../../symbol'
import { AglynExtensionInstance, AglynTypeFields, AglynUniqueId, PayloadData } from '../../types'


export type AglynComponentTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof EXTENSION_TYPE>

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

type IntrinsicElements<P = any> = {
  [K in keyof JSX.IntrinsicElements]: P extends JSX.IntrinsicElements[K] ? K : never
}
export type AglynComponentClassType<P = any> = ComponentClass<P>
export type AglynComponentFunctionType<P = any> = FunctionComponent<P>
export type AglynComponentIntrinsicType<P = any> = IntrinsicElements[keyof JSX.IntrinsicElements]
export type AglynComponentElementType<P = any> =
  AglynComponentClassType<P>
  | AglynComponentFunctionType<P>
  | AglynComponentIntrinsicType<P>

export type AglynComponent<P = any> = AglynComponentClassType<P & InnerRefProp<any>> & AglynComponentFields

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

export interface ComponentsRegistry {
  plugins: RegistryPluginMap
  components: RegistryComponentsMap
}

export interface AglynModuleEventParams extends Record<AglynComponentEventFlag, AglynEmitterPayload> {
  [AglynComponentEventFlag.COMPONENT_GET]: GetComponentPayload
  [AglynComponentEventFlag.COMPONENTS_GET]: undefined
  [AglynComponentEventFlag.COMPONENT_REGISTER]: UnregisterComponentPayload
  [AglynComponentEventFlag.COMPONENT_UNREGISTER]: UnregisterComponentPayload
  [AglynComponentEventFlag.COMPONENTS_PLUGIN_REGISTER]: RegisterPluginPayload
  [AglynComponentEventFlag.COMPONENTS_PLUGIN_UNREGISTER]: UnregisterPluginPayload
}

export interface AglynComponentOptions<P = any> {
  displayName: string
  title?: string
  subtitle?: string
  description?: string
  icon?: unknown
  propsSchema?: FormSchema
  defaultProps?: Partial<P>
  resolveProps?: (propsWithDefaults: P) => P
  disableActions?: boolean
  disableBadge?: boolean
  disableCopying?: boolean
  disableDragging?: boolean
  disableDropping?: boolean
  disableEditing?: boolean
  disableNesting?: boolean
  disableOutline?: boolean
  disableRemoving?: boolean
  disableSelecting?: boolean
  disableRef?: boolean
  innerRef?: boolean
  disableStyled?: boolean
  restrictChildren?: [type: RestrictFlag, cIds: ComponentId[]]
  restrictParents?: [type: RestrictFlag, cIds: ComponentId[]]
}

export interface AglynComponentFields extends AglynUniqueId, AglynComponentTypeFields {
  options: AglynComponentOptions
}

export interface AglynComponentPluginOptions {
  displayName: string
}

export interface AglynComponentsPlugin extends AglynUniqueId, AglynComponentTypeFields {
  components: RegistryComponentsMap
  options: AglynComponentPluginOptions
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
