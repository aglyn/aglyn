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

import type {
  Dictionary,
  JSXForwardRefExoticComponent,
  JSXPropsWithoutRef,
  JSXRefAttributes,
  OrUndef,
  ResolveProps,
} from '@aglyn/shared-data-types'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { BoxProps, StyledOptions } from '@aglyn/shared-ui-theme'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type {
  ConditionDefinition,
  DataType,
  FieldActions,
  ResolvePropsFunction,
  Validator,
} from '@aglyn/shared-ui-jsx-forms'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import type { ComponentsLinealDirectiveFlag, FieldComponentType } from '../constants/components'
import type {
  ComponentGetPayload,
  ComponentRegisterPayload,
  ComponentsBundleGetPayload,
  ComponentsBundleRegisterPayload,
  ComponentsBundleUnregisterPayload,
  ComponentSchemaGetPayload,
  ComponentUnregisterPayload,
} from '../constants/emitter'
import type { OF_KIND, OF_TYPE, SYMBOL_TYPE } from '../constants/symbol'
import type { IAglynAppController } from './aglyn-app.types'
import type { AglynElementDenormalized } from './aglyn-elements.types'
import type {
  AglynModuleModelOptions,
  AglynModuleModelT,
  IAglynModuleModel,
} from './aglyn-module.types'

export type BundleUId = string
export type ComponentId = string
export type TemplateId = string
export type ComponentIdOrBundleTuple = ComponentId | [ComponentId, BundleUId]

export type ComponentsRegistryKeys = ComponentIdOrBundleTuple[]
export type ComponentsRegistryValues = IAglynComponent[]
export type ComponentsRegistryEntry = [id: ComponentIdOrBundleTuple, component: IAglynComponent]
export type InstanceBundles = Map<BundleUId, AglynComponentsBundle>
export type InstanceComponents = Map<ComponentIdOrBundleTuple, IAglynComponent>
export type InstanceSchemas = Map<ComponentIdOrBundleTuple, AglynComponentSchema>
export type InstanceTemplates = Map<TemplateId, AglynComponentElementTemplate>

export type ComponentsLinealOrder<
  T extends ComponentsLinealDirectiveFlag = ComponentsLinealDirectiveFlag
> = [
  directiveType: T,
  directiveDefinition:
    | ComponentId[]
    | { bundles?: BundleUId[]; components: ComponentId[] }
    | { bundles: BundleUId[]; components?: ComponentId[] }
]

export type AglynComponentElementTemplate = {
  id: TemplateId
  label: string
  description?: string
  icon?: MdiIconProps
  data: AglynComponentTemplateData<any>
}

export type AglynComponentPropsFormSchema<P = any> = AglynComponentSchema<P>['formSchema']
export type AglynComponentHierarchy<P = any> = AglynComponentSchema<P>['hierarchy']
export type AglynComponentHierarchyFlags<P = any> = AglynComponentSchema<P>['hierarchy']
export type AglynComponentsBundleMetadata = AglynComponentsBundle
export type AglynComponentsBundleSchema = Omit<AglynComponentsBundle, 'componentIds'>

export type ComponentsRegistryContext = {
  bundles: InstanceBundles
  components: InstanceComponents
  schemas: InstanceSchemas
  templates: InstanceTemplates
}

export interface IAglynComponent<P = any, T = any>
  extends JSXForwardRefExoticComponent<JSXPropsWithoutRef<P> & JSXRefAttributes<T>> {
  [OF_TYPE]?: SYMBOL_TYPE
  [OF_KIND]?: SYMBOL_TYPE
  aglyn?: boolean
  componentId?: ComponentId
  bundleId?: BundleUId
}

export interface AglynComponentField extends Dictionary<any> {
  name: string
  component: string | FieldComponentType
  validate?: Validator[]
  condition?: ConditionDefinition | ConditionDefinition[]
  initializeOnMount?: boolean
  dataType?: DataType
  initialValue?: any
  clearedValue?: any
  clearOnUnmount?: boolean
  actions?: FieldActions
  resolveProps?: ResolvePropsFunction
  description?: string
}

export interface AglynComponentTemplateData<P = any> {
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  props?: BoxProps<any, P>
  elements?: AglynComponentTemplateData<any>[]
}

export interface AglynComponentSchema<P = any> {
  componentId: ComponentId
  bundleId?: BundleUId
  // Metadata
  displayName: string
  title?: string
  subtitle?: string
  description?: string
  icon?: MdiIconProps
  // Render feature flags
  emotion?: {
    disable?: boolean
    options?: StyledOptions
  }
  hierarchy?: {
    restrictChildren?: ComponentsLinealOrder
    restrictParent?: ComponentsLinealOrder
  }
  resolveProps?: ResolveProps<AglynElementDenormalized<P>>
  // Besigner feature flags
  actions?: { disable?: boolean }
  badge?: { disable?: boolean }
  duplication?: { disable?: boolean }
  dragging?: { disable?: boolean }
  dropping?: { disable?: boolean }
  editing?: { disable?: boolean }
  outline?: { disable?: boolean }
  removal?: { disable?: boolean }
  selection?: { disable?: boolean }
  templates?: AglynComponentElementTemplate[]
  formSchema?: {
    fields: AglynComponentField[]
  }
}

export interface AglynComponentsBundle {
  readonly bundleId: BundleUId
  componentIds: ComponentId[]
  // Metadata
  displayName: string
  title?: string
  subtitle?: string
  description?: string
  icon?: MdiIconProps
}

export interface AglynComponentsControllerOptions extends AglynModuleModelOptions {}

export interface IAglynComponentsController
  extends IAglynModuleModel<AglynComponentsControllerOptions> {
  readonly bundles: InstanceBundles
  readonly components: InstanceComponents
  readonly schemas: InstanceSchemas
  readonly templates: InstanceTemplates

  getAllComponents(): ComponentsRegistryEntry[]
  getAllComponentsKeys(): ComponentsRegistryKeys
  getAllComponentsValues(): ComponentsRegistryValues
  getAllComponentsTemplateValues(): AglynComponentElementTemplate[]

  getComponent<P, T>(payload: ComponentGetPayload): OrUndef<IAglynComponent<P, T>>
  getComponentSchema(payload: ComponentSchemaGetPayload): OrUndef<AglynComponentSchema>
  getBundle(payload: ComponentsBundleGetPayload): OrUndef<AglynComponentsBundle>
  buildMapKey(data: { componentId: ComponentId; bundleId: BundleUId }): string

  registerComponent(payload: ComponentRegisterPayload): this
  registerBundle(payload: ComponentsBundleRegisterPayload): this

  unregisterComponent(payload: ComponentUnregisterPayload): this
  unregisterBundle(payload: ComponentsBundleUnregisterPayload): this
}

export interface AglynComponentsControllerT
  extends AglynModuleModelT<AglynComponentsControllerOptions> {
  new (
    app: IAglynAppController,
    options: AglynComponentsControllerOptions
  ): IAglynComponentsController
}
