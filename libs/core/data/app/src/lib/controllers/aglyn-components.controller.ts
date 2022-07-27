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
  AglynComponentBundle,
  AglynComponentSchema,
  AglynComponentsControllerOptions,
  AglynModuleEffectListener,
  AglynNodeTemplateSchema,
  BundleId,
  ComponentId,
  ComponentsRegistryContext,
  ComponentsRegistryEntry,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
  IAglynAppController,
  IAglynComponent,
  IAglynComponentsController,
  InstanceBundles,
  InstanceComponents,
  InstanceSchemas,
  InstanceTemplates,
} from '@aglyn/core-data-foundation'
import {
  AglynEventStateFlag,
  AglynEventTriggerFlag,
  type ComponentGetPayload,
  type ComponentRegisterPayload,
  type ComponentsBundleGetPayload,
  type ComponentsBundleRegisterPayload,
  type ComponentsBundleUnregisterPayload,
  type ComponentUnregisterPayload,
} from '@aglyn/core-data-foundation'
import { isAglynComponentElement } from '@aglyn/core-util-app'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { OrUndef } from '@aglyn/shared-data-types'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import { _isArr } from '@aglyn/shared-util-guards'
import { AglynModuleModel } from '../models/aglyn-module.model'

const TAG = 'AglynComponents'
const NS = 'com.aglyn.core.data.framework.controller.components'

export class AglynComponentsController
  extends AglynModuleModel<AglynComponentsControllerOptions>
  implements IAglynComponentsController
{
  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }

  #context: ComponentsRegistryContext = {
    bundles: new Map(),
    components: new Map(),
    schemas: new Map(),
    templates: new Map(),
  }

  public get bundles(): InstanceBundles {
    return this.#context.bundles
  }
  public get components(): InstanceComponents {
    return this.#context.components
  }
  public get schemas(): InstanceSchemas {
    return this.#context.schemas
  }
  public get templates(): InstanceTemplates {
    return this.#context.templates
  }

  protected get listeners(): AglynModuleEffectListener<any>[] {
    return [
      [AglynEventTriggerFlag.COMPONENT_GET, this.getComponent],
      [AglynEventTriggerFlag.COMPONENT_SCHEMA_GET, this.getComponentSchema],
      [AglynEventTriggerFlag.COMPONENTS_GET, this.getAllComponents],
      [AglynEventTriggerFlag.COMPONENTS_BUNDLE_GET, this.getBundle],
      [AglynEventTriggerFlag.COMPONENT_REGISTER, this.registerComponent],
      [AglynEventTriggerFlag.COMPONENT_UNREGISTER, this.unregisterComponent],
      [AglynEventTriggerFlag.COMPONENTS_BUNDLE_REGISTER, this.registerBundle],
      [
        AglynEventTriggerFlag.COMPONENTS_BUNDLE_UNREGISTER,
        this.unregisterBundle,
      ],
    ]
  }

  constructor(
    app: IAglynAppController,
    options: AglynComponentsControllerOptions,
  ) {
    super(app, options)
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      componentIds: this.components?.keys() as any,
      bundles: this.bundles as any,
      schemas: this.schemas as any,
    }
  }

  protected _componentEntries(): ComponentsRegistryEntry[] {
    return [...this.components.entries()]
  }
  protected _componentKeys(): ComponentsRegistryKeys {
    return [...this.components.keys()]
  }
  protected _componentValues(): ComponentsRegistryValues {
    return [...this.components.values()]
  }
  protected _templateValues(): AglynNodeTemplateSchema[] {
    return [...this.templates.values()]
  }

  public getAllComponents(): ComponentsRegistryEntry[] {
    return this._componentEntries()
  }
  public getAllComponentsKeys(): ComponentsRegistryKeys {
    return this._componentKeys()
  }
  public getAllComponentsValues(): ComponentsRegistryValues {
    return this._componentValues()
  }
  public getAllComponentsTemplateValues(): AglynNodeTemplateSchema[] {
    return this._templateValues()
  }

  public getComponent<P, T>(
    payload: ComponentGetPayload,
  ): OrUndef<IAglynComponent<P, T>> {
    const { componentId, bundleId = undefined } = payload
    const key = this.buildMapKey({ bundleId, componentId })
    if (bundleId) {
      return this.components?.get(key) as unknown as OrUndef<
        IAglynComponent<P, T>
      >
    }
    return this.components?.get(key) as unknown as OrUndef<
      IAglynComponent<P, T>
    >
  }
  public getComponentSchema(
    payload: ComponentGetPayload,
  ): OrUndef<AglynComponentSchema> {
    const { componentId, bundleId } = payload
    const key = this.buildMapKey({ bundleId, componentId })
    if (bundleId) {
      return this.schemas?.get(key)
    }
    return this.schemas?.get(key)
  }
  public getBundle(
    payload: ComponentsBundleGetPayload,
  ): OrUndef<AglynComponentBundle> {
    const { bundleId } = payload
    return this.bundles.get(bundleId)
  }
  public buildMapKey(data: {
    componentId: ComponentId
    bundleId: BundleId
  }): string {
    const { componentId, bundleId } = data
    return bundleId ? `${bundleId}:${componentId}` : componentId
  }

  public registerComponent(payload: ComponentRegisterPayload): this {
    const { component, schema } = payload
    const componentId = schema.componentId
    const bundleId = schema.bundleId || undefined
    const key = this.buildMapKey({ bundleId, componentId })

    if (!isAglynComponentElement(component)) {
      // TODO: throw errorFactory error
      throw new Error(`Invalid component provided #'${key}'`)
    }
    this.handleEvent(
      [
        AglynEventStateFlag.COMPONENT_REGISTERING,
        AglynEventStateFlag.COMPONENT_REGISTERED,
      ],
      { componentId, bundleId },
      () => {
        if (bundleId) {
          const bundle = this.bundles.get(bundleId)
          if (bundle) {
            this.components.set(key, component)
            this.schemas.set(key, schema)
            bundle.componentIds.push(componentId)
          } else {
            // TODO: throw errorFactory error
            throw new Error(`Bundle does not exists: (${bundleId})`)
          }
        } else {
          this.components.set(componentId, component)
          this.schemas.set(componentId, schema)
        }
        if (_isArr(schema.templates)) {
          schema.templates.forEach((i) => {
            this.templates.set(i.id, i)
          })
        }
      },
    )
    return this
  }
  public registerBundle(payload: ComponentsBundleRegisterPayload): this {
    const { bundle, components } = payload
    const _bundle: AglynComponentBundle = { ...bundle, componentIds: [] }
    const bundleId: BundleId = _bundle.bundleId
    this.handleEvent(
      [
        AglynEventStateFlag.COMPONENT_BUNDLE_REGISTERING,
        AglynEventStateFlag.COMPONENT_BUNDLE_REGISTERED,
      ],
      { bundleId },
      () => {
        this.bundles.set(bundleId, _bundle)
        ;[...components].forEach(({ schema, component }) => {
          schema.bundleId = bundleId
          this.registerComponent({ schema, component })
        })
      },
    )
    return this
  }

  public unregisterComponent(payload: ComponentUnregisterPayload): this {
    const { componentId, bundleId = undefined } = payload
    const key = this.buildMapKey({ bundleId, componentId })
    this.handleEvent(
      [
        AglynEventStateFlag.COMPONENT_UNREGISTERING,
        AglynEventStateFlag.COMPONENT_UNREGISTERED,
      ],
      { bundleId, componentId },
      () => {
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
          bundle.componentIds = bundle.componentIds.filter(
            (i) => i !== componentId,
          )
          this.bundles.set(bundleId, bundle)
        } else {
          this.schemas.get(componentId)?.templates?.forEach((i) => {
            this.templates.delete(i.id)
          })
          this.schemas.delete(componentId)
          this.components.delete(componentId)
        }
      },
    )
    return this
  }
  public unregisterBundle(payload: ComponentsBundleUnregisterPayload): this {
    const { bundleId } = payload
    const bundle = this.bundles.get(bundleId)
    if (!bundle) {
      throw new Error(`No bundle exists with ID ${bundleId}.`)
      // TODO: throw errorFactory error
    }
    this.handleEvent(
      [
        AglynEventStateFlag.COMPONENT_BUNDLE_UNREGISTERING,
        AglynEventStateFlag.COMPONENT_BUNDLE_UNREGISTERED,
      ],
      { bundleId },
      () => {
        bundle.componentIds.forEach((componentId) => {
          this.unregisterComponent({ componentId, bundleId })
        })
        this.bundles.delete(bundleId)
      },
    )
    return this
  }
}

export default AglynComponentsController
