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
  AglynAppEventFlag,
  AglynModuleActionFlag,
  GetBundlePayload,
  GetComponentPayload,
  GetComponentSchemaPayload,
  RegisterBundlePayload,
  RegisterComponentPayload,
  UnregisterBundlePayload,
  UnregisterComponentPayload,
} from '../constants/emitter'
import { RestrictFlag } from '../constants/enums'
import {
  COMPONENTS_TYPE,
  EXTENSION_TYPE,
  MODULE_TYPE,
  TYPE_KIND,
  TYPE_OF,
} from '../constants/symbol'
import { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynBaseModel } from '../models/aglyn-base.model'
import { AglynTypeFields } from '../types'


const TAG = 'ComponentsExtension'

export type AglynComponentsTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMPONENTS_TYPE>

export type AglynComponentClassElement<P extends AnyProps = any> = ComponentClass<P>
export type AglynComponentFunctionElement<P extends AnyProps = any> = FunctionComponent<P>
export type AglynComponentIntrinsicElement<P extends AnyProps = any> = JSXIntrinsicElement<P>
export type AglynComponentElementType<P extends AnyProps = any> =
  | AglynComponentClassElement<P>
  | AglynComponentFunctionElement<P>
  | AglynComponentIntrinsicElement<P>

export type BundleId = string
export type ComponentId = string

export type HierarchyRestriction = [
  type: RestrictFlag,
  componentIds: (ComponentId | [ComponentId, BundleId])[]
]

export type ComponentsRegistryKeys = (ComponentId | [ComponentId, BundleId])[]
export type ComponentsRegistryValues = AglynComponentElement[]
export type ComponentsRegistryEntry = [
  cId: ComponentId | [ComponentId, BundleId],
  cmp: AglynComponentElement
]

export interface ComponentsRegistry {
  bundles: Map<BundleId, AglynComponentsBundle>
  components: Map<ComponentId | [ComponentId, BundleId], AglynComponentElement>
  schemas: Map<ComponentId | [ComponentId, BundleId], AglynComponentSchema>
  templates: Map<string, AglynComponentElementTemplateData>
}

export interface AglynComponentsBundle {
  readonly bundleId: BundleId
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
  bundleId?: BundleId
}

export interface AglynComponentSchema<P extends AnyProps = any> {
  componentId: ComponentId
  bundleId?: BundleId

  // Metadata
  metadata: {
    displayName: string
    title?: string
    subtitle?: string
    description?: string
    icon?: MdiIconId | JSXNode
  }

  // Builder feature flags
  builderFlags?: {
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

  // Render feature flags
  renderFlags?: {
    hierarchy?: {
      restrictChildren?: HierarchyRestriction
      restrictParent?: HierarchyRestriction
    }
    elementRef?: { disable?: boolean; innerRef?: boolean }
    propsSchema?: FormSchema
    resolveProps?: ResolveProps<AglynComponentElementData<P>>
    emotionStyled?: {
      disable?: boolean
      options?: StyledOptions<P>
    }
  }

  templates?: AglynComponentElementTemplateData<P>[]
}

export interface AglynComponentElementData<P extends AnyProps = any> {
  readonly $id: string
  readonly componentId: ComponentId
  readonly bundleId?: BundleId
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
  readonly bundleId?: BundleId
  elements?: TemplateSubElementData<P>[]
  props?: AnyProps
}

export interface AglynComponentsController extends AglynBaseModel {
  getAllComponents(): ComponentsRegistryEntry[]
  getAllComponentsKeys(): ComponentsRegistryKeys
  getAllComponentsValues(): ComponentsRegistryValues

  getTemplateBlocks(): AglynComponentElementTemplateData[]

  getComponent(payload: GetComponentPayload): OrUndef<AglynComponentElement>
  getComponentSchema(payload: GetComponentSchemaPayload): OrUndef<AglynComponentSchema>
  getBundle(payload: GetBundlePayload): OrUndef<AglynComponentsBundle>

  registerComponent(payload: RegisterComponentPayload): this
  registerBundle(payload: RegisterBundlePayload): this

  unregisterComponent(payload: UnregisterComponentPayload): this
  unregisterBundle(payload: UnregisterBundlePayload): this
}

export class AglynComponentsController extends AglynBaseModel {

  public static readonly [Symbol.toStringTag]: string = TAG

  protected app: AglynAppController
  protected context: ComponentsRegistry = {
    bundles: new Map(),
    components: new Map(),
    schemas: new Map(),
    templates: new Map(),
  }

  constructor(props: { app: AglynAppController }) {
    super()
    const {app} = props
    this.app = app
    this.#setup()
  }
  #setup() {
    this.setErrorFactory(this.app.getErrorFactory())
    this.setEmitter(this.app.getEmitter())
    this.setLogger(this.app.getLogger())
  }

  public aglynOnInit = (): void => {
    this.listeners.forEach(([flag, method]) => this.app.getEmitter().on(flag, method))
  }
  public aglynOnDestroy = (): void => {
    this.listeners.forEach(([flag, method]) => this.app.getEmitter().off(flag, method))
  }

  public toString = (): string => {
    return `${TAG}(app: '${this.app.getName()}')`
  }
  public toJSON = () => {
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
  public getTemplateBlocks = (): AglynComponentElementTemplateData[] => {
    return this._templateValues()
  }

  public getComponent = (payload: GetComponentPayload): OrUndef<AglynComponentElement> => {
    const {componentId, bundleId = undefined} = payload
    if (bundleId) {
      return this.context.components?.get(`${bundleId}:${componentId}`)
    }
    return this.context.components?.get(componentId)
  }
  public getComponentSchema = (payload: GetComponentPayload): OrUndef<AglynComponentSchema> => {
    const {componentId, bundleId} = payload
    if (bundleId) {
      return this.context.schemas?.get(`${bundleId}:${componentId}`)
    }
    return this.context.schemas?.get(componentId)
  }
  public getBundle(payload: GetBundlePayload): OrUndef<AglynComponentsBundle> {
    const {bundleId} = payload
    return this.context.bundles.get(bundleId)
  }

  public registerComponent = (payload: RegisterComponentPayload): this => {
    const {component, schema} = payload
    const componentId = schema.componentId
    const bundleId = schema.bundleId || undefined

    if (bundleId) {
      const bundle = this.context.bundles.get(bundleId)
      if (!bundle) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
      }
      this.context.components.set(`${bundleId}:${componentId}`, component)
      this.context.schemas.set(`${bundleId}:${componentId}`, schema)
      bundle.componentIds.push(componentId)
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
    this.getLogger().debug(AglynAppEventFlag.REGISTERED_COMPONENT, {componentId, bundleId})
    this.getEmitter().emit(AglynAppEventFlag.REGISTERED_COMPONENT, {componentId, bundleId})
    return this
  }
  public registerBundle = (payload: RegisterBundlePayload): this => {
    const {bundle, components} = payload
    const _bundle: AglynComponentsBundle = {...bundle, componentIds: []}
    const bundleId: BundleId = _bundle.bundleId
    this.context.bundles.set(bundleId, _bundle)
    ;([...components]).forEach(({schema, component}) => {
      schema.bundleId = bundleId
      this.registerComponent({schema, component})
    })
    this.getLogger().debug(AglynAppEventFlag.REGISTERED_COMPONENT_BUNDLE, {bundleId})
    this.getEmitter().emit(AglynAppEventFlag.REGISTERED_COMPONENT_BUNDLE, {bundleId})
    return this
  }

  public unregisterComponent = (payload: UnregisterComponentPayload): this => {
    const {componentId, bundleId = undefined} = payload
    if (bundleId) {
      const bundle = this.context.bundles.get(bundleId)
      if (!bundle) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
      }
      this.context.schemas.get(`${bundleId}:${componentId}`)?.templates?.forEach((i) => {
        this.context.templates.delete(i.id)
      })
      this.context.components.delete(`${componentId}:${bundleId}`)
      this.context.schemas.delete(`${componentId}:${bundleId}`)
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
    this.getLogger().debug(AglynAppEventFlag.UNREGISTERED_COMPONENT, {componentId, bundleId})
    this.getEmitter().emit(AglynAppEventFlag.UNREGISTERED_COMPONENT, {componentId, bundleId})
    return this
  }
  public unregisterBundle(payload: UnregisterBundlePayload): this {
    const {bundleId} = payload
    const bundle = this.context.bundles.get(bundleId)
    if (!bundle) {
      throw new Error(`No bundle exists with ID ${bundleId}.`)
    }
    bundle.componentIds.forEach((componentId) => {
      this.unregisterComponent({componentId, bundleId})
    })
    this.context.bundles.delete(bundleId)
    this.getLogger().debug(AglynAppEventFlag.UNREGISTERED_COMPONENT_BUNDLE, {bundleId})
    this.getEmitter().emit(AglynAppEventFlag.UNREGISTERED_COMPONENT_BUNDLE, {bundleId})
    return this
  }


  private listeners: [AglynModuleActionFlag, (...args: any[]) => unknown][] = [
    [AglynModuleActionFlag.COMPONENT_REGISTER, this.registerComponent],
    [AglynModuleActionFlag.COMPONENT_UNREGISTER, this.unregisterComponent],
    [AglynModuleActionFlag.COMPONENTS_BUNDLE_REGISTER, this.registerBundle],
    [AglynModuleActionFlag.COMPONENTS_BUNDLE_UNREGISTER, this.unregisterBundle],
  ]
}

export default AglynComponentsController
