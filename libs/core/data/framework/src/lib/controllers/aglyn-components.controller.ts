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
import { FormSchema, InnerRefProp } from '@aglyn/shared-ui-jsx'
import { _isArr } from '@aglyn/shared-util-guards'
import { ComponentClass, FunctionComponent } from 'react'
import {
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


export type AglynComponentClassElement<P = any> = ComponentClass<P>
export type AglynComponentFunctionElement<P = any> = FunctionComponent<P>
export type AglynComponentIntrinsicElement<P = any> = JSXIntrinsicElement<P>
export type AglynComponentElementType<P = any> =
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
export type ComponentsRegistryValues = IAglynComponentElement[]
export type ComponentsRegistryEntry = [
  cId: ComponentId | [ComponentId, BundleId],
  cmp: IAglynComponentElement
]

export interface ComponentsRegistry {
  bundles: Map<BundleId, IAglynComponentsBundle>
  components: Map<ComponentId | [ComponentId, BundleId], IAglynComponentElement>
  schemas: Map<ComponentId | [ComponentId, BundleId], IAglynComponentSchema>
  templates: Map<string, AglynComponentElementTemplateData>
}

export interface IAglynComponentsBundle {
  readonly bundleId: BundleId
  metadata?: {
    displayName: string
    description?: string
    icon?: string
  }
  components: ComponentId[]
}

export interface IAglynComponentElement<P = any>
  extends AglynComponentClassElement<P & InnerRefProp> {
  readonly [TYPE_OF]: typeof MODULE_TYPE
  readonly [TYPE_KIND]: typeof EXTENSION_TYPE
  componentId: ComponentId
  bundleId?: BundleId
}

export interface IAglynComponentSchema<P = any> {
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
    styled?: { disable?: boolean }
    elementRef?: { disable?: boolean; innerRef?: boolean }
    propsSchema?: FormSchema
    resolveProps?: ResolveProps<P>
  }

  templates?: AglynComponentElementTemplateData[]
}

export interface AglynComponentElementData {
  readonly $id: string
  readonly componentId: ComponentId
  readonly bundleId?: BundleId
  displayName?: string
  description?: string
  props?: AnyProps
  elements?: AglynComponentElementData[]
}

export interface AglynComponentElementTemplateData {
  readonly id: string
  title: string
  description?: string
  icon?: string
  data: TemplateSubElementData
}

export interface TemplateSubElementData {
  readonly componentId: ComponentId
  readonly bundleId?: BundleId
  elements?: TemplateSubElementData[]
  props?: AnyProps
}

export interface AglynComponentsController extends AglynBaseModel {
  getAllComponents(): ComponentsRegistryEntry[]
  getAllComponentsKeys(): ComponentsRegistryKeys
  getAllComponentsValues(): ComponentsRegistryValues

  getTemplateBlocks(): AglynComponentElementTemplateData[]

  getComponent(payload: GetComponentPayload): OrUndef<IAglynComponentElement>
  getComponentSchema(payload: GetComponentSchemaPayload): OrUndef<IAglynComponentSchema>
  getBundle(payload: GetBundlePayload): OrUndef<IAglynComponentsBundle>

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
    this.#initialize()
  }
  #initialize() {
    this.setErrorFactory(this.app.getErrorFactory())
    this.setEmitter(this.app.getEmitter())
    this.setLogger(this.app.getLogger())
  }

  public onInit = (): void => {
    this.listeners.forEach(([flag, method]) => this.app.getEmitter().on(flag, method))
  }
  public onDestroy = (): void => {
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
    return [...this._templateValues()]
  }

  public getComponent = (payload: GetComponentPayload): OrUndef<IAglynComponentElement> => {
    const {componentId, bundleId = undefined} = payload
    if (bundleId) {
      return this.context.components?.get(`${componentId}:${bundleId}`)
    }
    return this.context.components?.get(componentId)
  }
  public getComponentSchema = (payload: GetComponentPayload): OrUndef<IAglynComponentSchema> => {
    const {componentId, bundleId} = payload
    if (bundleId) {
      return this.context.schemas?.get(`${componentId}:${bundleId}`)
    }
    return this.context.schemas?.get(componentId)
  }
  public getBundle(payload: GetBundlePayload): OrUndef<IAglynComponentsBundle> {
    const {bundleId} = payload
    return this.context.bundles.get(bundleId)
  }

  public registerComponent = (payload: RegisterComponentPayload): this => {
    const {component, schema} = payload
    const componentId = component.componentId
    const bundleId = component.bundleId || undefined

    if (bundleId) {
      const bundle = this.context.bundles.get(bundleId)
      if (!bundle) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
      }
      this.context.components.set(`${componentId}:${bundleId}`, component)
      this.context.schemas.set(`${componentId}:${bundleId}`, schema)
      bundle.components.push(componentId)
    }
    else {
      this.context.components.set(componentId, component)
      this.context.schemas.set(componentId, schema)
    }
    if (_isArr(schema.templates)) {
      schema.templates.forEach((i) => {
        this.context.templates.set(i.id, i)
      })
      return this
    }
    return this
  }
  public registerBundle = (payload: RegisterBundlePayload): this => {
    const {bundle, components} = payload
    const bundleId = bundle.bundleId
    this.context.bundles.set(bundleId, bundle)
    components.forEach(({schema, component}) => {
      this.registerComponent({schema, component})
    })
    return this
  }

  public unregisterComponent = (payload: UnregisterComponentPayload): this => {
    const {componentId, bundleId = undefined} = payload
    if (bundleId) {
      const bundle = this.context.bundles.get(bundleId)
      if (!bundle) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
      }
      this.context.schemas.get(`${componentId}:${bundleId}`)?.templates?.forEach((i) => {
        this.context.templates.delete(i.id)
      })
      this.context.components.delete(`${componentId}:${bundleId}`)
      this.context.schemas.delete(`${componentId}:${bundleId}`)
      bundle.components = bundle.components.filter((i) => i !== componentId)
      this.context.bundles.set(bundleId, bundle)
    }
    else {
      this.context.schemas.get(componentId)?.templates?.forEach((i) => {
        this.context.templates.delete(i.id)
      })
      this.context.schemas.delete(componentId)
      this.context.components.delete(componentId)
    }
    return this
  }
  public unregisterBundle(payload: UnregisterBundlePayload): this {
    const {bundleId} = payload
    const bundle = this.context.bundles.get(bundleId)
    if (!bundle) {
      throw new Error(`No bundle exists with ID ${bundleId}.`)
    }
    bundle.components.forEach((componentId) => {
      this.unregisterComponent({componentId, bundleId})
    })
    this.context.bundles.delete(bundleId)
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
