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
  type Conditional,
  type Dictionary,
  type JSXElementType,
  type JSXForwardRefExoticComponent,
  type JSXPropsWithoutRef,
  type JSXRefAttributes,
  type KeyValueMap,
  type OrUndef,
  type ResolveProps,
} from '@aglyn/shared-data-types'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import {type BoxProps, type StyledOptions} from '@aglyn/shared-feature-themes'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import {type MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {
  type ConditionDefinition,
  type DataType,
  type FieldActions,
  type ResolvePropsFunction,
  type Validator,
} from '@data-driven-forms/react-form-renderer'
import {type CANVAS_ROOT_ELEMENT_ID} from '../constants/canvas'
import {type ComponentsLinealDirectiveFlag} from '../constants/components'
import {
  type ComponentGetPayload,
  type ComponentRegisterPayload,
  type ComponentsBundleGetPayload,
  type ComponentsBundleRegisterPayload,
  type ComponentsBundleUnregisterPayload,
  type ComponentSchemaGetPayload,
  type ComponentUnregisterPayload,
} from '../constants/emitter'
import {TYPE_KIND, TYPE_OF} from '../constants/symbol'
import {
  type AglynModuleModelOptions,
  type AglynModuleModelT,
  type IAglynModuleModel,
} from '../models/aglyn-module.types'
import {type IAglynAppController} from './aglyn-app.types'


export type BundleUId = string
export type ComponentId = string
export type TemplateId = string
export type ElementId = string
export type ComponentIdOrBundleTuple = (ComponentId | [ComponentId, BundleUId])

export type ComponentsRegistryKeys = ComponentIdOrBundleTuple[]
export type ComponentsRegistryValues = IAglynComponent[]
export type ComponentsRegistryEntry = [id: ComponentIdOrBundleTuple, component: IAglynComponent]
export type InstanceBundles = Map<BundleUId, AglynComponentsBundle>
export type InstanceComponents = Map<ComponentIdOrBundleTuple, IAglynComponent>
export type InstanceSchemas = Map<ComponentIdOrBundleTuple, AglynComponentSchema>
export type InstanceTemplates = Map<TemplateId, AglynComponentElementTemplate>
export type AglynElementType<P = any> = JSXElementType<P>

export interface IAglynComponent<P = any, T = any> extends JSXForwardRefExoticComponent<JSXPropsWithoutRef<P> & JSXRefAttributes<T>> {

  readonly [TYPE_OF]: number | symbol
  readonly [TYPE_KIND]: number | symbol
  componentId?: ComponentId
  bundleId?: BundleUId
}

export interface ComponentsRegistryContext {
  bundles: InstanceBundles
  components: InstanceComponents
  schemas: InstanceSchemas
  templates: InstanceTemplates
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


export interface AglynComponentTemplateData<P = any> {
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  props?: BoxProps<any, P>
  elements?: AglynComponentTemplateData<any>[]
}


export type LinealDefinition =
  | ComponentId[]
  | {bundles?: BundleUId[], components: ComponentId[]}
  | {bundles: BundleUId[], components?: ComponentId[]}

export type ComponentsLinealOrder<T extends ComponentsLinealDirectiveFlag = ComponentsLinealDirectiveFlag> = [
  directiveType: T,
  directiveDefinition: LinealDefinition
]

export type AglynComponentElementTemplate = {
  id: TemplateId
  label: string
  description?: string
  iconPath?: MdiIconProps['path']
  iconColor?: string,
  data: AglynComponentTemplateData<any>
}

export interface AglynComponentSchema<P = any> {
  componentId: ComponentId
  bundleId?: BundleUId
  // Metadata
  metadata: {
    displayName: string
    title?: string
    subtitle?: string
    description?: string
    iconPath?: MdiIconProps['path']
    iconColor?: string,
  }
  // Besigner feature flags
  besignerFlags?: {
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
  // Render feature flags
  renderFlags?: {
    hierarchy?: {
      restrictChildren?: ComponentsLinealOrder
      restrictParent?: ComponentsLinealOrder
    }
    propsSchema?: {
      fields: AglynComponentField[]
    }
    resolveProps?: ResolveProps<AglynComponentElementDataNormalized<P>>
    emotionStyled?: {
      disable?: boolean
      options?: StyledOptions
    }
  }
  // Besigner templates for modeling new elements
  templates?: AglynComponentElementTemplate[]
}

export interface AglynComponentElementData<P = any, Normal extends boolean = false> {
  readonly $id: ElementId
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  parentId?: ElementId
  displayName?: string
  description?: string
  props?: BoxProps<any, P>
  elements?: Conditional<Normal, true, ElementId[], AglynComponentElementData<any, Normal>[]>
}

export interface AglynComponentsBundle {
  readonly bundleId: BundleUId
  componentIds: ComponentId[]
  metadata?: AglynComponentSchema<any>['metadata']
}


export type AglynComponentPropsFormSchema<P = any> = AglynComponentSchema<P>['renderFlags']['propsSchema']
export type AglynComponentHierarchy<P = any> = AglynComponentSchema<P>['renderFlags']['hierarchy']
export type AglynComponentBesignerFlags<P = any> = AglynComponentSchema<P>['besignerFlags']
export type AglynComponentRenderFlags<P = any> = AglynComponentSchema<P>['renderFlags']

export type AglynComponentElementDataDenormalized<P = any> = AglynComponentElementData<P, false>
export type AglynComponentElementDataNormalized<P = any> = AglynComponentElementData<P, true>
export type AglynComponentElementDataNormalizedMap = KeyValueMap<ElementId, AglynComponentElementDataNormalized>
export type AglynComponentElementDataDenormalizedList = AglynComponentElementDataDenormalized[]
export type AglynComponentElementHierarchy<$ID extends ElementId = ElementId> = [root: CANVAS_ROOT_ELEMENT_ID, ...parentIds: [...ElementId[], $ID]]

export type AglynComponentsBundleMetadata = AglynComponentsBundle
export type AglynComponentsBundleSchema = Pick<AglynComponentsBundle, 'bundleId' | 'metadata'>

export interface AglynComponentsControllerOptions extends AglynModuleModelOptions {}

export interface IAglynComponentsController extends IAglynModuleModel<AglynComponentsControllerOptions> {
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
