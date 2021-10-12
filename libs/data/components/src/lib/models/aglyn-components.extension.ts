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

import { AglynExtensionModel, IAglynApp } from '@aglyn/data-framework'
import { OrUndef } from '@aglyn/shared-data-types'
import { _isArr } from '@aglyn/shared-util-guards'

import {
  AglynComponentElementTemplateData,
  AglynComponentEventFlag,
  ComponentsRegistry,
  ComponentsRegistryEntry,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
  GetBundlePayload,
  GetComponentPayload,
  IAglynComponentElement,
  IAglynComponentsBundle,
  IAglynComponentSchema,
  IAglynComponentsExtension,
  RegisterBundlePayload,
  RegisterComponentPayload,
  UnregisterBundlePayload,
  UnregisterComponentPayload,
} from '../aglyn-components.types'


const TAG = 'AglynComponentsExtension'

export default class AglynComponentsExtension
  extends AglynExtensionModel<ComponentsRegistry>
  implements IAglynComponentsExtension {
  //start: overrides
  public static readonly $id: string = 'components'
  public static readonly [Symbol.toStringTag]: string = TAG
  protected context: ComponentsRegistry = {
    bundles: new Map(),
    components: new Map(),
    schemas: new Map(),
    templates: new Map(),
  }
  public onInit: (app: IAglynApp) => void = (app: IAglynApp): void => {
    this.listeners.forEach(([flag, method]) => app.getEmitter().on(flag, method))
  }
  public onDestroy: (app: IAglynApp) => void = (app: IAglynApp): void => {
    this.listeners.forEach(([flag, method]) => app.getEmitter().off(flag, method))
  }
  public toJSON = () => {
    return {
      ...super.toJSON(),
      componentIds: this.context.components?.keys(),
      bundles: this.context.bundles,
      schemas: this.context.schemas,
    }
  }
  //end: overrides

  //start: constructor
  constructor(app: IAglynApp) {
    super(app, {autoload: true})
  }
  //end: constructor

  //start: abstract + overridden
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
      return this.context.components?.get([componentId, bundleId])
    }
    return this.context.components?.get(componentId)
  }
  public getComponentSchema = (payload: GetComponentPayload): OrUndef<IAglynComponentSchema> => {
    const {componentId, bundleId} = payload
    if (bundleId) {
      return this.context.schemas?.get([componentId, bundleId])
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
      this.context.components.set([componentId, bundleId], component)
      this.context.schemas.set([componentId, bundleId], schema)
      bundle.components.push(componentId)
    }
    else {
      this.context.components.set(componentId, component)
      this.context.schemas.set(componentId, schema)
    }
    if (_isArr(schema.templates)) {
      schema.templates.forEach((i) => {
        this.context.templates.set([i.id, componentId, bundleId], i)
      })
      return this
    }
    return this
  }
  public registerBundle = (payload: RegisterBundlePayload): this => {
    const {bundle} = payload
    this.context.bundles.set(bundle.bundleId, bundle)
    return this
  }

  public unregisterComponent = (payload: UnregisterComponentPayload): this => {
    const {componentId, bundleId = undefined} = payload
    if (bundleId) {
      const bundle = this.context.bundles.get(bundleId)
      if (!bundle) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
      }
      bundle.components = bundle.components.filter(i => i !== componentId)
      this.context.bundles.set(bundleId, bundle)
      this.context.components.delete([componentId, bundleId])
      this.context.schemas.delete([componentId, bundleId])

      for (const [id, cid, bid] of this.context.templates.keys()) {
        if ((!bundleId || bundleId === bid) && componentId === cid) {
          this.context.templates.delete([id, cid, bid])
        }
      }
    }
    else {
      this.context.components.delete(componentId)
      this.context.schemas.delete(componentId)

      for (const [id, cid] of this.context.templates.keys()) {
        if (componentId === cid) {
          this.context.templates.delete([id, cid])
        }
      }
    }
    return this
  }
  public unregisterBundle(payload: UnregisterBundlePayload): this {
    const {bundleId} = payload
    const bundle = this.context.bundles.get(bundleId)
    if (!bundle) {
      throw new Error(`No bundle exists with ID ${bundleId}.`)
    }
    bundle.components.forEach(componentId => {
      this.unregisterComponent({componentId, bundleId})
    })
    this.context.bundles.delete(bundleId)
    return this
  }


  private listeners: [AglynComponentEventFlag, (...args: any[]) => unknown][] = [
    [AglynComponentEventFlag.COMPONENT_REGISTER, this.registerComponent],
    [AglynComponentEventFlag.COMPONENT_UNREGISTER, this.unregisterComponent],
    [AglynComponentEventFlag.COMPONENTS_BUNDLE_REGISTER, this.registerBundle],
    [AglynComponentEventFlag.COMPONENTS_BUNDLE_UNREGISTER, this.unregisterBundle],
  ]
  //end: abstract + overridden

  //start: not public
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
  //end: not public
}

export { AglynComponentsExtension }
