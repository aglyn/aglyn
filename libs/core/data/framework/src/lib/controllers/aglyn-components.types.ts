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

import type {
  AnyProps,
  Dictionary,
  EmptyObj,
  JSXElementType,
  JSXForwardRefExoticComponent,
  JSXPropsWithoutRef,
  JSXRefAttributes,
  OrUndef,
  ResolveProps,
} from '@aglyn/shared-data-types'
import type {StyledOptions, SxProps} from '@aglyn/shared-feature-themes'
import type {MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import type {
  FieldActions,
  ResolvePropsFunction,
} from '@data-driven-forms/react-form-renderer/common-types/field'
import type {ConditionDefinition} from '@data-driven-forms/react-form-renderer/condition'
import type {DataType} from '@data-driven-forms/react-form-renderer/data-types'
import type {Validator} from '@data-driven-forms/react-form-renderer/validators'
import type {ComponentsLinealDirectiveFlag} from '../constants/components'
import type {
  ComponentGetPayload,
  ComponentRegisterPayload,
  ComponentsBundleGetPayload,
  ComponentsBundleRegisterPayload,
  ComponentsBundleUnregisterPayload,
  ComponentSchemaGetPayload,
  ComponentUnregisterPayload,
} from '../constants/emitter'
import type {
  COMPONENT_ELEMENT_TYPE,
  EXTENSION_TYPE,
  MODULE_TYPE,
  TYPE_KIND,
  TYPE_OF,
} from '../constants/symbol'
import type {
  AglynModuleModelOptions,
  AglynModuleModelT,
  IAglynModuleModel,
} from '../models/aglyn-module.types'
import type {AglynTypeFields, BundleUId, ComponentId, ElementId, TemplateId} from '../types'
import type {IAglynAppController} from './aglyn-app.types'


export type AglynComponentsTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMPONENT_ELEMENT_TYPE>
export type LinealDefinition = ComponentId[]
  | {bundles?: BundleUId[], components: ComponentId[]}
  | {bundles: BundleUId[], components?: ComponentId[]}
export type ComponentsLinealOrder<T extends ComponentsLinealDirectiveFlag = ComponentsLinealDirectiveFlag> = [
  directiveType: T,
  directiveDefinition: LinealDefinition
]
export type ComponentsRegistryKeys = (ComponentId | [ComponentId, BundleUId])[]
export type ComponentsRegistryValues = IAglynComponent[]
export type ComponentsRegistryEntry = [
  cId: ComponentId | [ComponentId, BundleUId],
  cmp: IAglynComponent
]
export type InstanceBundles = Map<BundleUId, AglynComponentsBundle>
export type InstanceComponents = Map<ComponentId | [ComponentId, BundleUId], IAglynComponent>
export type InstanceSchemas = Map<ComponentId | [ComponentId, BundleUId], AglynComponentSchema>
export type InstanceTemplates = Map<TemplateId, AglynComponentElementTemplate>
export type AglynElementType<P = any> = JSXElementType<P>

export interface IAglynComponent<P = EmptyObj, T = any> extends JSXForwardRefExoticComponent<JSXPropsWithoutRef<P> & JSXRefAttributes<T>> {

  readonly [TYPE_OF]?: MODULE_TYPE
  readonly [TYPE_KIND]?: EXTENSION_TYPE
  componentId?: ComponentId
  bundleId?: BundleUId
}

export interface ComponentsRegistryContext {
  bundles: InstanceBundles
  components: InstanceComponents
  schemas: InstanceSchemas
  templates: InstanceTemplates
}

export interface ComponentsRegistryEntryMetadata {
  displayName: string
  title?: string
  subtitle?: string
  description?: string
  iconPath?: MdiIconProps['path']
  iconColor?: string,
}

export interface AglynComponentBesignerFlags {
  // Besigner feature flags
  actions?: {disable?: boolean}
  badge?: {disable?: boolean}
  copying?: {disable?: boolean}
  dragging?: {disable?: boolean}
  dropping?: {disable?: boolean}
  editing?: {disable?: boolean}
  outline?: {disable?: boolean}
  removing?: {disable?: boolean}
  selecting?: {disable?: boolean}
}

export interface AglynComponentField extends Dictionary<any> {
  name: string
  component: string
  validate?: Validator[]
  condition?: ConditionDefinition | (ConditionDefinition[])
  initializeOnMount?: boolean
  dataType?: DataType
  initialValue?: any
  clearedValue?: any
  clearOnUnmount?: boolean
  actions?: FieldActions
  resolveProps?: ResolvePropsFunction
  description?: string
}

export interface AglynComponentPropsFormSchema {
  fields: AglynComponentField[]
}

export interface AglynComponentRenderFlags<P = EmptyObj> {
  hierarchy?: {
    restrictChildren?: ComponentsLinealOrder
    restrictParent?: ComponentsLinealOrder
  }
  elementRef?: {disable?: boolean; innerRef?: boolean}
  propsSchema?: AglynComponentPropsFormSchema
  resolveProps?: ResolveProps<AglynComponentElementDataNormalized<P>>
  emotionStyled?: {
    disable?: boolean
    options?: StyledOptions
  }
}

export interface AglynComponentSchema<P = EmptyObj> {
  componentId: ComponentId
  bundleId?: BundleUId
  // Metadata
  metadata: ComponentsRegistryEntryMetadata
  // Besigner feature flags
  besignerFlags?: AglynComponentBesignerFlags
  // Render feature flags
  renderFlags?: AglynComponentRenderFlags<P>
  // Besigner templates for modeling new elements
  templates?: AglynComponentElementTemplate[]
}

export interface AglynComponentElementTemplate {
  readonly id: TemplateId
  label: string
  description?: string
  iconPath?: MdiIconProps['path']
  iconColor?: string,
  data: AglynComponentTemplateData
}

export interface AglynComponentTemplateData {
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  elements?: AglynComponentTemplateData[]
  props?: AnyProps
}

export interface AglynComponentElementData<P = EmptyObj> {
  readonly $id: ElementId
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  parentId?: ElementId
  displayName?: string
  description?: string
  props?: {sx?: SxProps} & P
}

export interface AglynComponentElementDataDenormalized<P = any> extends AglynComponentElementData<P> {
  elements?: AglynComponentElementDataDenormalized<unknown>[]
}

export interface AglynComponentElementDataNormalized<P = any> extends AglynComponentElementData<P> {
  elements?: ElementId[]
}

export interface AglymComponentsBundleSchema {
  readonly bundleId: BundleUId
  metadata?: ComponentsRegistryEntryMetadata
}

export interface AglynComponentsBundle extends AglymComponentsBundleSchema {
  componentIds: ComponentId[]
}

export interface AglynComponentsControllerOptions extends AglynModuleModelOptions {

}

export interface IAglynComponentsController extends IAglynModuleModel<AglynComponentsControllerOptions> {
  readonly bundles: InstanceBundles
  readonly components: InstanceComponents
  readonly schemas: InstanceSchemas
  readonly templates: InstanceTemplates

  getAllComponents(): ComponentsRegistryEntry[]
  getAllComponentsKeys(): ComponentsRegistryKeys
  getAllComponentsValues(): ComponentsRegistryValues
  getAllComponentsTemplateValues(): AglynComponentElementTemplate[]

  getComponent(payload: ComponentGetPayload): OrUndef<IAglynComponent>
  getComponentSchema(payload: ComponentSchemaGetPayload): OrUndef<AglynComponentSchema>
  getBundle(payload: ComponentsBundleGetPayload): OrUndef<AglynComponentsBundle>
  buildMapKey(data: {componentId: ComponentId, bundleId: BundleUId}): string

  registerComponent(payload: ComponentRegisterPayload): this
  registerBundle(payload: ComponentsBundleRegisterPayload): this

  unregisterComponent(payload: ComponentUnregisterPayload): this
  unregisterBundle(payload: ComponentsBundleUnregisterPayload): this
}

export interface AglynComponentsControllerT extends AglynModuleModelT<AglynComponentsControllerOptions> {
  new(
    app: IAglynAppController,
    options: AglynComponentsControllerOptions,
  ): IAglynComponentsController
}
