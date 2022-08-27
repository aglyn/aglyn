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

import { AglynEvent, emitter, lifecycleEvent } from '../emit-manager'
import {
  BundleId,
  BundleSchema,
  ComponentId,
  ComponentSchema,
  ComponentType,
  PresetId,
  PresetSchema,
} from './component'

export const bundles: Record<BundleId, BundleSchema> = {}
export const components: Record<ComponentId, ComponentType> = {}
export const componentSchemas: Record<ComponentId, ComponentSchema> = {}
export const presets: Record<PresetId, PresetSchema> = {}

function buildId(componentId: ComponentId, bundleId?: BundleId): string {
  return bundleId ? `${bundleId}:${componentId}` : componentId
}

export function getBundle(bundleId: BundleId) {
  return bundles[bundleId]
}

export function getComponent(componentId: ComponentId, bundleId?: BundleId) {
  const key = buildId(componentId, bundleId)
  return components[key]
}

export function getComponentSchema(
  componentId: ComponentId,
  bundleId?: BundleId,
) {
  const key = buildId(componentId, bundleId)
  return componentSchemas[key]
}

export function getPreset(presetId: PresetId) {
  return presets[presetId]
}

export function registerBundle(
  schema: BundleSchema,
  components: {
    component: ComponentType
    schema: ComponentSchema
  }[],
) {
  const { bundleId } = schema
  lifecycleEvent(
    () => {
      bundles[bundleId] = schema
      for (const { component, schema } of components) {
        registerComponent(component, { ...schema, bundleId })
      }
    },
    {
      startEvent: AglynEvent.COMPONENT_BUNDLE_REGISTERING,
      startPayload: [{ bundleId }],
      endEvent: AglynEvent.COMPONENT_BUNDLE_REGISTERED,
      endPayload: [{ bundleId }],
    },
  )
}

export function registerComponent(
  component: ComponentType,
  schema: ComponentSchema,
) {
  const { componentId, bundleId } = schema
  const key = buildId(schema.componentId, schema.bundleId)

  lifecycleEvent(
    () => {
      // TODO: throw errorFactory error
      if (bundleId && !bundles[bundleId]) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
      } else if (bundleId) {
        bundles[bundleId].componentIds.push(key)
      }
      components[key] = component
      componentSchemas[key] = schema
      for (const preset of schema.presets || []) {
        registerPreset(preset)
      }
    },
    {
      startEvent: AglynEvent.COMPONENT_REGISTERING,
      startPayload: [{ componentId, bundleId }],
      endEvent: AglynEvent.COMPONENT_REGISTERED,
      endPayload: [{ componentId, bundleId }],
    },
  )
}

export function registerPreset(preset: PresetSchema) {
  const { presetId, bundleId, componentId } = preset
  lifecycleEvent(
    () => {
      presets[presetId] = preset
    },
    {
      startEvent: AglynEvent.COMPONENT_PRESET_REGISTERING,
      startPayload: [{ bundleId, componentId, presetId }],
      endEvent: AglynEvent.COMPONENT_PRESET_REGISTERED,
      endPayload: [{ bundleId, componentId, presetId }],
    },
  )
}

export function unregisterPreset(presetId: PresetId) {
  lifecycleEvent(
    () => {
      delete presets[presetId]
    },
    {
      startEvent: AglynEvent.COMPONENT_PRESET_UNREGISTERING,
      startPayload: [{ presetId }],
      endEvent: AglynEvent.COMPONENT_PRESET_UNREGISTERED,
      endPayload: [{ presetId }],
    },
  )
}

export function unregisterComponentPresets(componentId: ComponentId) {
  const schema = componentSchemas[componentId]
  for (const preset of schema?.presets || []) {
    unregisterPreset(preset?.presetId)
  }
}

export function unregisterComponent(
  componentId: ComponentId,
  bundleId?: BundleId,
) {
  lifecycleEvent(
    () => {
      // TODO: throw errorFactory error
      if (bundleId && !bundles[bundleId]) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
      } else if (bundleId) {
        bundles[bundleId].componentIds = bundles[bundleId].componentIds.filter(
          (i) => i !== componentId,
        )
      }
      const key = buildId(componentId, bundleId)
      unregisterComponentPresets(key)
      delete componentSchemas[key]
      delete components[key]
    },
    {
      startEvent: AglynEvent.COMPONENT_UNREGISTERING,
      startPayload: [{ bundleId, componentId }],
      endEvent: AglynEvent.COMPONENT_UNREGISTERED,
      endPayload: [{ bundleId, componentId }],
    },
  )
}

export function unregisterBundle(bundleId: BundleId) {
  const bundle = bundles[bundleId]
  // TODO: throw errorFactory error
  if (!bundle) throw new Error(`No bundle exists with ID ${bundleId}.`)
  lifecycleEvent(
    () => {
      for (const componentId of bundle.componentIds) {
        unregisterComponent(componentId, bundleId)
      }
      delete bundles[bundleId]
    },
    {
      startEvent: AglynEvent.COMPONENT_BUNDLE_UNREGISTERING,
      startPayload: [{ bundleId }],
      endEvent: AglynEvent.COMPONENT_BUNDLE_UNREGISTERED,
      endPayload: [{ bundleId }],
    },
  )
}

emitter.on(AglynEvent.REGISTER_COMPONENT, ({ component, schema }) => {
  registerComponent(component, schema)
})
