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

import { _hasOwnProperty } from '@aglyn/shared-util-guards'
import { AglynEvent, emitter, lifecycleEvent } from '../emit-manager'
import { bundles } from '../plugin-manager'
import { ComponentId, ComponentSchema, ComponentType } from './component'

export const factories: Record<ComponentId, ComponentType> = {}
export const schemas: Record<ComponentId, ComponentSchema> = {}

emitter.on(AglynEvent.COMPONENT_REGISTER, ({ component, schema }) => {
  registerComponent(component, schema)
})
emitter.on(AglynEvent.COMPONENT_UNREGISTER, ({ componentId }) => {
  unregisterComponent(componentId)
})

export function getFactory(componentId: ComponentId) {
  return factories[componentId]
}

export function getSchema(componentId: ComponentId) {
  return schemas[componentId]
}

export function hasComponent(componentId: ComponentId) {
  return componentId && _hasOwnProperty(componentId, schemas)
}

export function registerComponent(
  component: ComponentType,
  schema: ComponentSchema,
) {
  const { componentId, bundleId } = schema

  lifecycleEvent(
    () => {
      // TODO: throw errorFactory error
      if (bundleId && !bundles.hasBundle(bundleId)) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
      } else if (bundleId) {
        const ids = (bundles[bundleId].componentIds ??= [])
        ids.push(componentId)
      }
      factories[componentId] = component
      schemas[componentId] = schema
    },
    {
      beforeEvent: AglynEvent.COMPONENT_REGISTERING,
      beforePayload: [{ componentId, bundleId }],
      afterEvent: AglynEvent.COMPONENT_REGISTERED,
      afterPayload: [{ componentId, bundleId }],
    },
  )
}

export function unregisterComponent(componentId: ComponentId) {
  lifecycleEvent(
    () => {
      if (!componentId || !hasComponent(componentId)) {
        throw new Error(`No component exists with ID ${componentId}.`)
      }
      const { bundleId } = getSchema(componentId)

      if (bundleId && !bundles.hasBundle(bundleId)) {
        throw new Error(`No bundle exists with ID ${bundleId}.`)
      } else if (bundleId) {
        bundles[bundleId].componentIds = bundles[bundleId].componentIds.filter(
          (i) => i !== componentId,
        )
      }
      delete schemas[componentId]
      delete factories[componentId]
    },
    {
      beforeEvent: AglynEvent.COMPONENT_UNREGISTERING,
      beforePayload: [{ componentId }],
      afterEvent: AglynEvent.COMPONENT_UNREGISTERED,
      afterPayload: [{ componentId }],
    },
  )
}
