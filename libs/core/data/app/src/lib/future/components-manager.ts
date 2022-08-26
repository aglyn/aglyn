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

import {
  AglynBundleSchema,
  AglynComponentSchema,
  AglynComponentType,
  AglynNodePresetSchema,
  BundleId,
  ComponentId,
  PresetId,
} from '@aglyn/core-data-foundation'
import Aglyn, { AglynEvent } from './aglyn'

export class ComponentManager {
  static #bundles: Record<BundleId, AglynBundleSchema> = {}
  public static get bundles(): Record<BundleId, AglynBundleSchema> {
    return this.#bundles
  }

  static #components: Record<ComponentId, AglynComponentType> = {}
  public static get components(): Record<ComponentId, AglynComponentType> {
    return this.#components
  }

  static #componentSchemas: Record<ComponentId, AglynComponentSchema> = {}
  public static get componentSchemas(): Record<
    ComponentId,
    AglynComponentSchema
  > {
    return this.#componentSchemas
  }

  static #presets: Record<PresetId, AglynNodePresetSchema> = {}
  public static get presets(): Record<PresetId, AglynNodePresetSchema> {
    return this.#presets
  }

  constructor() {}

  public toJSON() {
    return {
      bundles: ComponentManager.#bundles,
      components: ComponentManager.#components,
      schemas: ComponentManager.#componentSchemas,
      presets: ComponentManager.#presets,
    }
  }

  public static buildId(componentId: ComponentId, bundleId?: BundleId): string {
    return bundleId ? `${bundleId}:${componentId}` : componentId
  }

  public static getBundle(bundleId: BundleId) {
    return this.bundles[bundleId]
  }
  public static getComponent(componentId: ComponentId, bundleId?: BundleId) {
    const key = this.buildId(componentId, bundleId)
    return this.#components[key]
  }
  public static getComponentSchema(
    componentId: ComponentId,
    bundleId?: BundleId,
  ) {
    const key = this.buildId(componentId, bundleId)
    return this.#componentSchemas[key]
  }
  public static getPreset(presetId: PresetId) {
    return this.#presets[presetId]
  }

  public static registerBundle(
    schema: AglynBundleSchema,
    components: {
      component: AglynComponentType
      schema: AglynComponentSchema
    }[],
  ) {
    const { bundleId } = schema
    Aglyn.lifecycleEvent(
      () => {
        this.#bundles[bundleId] = schema
        for (const { component, schema } of components) {
          this.registerComponent(component, { ...schema, bundleId })
        }
      },
      {
        startEvent: AglynEvent.COMPONENT_BUNDLE_REGISTERING,
        startPayload: [{ bundleId }],
        endEvent: AglynEvent.COMPONENT_BUNDLE_REGISTERED,
        endPayload: [{ bundleId }],
      },
    )
    return this
  }

  public static registerComponent(
    component: AglynComponentType,
    schema: AglynComponentSchema,
  ) {
    const { componentId, bundleId } = schema
    const key = this.buildId(schema.componentId, schema.bundleId)

    Aglyn.lifecycleEvent(
      () => {
        // TODO: throw errorFactory error
        if (bundleId && !this.#bundles[bundleId]) {
          throw new Error(`No bundle exists with ID ${bundleId}.`)
        } else if (bundleId) {
          this.#bundles[bundleId].componentIds.push(key)
        }
        this.#components[key] = component
        this.#componentSchemas[key] = schema
        for (const preset of schema.presets || []) {
          this.registerPreset(preset)
        }
      },
      {
        startEvent: AglynEvent.COMPONENT_REGISTERING,
        startPayload: [{ componentId, bundleId }],
        endEvent: AglynEvent.COMPONENT_REGISTERED,
        endPayload: [{ componentId, bundleId }],
      },
    )
    return this
  }

  public static registerPreset(preset: AglynNodePresetSchema) {
    const { presetId, bundleId, componentId } = preset
    Aglyn.lifecycleEvent(
      () => {
        this.#presets[presetId] = preset
      },
      {
        startEvent: AglynEvent.COMPONENT_PRESET_REGISTERING,
        startPayload: [{ bundleId, componentId, presetId }],
        endEvent: AglynEvent.COMPONENT_PRESET_REGISTERED,
        endPayload: [{ bundleId, componentId, presetId }],
      },
    )
    return this
  }

  public static unregisterPreset(presetId: PresetId) {
    Aglyn.lifecycleEvent(
      () => {
        delete this.#presets[presetId]
      },
      {
        startEvent: AglynEvent.COMPONENT_PRESET_UNREGISTERING,
        startPayload: [{ presetId }],
        endEvent: AglynEvent.COMPONENT_PRESET_UNREGISTERED,
        endPayload: [{ presetId }],
      },
    )
    return this
  }

  public static unregisterComponentPresets(componentId: ComponentId) {
    const schema = this.#componentSchemas[componentId]
    for (const preset of schema?.presets || []) {
      this.unregisterPreset(preset?.presetId)
    }
    return this
  }

  public static unregisterComponent(
    componentId: ComponentId,
    bundleId?: BundleId,
  ) {
    Aglyn.lifecycleEvent(
      () => {
        // TODO: throw errorFactory error
        if (bundleId && !this.#bundles[bundleId]) {
          throw new Error(`No bundle exists with ID ${bundleId}.`)
        } else if (bundleId) {
          this.#bundles[bundleId].componentIds = this.#bundles[
            bundleId
          ].componentIds.filter((i) => i !== componentId)
        }
        const key = this.buildId(componentId, bundleId)
        this.unregisterComponentPresets(key)
        delete this.#componentSchemas[key]
        delete this.#components[key]
      },
      {
        startEvent: AglynEvent.COMPONENT_UNREGISTERING,
        startPayload: [{ bundleId, componentId }],
        endEvent: AglynEvent.COMPONENT_UNREGISTERED,
        endPayload: [{ bundleId, componentId }],
      },
    )

    return this
  }

  public static unregisterBundle(bundleId: BundleId) {
    const bundle = this.bundles[bundleId]
    // TODO: throw errorFactory error
    if (!bundle) throw new Error(`No bundle exists with ID ${bundleId}.`)
    Aglyn.lifecycleEvent(
      () => {
        for (const componentId of bundle.componentIds) {
          this.unregisterComponent(componentId, bundleId)
        }
        delete this.bundles[bundleId]
      },
      {
        startEvent: AglynEvent.COMPONENT_BUNDLE_UNREGISTERING,
        startPayload: [{ bundleId }],
        endEvent: AglynEvent.COMPONENT_BUNDLE_UNREGISTERED,
        endPayload: [{ bundleId }],
      },
    )

    return this
  }
}

export default ComponentManager
