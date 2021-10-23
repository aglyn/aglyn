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

import { IconId as MdiIconId } from '@aglyn/shared-data-mdi'
import {
  AnyProps,
  JSXIntrinsicElement,
  JSXNode,
  OrUndef,
  ResolveProps,
} from '@aglyn/shared-data-types'
import { StyledOptions } from '@aglyn/shared-feature-themes'
import { FormSchema, InnerRefProp } from '@aglyn/shared-ui-jsx'
import { _isArr } from '@aglyn/shared-util-guards'
import { ComponentClass, FunctionComponent } from 'react'
import {
  AglynAppEffectFlag,
  AglynAppEventFlag,
  ComponentGetPayload,
  ComponentRegisterPayload,
  ComponentsBundleGetPayload,
  ComponentsBundleRegisterPayload,
  ComponentsBundleUnregisterPayload,
  ComponentSchemaGetPayload,
  ComponentUnregisterPayload,
} from '../constants/emitter'
import {
  COMPONENT_ELEMENT_TYPE,
  EXTENSION_TYPE,
  MODULE_TYPE,
  TYPE_KIND,
  TYPE_OF,
} from '../constants/symbol'
import { AglynModuleEffectListener, AglynModuleModel } from '../models/aglyn-module.model'
import { AglynTypeFields } from '../types'
import { isAglynComponentElement } from '../util/aglyn-is'


export type AglynComponentsTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMPONENT_ELEMENT_TYPE>

export type AglynComponentClassElement<P extends AnyProps = any> = ComponentClass<P>
export type AglynComponentFunctionElement<P extends AnyProps = any> = FunctionComponent<P>
export type AglynComponentIntrinsicElement<P extends AnyProps = any> = JSXIntrinsicElement<P>
export type AglynComponentElementType<P extends AnyProps = any> =
  | AglynComponentClassElement<P>
  | AglynComponentFunctionElement<P>
  | AglynComponentIntrinsicElement<P>

export type AppUUN = string
export type ExtensionUUN = string
export type BundleUId = string
export type ComponentId = string
export type CommandUId = string
export type ContextStoreUid = string


export const enum LinealDirectiveFlag {
  LIMIT_TO = 16,
  DISALLOW = 24,
}

export type LinealComponent = ComponentId
export type LinealComponentOfBundle = [bundleId: BundleUId, componentId: ComponentId]
export type LinealBundle = [bundleId: BundleUId]

export type LinealOrder<T extends LinealDirectiveFlag = LinealDirectiveFlag> = [
  type: T,
  definition: (LinealComponent | LinealComponentOfBundle | LinealBundle)[]
]

export type ComponentsRegistryKeys = (ComponentId | [ComponentId, BundleUId])[]
export type ComponentsRegistryValues = AglynComponentElement[]
export type ComponentsRegistryEntry = [
  cId: ComponentId | [ComponentId, BundleUId],
  cmp: AglynComponentElement
]

export interface ComponentsRegistry {
  bundles: Map<BundleUId, AglynComponentsBundle>
  components: Map<ComponentId | [ComponentId, BundleUId], AglynComponentElement>
  schemas: Map<ComponentId | [ComponentId, BundleUId], AglynComponentSchema>
  templates: Map<string, AglynComponentElementTemplateData>
}

export interface AglynComponentsBundle {
  readonly bundleId: BundleUId
  metadata?: {
    displayName: string
    description?: string
    icon?: string
  }
  componentIds: ComponentId[]
}

export interface AglynComponentElement<P extends AnyProps = any>
  extends AglynComponentClassElement<P & InnerRefProp> {
  readonly [TYPE_OF]: typeof MODULE_TYPE
  readonly [TYPE_KIND]: typeof EXTENSION_TYPE
  componentId: ComponentId
  bundleId?: BundleUId
}

export interface AglynComponentMetadata {
  // Metadata
  displayName: string
  title?: string
  subtitle?: string
  description?: string
  icon?: MdiIconId | JSXNode
}

export interface AglynComponentBuilderFlags {
  // Builder feature flags
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

export interface AglynComponentRenderFlags<P extends AnyProps = any> {
  hierarchy?: {
    restrictChildren?: LinealOrder
    restrictParent?: LinealOrder
  }
  elementRef?: { disable?: boolean; innerRef?: boolean }
  propsSchema?: FormSchema
  resolveProps?: ResolveProps<AglynComponentElementData<P>>
  emotionStyled?: {
    disable?: boolean
    options?: StyledOptions<P>
  }
}

export interface AglynComponentSchema<P extends AnyProps = any> {
  componentId: ComponentId
  bundleId?: BundleUId

  // Metadata
  metadata: AglynComponentMetadata

  // Builder feature flags
  builderFlags?: AglynComponentBuilderFlags

  // Render feature flags
  renderFlags?: AglynComponentRenderFlags<P>

  // Builder templates for modeling new elements
  templates?: AglynComponentElementTemplateData<P>[]
}

export interface AglynComponentElementData<P extends AnyProps = any> {
  readonly $id: string
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  displayName?: string
  description?: string
  props?: P
  elements?: AglynComponentElementData<P>[]
}

export interface AglynComponentElementTemplateData<P extends AnyProps = any> {
  readonly id: string
  title: string
  description?: string
  icon?: string
  data: TemplateSubElementData<P>
}

export interface TemplateSubElementData<P extends AnyProps = any> {
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  elements?: TemplateSubElementData<P>[]
  props?: AnyProps
}

export interface AglynComponentsController extends AglynModuleModel {
  getAllComponents(): ComponentsRegistryEntry[]
  getAllComponentsKeys(): ComponentsRegistryKeys
  getAllComponentsValues(): ComponentsRegistryValues
  getAllComponentsTemplateValues(): AglynComponentElementTemplateData[]

  getComponent(payload: ComponentGetPayload): OrUndef<AglynComponentElement>
  getComponentSchema(payload: ComponentSchemaGetPayload): OrUndef<AglynComponentSchema>
  getBundle(payload: ComponentsBundleGetPayload): OrUndef<AglynComponentsBundle>

  registerComponent(payload: ComponentRegisterPayload): this
  registerBundle(payload: ComponentsBundleRegisterPayload): this

  unregisterComponent(payload: ComponentUnregisterPayload): this
  unregisterBundle(payload: ComponentsBundleUnregisterPayload): this
}

const TAG = 'AglynComponents'

export class AglynComponentsController extends AglynModuleModel {

  public static readonly [Symbol.toStringTag]: string = TAG

  public readonly moduleName: string = TAG

  protected context: ComponentsRegistry = {
    bundles: new Map(),
    components: new Map(),
    schemas: new Map(),
    templates: new Map(),
  }

  constructor(options) {super(options)}

  public toString(): string {
    return `${TAG}(app: '${this.app.getName()}')`
  }
  public toJSON() {
    return {
      ...super.toJSON(),
      componentIds: this.context.components?.keys(),
      bundles: this.context.bundles,
      schemas: this.context.schemas,
    }
  }

  protected _componentEntries = (): ComponentsRegistryEntry[] => {
    return [...this.context?.components?.entries()]
  }
  protected _componentKeys = (): ComponentsRegistryKeys => {
    return [...this.context?.components.keys()]
  }
  protected _componentValues = (): ComponentsRegistryValues => {
    return [...this.context?.components?.values()]
  }
  protected _templateValues = (): AglynComponentElementTemplateData[] => {
    return [...this.context?.templates?.values()]
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

  public getComponent = (payload: ComponentGetPayload): OrUndef<AglynComponentElement> => {
    const {componentId, bundleId = undefined} = payload
    const key = this.buildMapKey({bundleId, componentId})
    if (bundleId) {
      return this.context.components?.get(key)
    }
    return this.context.components?.get(key)
  }
  public getComponentSchema = (payload: ComponentGetPayload): OrUndef<AglynComponentSchema> => {
    const {componentId, bundleId} = payload
    const key = this.buildMapKey({bundleId, componentId})
    if (bundleId) {
      return this.context.schemas?.get(key)
    }
    return this.context.schemas?.get(key)
  }
  public getBundle(payload: ComponentsBundleGetPayload): OrUndef<AglynComponentsBundle> {
    const {bundleId} = payload
    return this.context.bundles.get(bundleId)
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
      const bundle = this.context.bundles.get(bundleId)
      if (bundle) {
        this.context.components.set(key, component)
        this.context.schemas.set(key, schema)
        bundle.componentIds.push(componentId)
      }
      else {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
        // TODO: throw errorFactory error
      }
    }
    else {
      this.context.components.set(componentId, component)
      this.context.schemas.set(componentId, schema)
    }
    if (_isArr(schema.templates)) {
      schema.templates.forEach((i) => {
        this.context.templates.set(i.id, i)
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
    this.context.bundles.set(bundleId, _bundle)
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
      const bundle = this.context.bundles.get(bundleId)
      if (!bundle) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
        // TODO: throw errorFactory error
      }
      this.context.schemas.get(key)?.templates?.forEach((i) => {
        this.context.templates.delete(i.id)
      })
      this.context.components.delete(key)
      this.context.schemas.delete(key)
      bundle.componentIds = bundle.componentIds.filter((i) => i !== componentId)
      this.context.bundles.set(bundleId, bundle)
    }
    else {
      this.context.schemas.get(componentId)?.templates?.forEach((i) => {
        this.context.templates.delete(i.id)
      })
      this.context.schemas.delete(componentId)
      this.context.components.delete(componentId)
    }
    this.getLogger().debug(AglynAppEventFlag.COMPONENT_UNREGISTERED, {componentId, bundleId})
    this.getEmitter().emit(AglynAppEventFlag.COMPONENT_UNREGISTERED, {componentId, bundleId})
    return this
  }
  public unregisterBundle(payload: ComponentsBundleUnregisterPayload): this {
    const {bundleId} = payload
    const bundle = this.context.bundles.get(bundleId)
    if (!bundle) {
      throw new Error(`No bundle exists with ID ${bundleId}.`)
      // TODO: throw errorFactory error
    }

    this.getLogger().debug(AglynAppEventFlag.COMPONENT_BUNDLE_UNREGISTERING, {bundleId})
    this.getEmitter().emit(AglynAppEventFlag.COMPONENT_BUNDLE_UNREGISTERING, {bundleId})

    bundle.componentIds.forEach((componentId) => {
      this.unregisterComponent({componentId, bundleId})
    })
    this.context.bundles.delete(bundleId)
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
