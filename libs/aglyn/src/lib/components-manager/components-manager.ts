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

import { observable } from 'mobx'
import { AglynEvent, emitter, lifecycleEvent } from '../emit-manager'
import { hasDependency } from '../plugin-manager'
import type {
  ComponentFactory,
  ComponentId,
  ComponentSchema,
} from './component'

export * from './component'

export const factories: Record<ComponentId, ComponentFactory> = observable({})
export const schemas: Record<ComponentId, ComponentSchema> = observable({})

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
  return Object.hasOwn(factories, componentId)
}

export function registerComponent(
  component: ComponentFactory,
  schema: ComponentSchema,
) {
  const { componentId, pluginId } = schema

  lifecycleEvent(
    () => {
      // TODO: throw errorFactory error
      if (pluginId && !hasDependency(pluginId)) {
        throw new Error(`No plugin exists with ID ${pluginId}.`)
      } /* else if (pluginId) {
        const ids = (bundles[pluginId].componentIds ??= [])
        ids.push(componentId)
      }*/
      factories[componentId] = component
      schemas[componentId] = schema
    },
    {
      beforeEvent: AglynEvent.COMPONENT_REGISTERING,
      beforePayload: [{ componentId, pluginId: pluginId }],
      afterEvent: AglynEvent.COMPONENT_REGISTERED,
      afterPayload: [{ componentId, pluginId: pluginId }],
    },
  )
}

export function unregisterComponent(componentId: ComponentId) {
  lifecycleEvent(
    () => {
      if (!componentId || !hasComponent(componentId)) {
        throw new Error(`No component exists with ID ${componentId}.`)
      }
      const { pluginId } = getSchema(componentId)

      if (pluginId && !hasDependency(pluginId)) {
        throw new Error(`No plugin exists with ID ${pluginId}.`)
      } /*else if (pluginId) {
        bundles[pluginId].componentIds = bundles[pluginId].componentIds.filter(
          (i) => i !== componentId,
        )
      }*/
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
