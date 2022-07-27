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
  AnyObj,
  Conditional,
  Dictionary,
  OrUndef,
} from '@aglyn/shared-data-types'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type {
  ConditionDefinition,
  DataType,
  FieldActions,
  ResolvePropsFunction,
  Validator,
} from '@aglyn/shared-ui-jsx-forms'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { MdiIconProps } from '@aglyn/shared-ui-mdi-jsx' // eslint-disable-next-line
// @nrwl/nx/enforce-module-boundaries
import type { MuiStyledOptions } from '@aglyn/shared-ui-theme'
// @nrwl/nx/enforce-module-boundaries
import type { ComponentClass, ComponentProps, ElementType } from 'react'
import type { CANVAS_ROOT_ELEMENT_ID } from '../constants/canvas'
import type {
  ComponentCategory,
  ComponentsLinealDirectiveFlag,
  FieldComponentType,
} from '../constants/components'
import type {
  ComponentGetPayload,
  ComponentRegisterPayload,
  ComponentsBundleGetPayload,
  ComponentsBundleRegisterPayload,
  ComponentsBundleUnregisterPayload,
  ComponentSchemaGetPayload,
  ComponentUnregisterPayload,
} from '../constants/emitter'
import type { FEATURE_FLAG } from '../constants/shared'
import type { OF_KIND, OF_TYPE, SYMBOL_TYPE } from '../constants/symbol'
import type { IAglynAppController } from './app.types'
import type {
  AglynModuleModelOptions,
  AglynModuleModelT,
  IAglynModuleModel,
} from './module.types'

export type BundleId = string
export type ComponentId = string
export type TemplateId = string
export type NodeId = string
export type ComponentIdOrBundleTuple = ComponentId | [ComponentId, BundleId]

export type ComponentsRegistryKeys = ComponentIdOrBundleTuple[]
export type ComponentsRegistryValues = IAglynComponent[]
export type ComponentsRegistryEntry = [
  id: ComponentIdOrBundleTuple,
  component: IAglynComponent,
]
export type InstanceBundles = Map<BundleId, AglynComponentBundle>
export type InstanceComponents = Map<ComponentIdOrBundleTuple, IAglynComponent>
export type InstanceSchemas = Map<
  ComponentIdOrBundleTuple,
  AglynComponentSchema
>
export type InstanceTemplates = Map<TemplateId, AglynNodeTemplateSchema>

export type ComponentsLinealOrder<
  T extends ComponentsLinealDirectiveFlag = ComponentsLinealDirectiveFlag,
> = [
  directiveType: T,
  directiveDefinition:
    | ComponentId[]
    | { bundles?: BundleId[]; components: ComponentId[] }
    | { bundles: BundleId[]; components?: ComponentId[] },
]

export type AglynComponentPropsFormSchema<P = any> =
  AglynComponentSchema<P>['formSchema']
export type AglynComponentHierarchy<P = any> =
  AglynComponentSchema<P>['hierarchy']
export type AglynComponentHierarchyFlags<P = any> =
  AglynComponentSchema<P>['hierarchy']
export type AglynComponentsBundleMetadata = AglynComponentBundle
export type AglynComponentsBundleSchema = Omit<
  AglynComponentBundle,
  'componentIds'
>

export interface IAglynComponent<P = any, T = any>
  extends JSX.ForwardRefExoticComponent<
    JSX.PropsWithoutRef<P> & JSX.RefAttributes<T>
  > {
  [OF_TYPE]?: SYMBOL_TYPE
  [OF_KIND]?: SYMBOL_TYPE
  aglyn?: boolean
  componentId?: ComponentId
  bundleId?: BundleId
}

export type AglynComponentType<
  P extends ComponentProps<C> | any = any,
  C extends keyof JSX.IntrinsicElements | JSX.ElementConstructor<any> = any,
> =
  | ComponentClass<P>
  | JSX.ElementConstructor<P>
  | keyof JSX.IntrinsicElements[keyof JSX.IntrinsicElements]

export type AglynElementsById<T = AglynNodeSchema> = {
  [K in T extends AglynNodeSchema<any, any> ? T['$id'] : never]: T & { $id: K }
}
export type AglynElementsList<T = AglynNodeSchema> = T[]

export type AglynElementDenormalized<
  P = any,
  D extends ElementType = any,
> = AglynNodeSchema<P, true, D>

export type AglynElementNormalized<
  P = any,
  D extends ElementType = any,
> = AglynNodeSchema<P, false, D>

export type AglynElementsDenormalized =
  AglynElementsById<AglynElementDenormalized>
export type AglynElementsNormalized = AglynElementsList<AglynElementNormalized>

export type AglynElementHierarchy<
  $ID extends Conditional<
    NodeId,
    CANVAS_ROOT_ELEMENT_ID,
    never,
    NodeId
  > = NodeId,
> = [
  root?: CANVAS_ROOT_ELEMENT_ID,
  ...rootDescendents: [
    ...elementAncestors: Conditional<
      NodeId,
      CANVAS_ROOT_ELEMENT_ID,
      never,
      NodeId
    >[],
    element: $ID,
  ],
]

export interface AglynComponentsControllerOptions
  extends AglynModuleModelOptions {}

export interface IAglynComponentsController
  extends IAglynModuleModel<AglynComponentsControllerOptions> {
  readonly bundles: InstanceBundles
  readonly components: InstanceComponents
  readonly schemas: InstanceSchemas
  readonly templates: InstanceTemplates

  getAllComponents(): ComponentsRegistryEntry[]
  getAllComponentsKeys(): ComponentsRegistryKeys
  getAllComponentsValues(): ComponentsRegistryValues
  getAllComponentsTemplateValues(): AglynNodeTemplateSchema[]

  getComponent<P, T>(
    payload: ComponentGetPayload,
  ): OrUndef<IAglynComponent<P, T>>
  getComponentSchema(
    payload: ComponentSchemaGetPayload,
  ): OrUndef<AglynComponentSchema>
  getBundle(payload: ComponentsBundleGetPayload): OrUndef<AglynComponentBundle>
  buildMapKey(data: { componentId: ComponentId; bundleId: BundleId }): string

  registerComponent(payload: ComponentRegisterPayload): this
  registerBundle(payload: ComponentsBundleRegisterPayload): this

  unregisterComponent(payload: ComponentUnregisterPayload): this
  unregisterBundle(payload: ComponentsBundleUnregisterPayload): this
}

export interface AglynComponentsControllerT
  extends AglynModuleModelT<AglynComponentsControllerOptions> {
  new (
    app: IAglynAppController,
    options: AglynComponentsControllerOptions,
  ): IAglynComponentsController
}

export interface AglynComponentSchema<P = any> {
  componentId: ComponentId
  bundleId?: BundleId

  displayName: string
  title?: string
  subtitle?: string
  description?: string

  /**
   * Icon props for display around besigner
   */
  icon?: MdiIconProps
  /**
   * Options to be passed to styled(Component, \{...styledOptions\})
   */
  styledOptions?: MuiStyledOptions

  /**
   * Lineal restrictions
   */
  hierarchy?: {
    /**
     * Define a limitation for elements allowed as direct descendents
     */
    restrictChildren?: ComponentsLinealOrder
    /**
     * Define a limitation for elements allowed to be direct ancestors
     */
    restrictParent?: ComponentsLinealOrder
  }

  /**
   * Filter props
   */
  resolveProps?: JSX.ResolveProps<AglynElementDenormalized<P>>

  /**
   * Attribute fields to modify the contextual properties
   */
  formSchema?: {
    fields: AglynFieldSchema[]
  }

  /**
   * Feature flags
   */
  flags?: {
    /**
     * Disable the use of emotion styled
     */
    emotion?: FEATURE_FLAG
    /**
     * Can the elements of this component type be cloned?
     */
    cloning?: FEATURE_FLAG
    /**
     * Allow dragging elements of this component type
     */
    dragging?: FEATURE_FLAG
    /**
     * Allow dropping elements inside elements of this component type
     */
    dropping?: FEATURE_FLAG
    /**
     * Allow editing element attributes of this component type
     */
    editing?: FEATURE_FLAG
    /**
     * Allow removing elements of this component type
     */
    removing?: FEATURE_FLAG
    /**
     * Describe elements of this component type to be self-closing
     */
    selfClosing?: FEATURE_FLAG
  }

  /**
   * Template items are the available items to add to the canvas
   */
  templates?: AglynNodeTemplateSchema[]
}

export interface AglynFieldSchema extends Dictionary<any> {
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

export type AglynNodeTemplateSchema = {
  id: TemplateId
  label: string
  description?: string
  icon?: MdiIconProps
  category?: string | ComponentCategory
  data: Omit<AglynNodeSchema<any, false>, '$id'>
}

export interface AglynNodeSchema<
  P = JSX.AnyProps,
  C extends boolean = true,
  D extends ElementType = any,
> {
  $id: NodeId
  componentId: ComponentId
  bundleId?: BundleId
  parentId?: NodeId
  sx?: JSX.SxProps
  props?: P
  elements?: NodeId[] | AglynNodeSchema<P, C>
}

/**
 * @TODO ⚠️ Migrate to simplified interface
 */
export interface AglynNodeSchema2 {
  $id: NodeId
  kind?: 'element'
  bundle?: BundleId
  component?: ComponentId
  tag?: keyof JSX.IntrinsicElements | string
  props?: AnyObj
  sx?: JSX.SxProps
  children?: AglynNodeSchema2[]
}

export interface AglynComponentBundle {
  readonly bundleId: BundleId
  componentIds: ComponentId[]
  // Metadata
  displayName: string
  title?: string
  subtitle?: string
  description?: string
  icon?: MdiIconProps
}

export type ComponentsRegistryContext = {
  bundles: InstanceBundles
  components: InstanceComponents
  schemas: InstanceSchemas
  templates: InstanceTemplates
}
