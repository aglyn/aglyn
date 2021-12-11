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
import type { IconId as MdiIconId } from '@aglyn/shared-data-mdi'
import type {
  AnyProps, EmptyObj,
  JSXIntrinsicElement,
  OrUndef,
  ResolveProps,
} from '@aglyn/shared-data-types'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { StyledOptions, SxProps } from '@aglyn/shared-feature-themes'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { FormSchema } from '@aglyn/shared-ui-jsx'
import { _isArr } from '@aglyn/shared-util-guards'
import type { ComponentClass, FunctionComponent } from 'react'
import { ForwardRefExoticComponent, PropsWithoutRef, RefAttributes } from 'react'
import type { ComponentsLinealDirectiveFlag } from '../constants/components'
import type {
  ComponentGetPayload,
  ComponentRegisterPayload,
  ComponentsBundleGetPayload,
  ComponentsBundleRegisterPayload,
  ComponentsBundleUnregisterPayload,
  ComponentSchemaGetPayload,
  ComponentUnregisterPayload,
} from '../constants/emitter'
import { AglynAppEffectFlag, AglynAppEventFlag } from '../constants/emitter'
import {
  COMPONENT_ELEMENT_TYPE,
  EXTENSION_TYPE,
  MODULE_TYPE,
  TYPE_KIND,
  TYPE_OF,
} from '../constants/symbol'
import type {
  AglynModuleEffectListener,
  AglynModuleModelOptions,
} from '../models/aglyn-module.model'
import {
  AglynModuleModel,
} from '../models/aglyn-module.model'
import type { AglynTypeFields, BundleUId, ComponentId, ElementId, TemplateId } from '../types'
import { isAglynComponentElement } from '../util/aglyn-is'
import type { AglynAppController } from './aglyn-app.controller'


export type AglynComponentsTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMPONENT_ELEMENT_TYPE>

export type AglynComponentClassElement<P = EmptyObj> = ComponentClass<P>
export type AglynComponentFunctionElement<P = EmptyObj> = FunctionComponent<P>
export type AglynComponentIntrinsicElement<P = EmptyObj> = JSXIntrinsicElement<P>
export type AglynComponentElementType<P = EmptyObj> =
  | AglynComponentClassElement<P>
  | AglynComponentFunctionElement<P>
  | AglynComponentIntrinsicElement<P>


export type LinealDefinition = ComponentId[]
  | { bundles?: BundleUId[], components: ComponentId[] }
  | { bundles: BundleUId[], components?: ComponentId[] }

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
export type InstanceTemplates = Map<TemplateId, AglynComponentElementTemplateData>

export interface ComponentsRegistryContext {
  bundles: InstanceBundles
  components: InstanceComponents
  schemas: InstanceSchemas
  templates: InstanceTemplates
}

export interface AglynComponentsBundle {
  readonly bundleId: BundleUId
  metadata?: {
    displayName: string
    description?: string
    iconIds?: string
  }
  componentIds: ComponentId[]
}

export interface IAglynComponent<P = EmptyObj, T = any>
  extends ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>> {

  readonly [TYPE_OF]?: MODULE_TYPE
  readonly [TYPE_KIND]?: EXTENSION_TYPE
  componentId?: ComponentId
  bundleId?: BundleUId
}

export interface AglynComponentMetadata {
  // Metadata
  displayName: string
  title?: string
  subtitle?: string
  description?: string
  iconIds?: MdiIconId
  iconColor?: string,
}

export interface AglynComponentBesignerFlags {
  // Besigner feature flags
  actions?: { disable?: boolean }
  badge?: { disable?: boolean }
  copying?: { disable?: boolean }
  dragging?: { disable?: boolean }
  dropping?: { disable?: boolean }
  editing?: { disable?: boolean }
  outline?: { disable?: boolean }
  removing?: { disable?: boolean }
  selecting?: { disable?: boolean }
}

export interface AglynComponentPropsFormSchema extends FormSchema {

}

export interface AglynComponentRenderFlags<P = EmptyObj> {
  hierarchy?: {
    restrictChildren?: ComponentsLinealOrder
    restrictParent?: ComponentsLinealOrder
  }
  elementRef?: { disable?: boolean; innerRef?: boolean }
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
  metadata: AglynComponentMetadata

  // Besigner feature flags
  besignerFlags?: AglynComponentBesignerFlags

  // Render feature flags
  renderFlags?: AglynComponentRenderFlags<P>

  // Besigner templates for modeling new elements
  templates?: AglynComponentElementTemplateData<P>[]
}

export interface AglynComponentElementTemplateData<P = EmptyObj> {
  readonly id: TemplateId
  label: string
  description?: string
  iconIds?: MdiIconId
  iconColor?: string,
  data: TemplateSubElementData<P>
}

export interface TemplateSubElementData<P = EmptyObj> {
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  elements?: TemplateSubElementData<P>[]
  props?: AnyProps
}

export interface AglynComponentElementData<P = EmptyObj> {
  readonly $id: ElementId
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  parentId?: ElementId
  displayName?: string
  description?: string
  props?: { sx?: SxProps } & P
  elements?: (AglynComponentElementDataDenormalized<P>[]) | (ElementId[])
}

export interface AglynComponentElementDataDenormalized<P = any> extends AglynComponentElementData<P> {
  elements?: AglynComponentElementDataDenormalized<P>[]
}

export interface AglynComponentElementDataNormalized<P = any> extends AglynComponentElementData<P> {
  elements?: ElementId[]
}

export interface AglynComponentsControllerOptions extends AglynModuleModelOptions {

}

export interface AglynComponentsController extends AglynModuleModel {
  getAllComponents(): ComponentsRegistryEntry[]
  getAllComponentsKeys(): ComponentsRegistryKeys
  getAllComponentsValues(): ComponentsRegistryValues
  getAllComponentsTemplateValues(): AglynComponentElementTemplateData[]

  getComponent(payload: ComponentGetPayload): OrUndef<IAglynComponent>
  getComponentSchema(payload: ComponentSchemaGetPayload): OrUndef<AglynComponentSchema>
  getBundle(payload: ComponentsBundleGetPayload): OrUndef<AglynComponentsBundle>

  registerComponent(payload: ComponentRegisterPayload): this
  registerBundle(payload: ComponentsBundleRegisterPayload): this

  unregisterComponent(payload: ComponentUnregisterPayload): this
  unregisterBundle(payload: ComponentsBundleUnregisterPayload): this
}

const TAG = 'AglynComponents'
const MODULE_NAME = 'components'

export class AglynComponentsController extends AglynModuleModel<AglynComponentsControllerOptions> {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly namespace: string = MODULE_NAME
  public static readonly moduleName: string = MODULE_NAME

  #context: ComponentsRegistryContext = {
    bundles: new Map(),
    components: new Map(),
    schemas: new Map(),
    templates: new Map(),
  }

  public get bundles(): InstanceBundles {return this.#context.bundles}
  public get components(): InstanceComponents {return this.#context.components}
  public get schemas(): InstanceSchemas {return this.#context.schemas}
  public get templates(): InstanceTemplates {return this.#context.templates}

  constructor(app: AglynAppController, options: AglynComponentsControllerOptions) {
    super(app, options)
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      componentIds: this.components?.keys(),
      bundles: this.bundles,
      schemas: this.schemas,
    }
  }

  protected _componentEntries = (): ComponentsRegistryEntry[] => {
    return [...this.components?.entries()]
  }
  protected _componentKeys = (): ComponentsRegistryKeys => {
    return [...this.components.keys()]
  }
  protected _componentValues = (): ComponentsRegistryValues => {
    return [...this.components?.values()]
  }
  protected _templateValues = (): AglynComponentElementTemplateData[] => {
    return [...this.templates?.values()]
  }

  public getAllComponents = (): ComponentsRegistryEntry[] => {
    return this._componentEntries()
  }
  public getAllComponentsKeys = (): ComponentsRegistryKeys => {
    return this._componentKeys()
  }
  public getAllComponentsValues = (): ComponentsRegistryValues => {
    return this._componentValues()
  }
  public getAllComponentsTemplateValues = (): AglynComponentElementTemplateData[] => {
    return this._templateValues()
  }

  public getComponent = (payload: ComponentGetPayload): OrUndef<IAglynComponent> => {
    const {componentId, bundleId = undefined} = payload
    const key = this.buildMapKey({bundleId, componentId})
    if (bundleId) {
      return this.components?.get(key)
    }
    return this.components?.get(key)
  }
  public getComponentSchema = (payload: ComponentGetPayload): OrUndef<AglynComponentSchema> => {
    const {componentId, bundleId} = payload
    const key = this.buildMapKey({bundleId, componentId})
    if (bundleId) {
      return this.schemas?.get(key)
    }
    return this.schemas?.get(key)
  }
  public getBundle(payload: ComponentsBundleGetPayload): OrUndef<AglynComponentsBundle> {
    const {bundleId} = payload
    return this.bundles.get(bundleId)
  }
  public buildMapKey(data: { componentId: ComponentId, bundleId: BundleUId }): string {
    const {componentId, bundleId} = data
    return bundleId ? `${bundleId}:${componentId}` : componentId
  }

  public registerComponent = (payload: ComponentRegisterPayload): this => {
    const {component, schema} = payload
    const componentId = schema.componentId
    const bundleId = schema.bundleId || undefined
    const key = this.buildMapKey({bundleId, componentId})

    if (!isAglynComponentElement(component)) {
      throw new Error(`Invalid component #'${key}' supplied to register.`)
      // TODO: throw errorFactory error
    }

    this.getLogger().debug(AglynAppEventFlag.COMPONENT_REGISTERING, {componentId, bundleId})
    this.getEmitter().emit(AglynAppEventFlag.COMPONENT_REGISTERING, {componentId, bundleId})

    if (bundleId) {
      const bundle = this.bundles.get(bundleId)
      if (bundle) {
        this.components.set(key, component)
        this.schemas.set(key, schema)
        bundle.componentIds.push(componentId)
      }
      else {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
        // TODO: throw errorFactory error
      }
    }
    else {
      this.components.set(componentId, component)
      this.schemas.set(componentId, schema)
    }
    if (_isArr(schema.templates)) {
      schema.templates.forEach((i) => {
        this.templates.set(i.id, i)
      })
    }
    this.getLogger().debug(AglynAppEventFlag.COMPONENT_REGISTERED, {componentId, bundleId})
    this.getEmitter().emit(AglynAppEventFlag.COMPONENT_REGISTERED, {componentId, bundleId})
    return this
  }
  public registerBundle = (payload: ComponentsBundleRegisterPayload): this => {
    const {bundle, components} = payload
    const _bundle: AglynComponentsBundle = {...bundle, componentIds: []}
    const bundleId: BundleUId = _bundle.bundleId
    this.getLogger().debug(AglynAppEventFlag.COMPONENT_BUNDLE_REGISTERING, {bundleId})
    this.getEmitter().emit(AglynAppEventFlag.COMPONENT_BUNDLE_REGISTERING, {bundleId})
    this.bundles.set(bundleId, _bundle)
    ;([...components]).forEach(({schema, component}) => {
      schema.bundleId = bundleId
      this.registerComponent({schema, component})
    })
    this.getLogger().debug(AglynAppEventFlag.COMPONENT_BUNDLE_REGISTERED, {bundleId})
    this.getEmitter().emit(AglynAppEventFlag.COMPONENT_BUNDLE_REGISTERED, {bundleId})
    return this
  }

  public unregisterComponent = (payload: ComponentUnregisterPayload): this => {
    const {componentId, bundleId = undefined} = payload
    const key = this.buildMapKey({bundleId, componentId})

    this.getLogger().debug(AglynAppEventFlag.COMPONENT_UNREGISTERING, {componentId, bundleId})
    this.getEmitter().emit(AglynAppEventFlag.COMPONENT_UNREGISTERING, {componentId, bundleId})

    if (bundleId) {
      const bundle = this.bundles.get(bundleId)
      if (!bundle) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
        // TODO: throw errorFactory error
      }
      this.schemas.get(key)?.templates?.forEach((i) => {
        this.templates.delete(i.id)
      })
      this.components.delete(key)
      this.schemas.delete(key)
      bundle.componentIds = bundle.componentIds.filter((i) => i !== componentId)
      this.bundles.set(bundleId, bundle)
    }
    else {
      this.schemas.get(componentId)?.templates?.forEach((i) => {
        this.templates.delete(i.id)
      })
      this.schemas.delete(componentId)
      this.components.delete(componentId)
    }
    this.getLogger().debug(AglynAppEventFlag.COMPONENT_UNREGISTERED, {componentId, bundleId})
    this.getEmitter().emit(AglynAppEventFlag.COMPONENT_UNREGISTERED, {componentId, bundleId})
    return this
  }
  public unregisterBundle(payload: ComponentsBundleUnregisterPayload): this {
    const {bundleId} = payload
    const bundle = this.bundles.get(bundleId)
    if (!bundle) {
      throw new Error(`No bundle exists with ID ${bundleId}.`)
      // TODO: throw errorFactory error
    }

    this.getLogger().debug(AglynAppEventFlag.COMPONENT_BUNDLE_UNREGISTERING, {bundleId})
    this.getEmitter().emit(AglynAppEventFlag.COMPONENT_BUNDLE_UNREGISTERING, {bundleId})

    bundle.componentIds.forEach((componentId) => {
      this.unregisterComponent({componentId, bundleId})
    })
    this.bundles.delete(bundleId)
    this.getLogger().debug(AglynAppEventFlag.COMPONENT_BUNDLE_UNREGISTERED, {bundleId})
    this.getEmitter().emit(AglynAppEventFlag.COMPONENT_BUNDLE_UNREGISTERED, {bundleId})
    return this
  }


  protected listeners: AglynModuleEffectListener<any>[] = [
    [AglynAppEffectFlag.COMPONENT_GET, this.getComponent],
    [AglynAppEffectFlag.COMPONENT_SCHEMA_GET, this.getComponentSchema],
    [AglynAppEffectFlag.COMPONENTS_GET, this.getAllComponents],
    [AglynAppEffectFlag.COMPONENTS_BUNDLE_GET, this.getBundle],
    [AglynAppEffectFlag.COMPONENT_REGISTER, this.registerComponent],
    [AglynAppEffectFlag.COMPONENT_UNREGISTER, this.unregisterComponent],
    [AglynAppEffectFlag.COMPONENTS_BUNDLE_REGISTER, this.registerBundle],
    [AglynAppEffectFlag.COMPONENTS_BUNDLE_UNREGISTER, this.unregisterBundle],
  ]
}

export type AglynComponentsControllerT = typeof AglynComponentsController
export default AglynComponentsController
