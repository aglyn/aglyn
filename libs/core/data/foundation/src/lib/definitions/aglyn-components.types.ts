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
  OrUndef,
  ResolveProps,
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
import type { MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { BoxProps, MuiStyledOptions } from '@aglyn/shared-ui-theme'
import type {
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
import { FEATURE_FLAG } from '../constants/shared'
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
export type ComponentsRegistryEntry = [
  id: ComponentIdOrBundleTuple,
  component: IAglynComponent,
]
export type InstanceBundles = Map<BundleUId, AglynComponentsBundle>
export type InstanceComponents = Map<ComponentIdOrBundleTuple, IAglynComponent>
export type InstanceSchemas = Map<
  ComponentIdOrBundleTuple,
  AglynComponentSchema
>
export type InstanceTemplates = Map<TemplateId, AglynComponentElementTemplate>

export type ComponentsLinealOrder<
  T extends ComponentsLinealDirectiveFlag = ComponentsLinealDirectiveFlag,
> = [
  directiveType: T,
  directiveDefinition:
    | ComponentId[]
    | { bundles?: BundleUId[]; components: ComponentId[] }
    | { bundles: BundleUId[]; components?: ComponentId[] },
]

export type AglynComponentElementTemplate = {
  id: TemplateId
  label: string
  description?: string
  icon?: MdiIconProps
  data: AglynComponentTemplateData<any>
}

export type AglynComponentPropsFormSchema<P = any> =
  AglynComponentSchema<P>['formSchema']
export type AglynComponentHierarchy<P = any> =
  AglynComponentSchema<P>['hierarchy']
export type AglynComponentHierarchyFlags<P = any> =
  AglynComponentSchema<P>['hierarchy']
export type AglynComponentsBundleMetadata = AglynComponentsBundle
export type AglynComponentsBundleSchema = Omit<
  AglynComponentsBundle,
  'componentIds'
>

export type ComponentsRegistryContext = {
  bundles: InstanceBundles
  components: InstanceComponents
  schemas: InstanceSchemas
  templates: InstanceTemplates
}

export interface IAglynComponent<P = any, T = any>
  extends JSX.ForwardRefExoticComponent<
    JSX.PropsWithoutRef<P> & JSX.RefAttributes<T>
  > {
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

export interface AglynComponentSchema<P = any> {
  componentId: ComponentId
  bundleId?: BundleUId

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
  resolveProps?: ResolveProps<AglynElementDenormalized<P>>

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
  templates?: AglynComponentElementTemplate[]

  /**
   * Attribute fields to modify the contextual properties
   */
  formSchema?: {
    fields: AglynComponentField[]
  }
}

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
  getAllComponentsTemplateValues(): AglynComponentElementTemplate[]

  getComponent<P, T>(
    payload: ComponentGetPayload,
  ): OrUndef<IAglynComponent<P, T>>
  getComponentSchema(
    payload: ComponentSchemaGetPayload,
  ): OrUndef<AglynComponentSchema>
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
    options: AglynComponentsControllerOptions,
  ): IAglynComponentsController
}
