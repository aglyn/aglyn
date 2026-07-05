/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { Logger } from '@aglyn/shared-util-logger'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import CanvasManager from './canvas-manager'
import ComponentManager from './components-manager'
import EmitManager, { AglynEvent } from './emit-manager'
import { namespace } from './foundation'
import PluginManager from './plugin-manager'

export * from './types'
export * from './utils'

export * from './components-manager'
export * from './emit-manager'
export * from './plugin-manager'
export * from './canvas-manager'

export class Aglyn extends EmitManager {
  logger: Logger
  emitter: this
  plugins: PluginManager
  components: ComponentManager
  canvas: CanvasManager
  constructor() {
    super()
    this.logger = new Logger(namespace)
    this.emitter = this
    this.plugins = new PluginManager(this)
    this.components = new ComponentManager(this)
    this.canvas = new CanvasManager(this)
  }
}

export const aglyn = new Aglyn()

export const { logger, components, emitter, canvas, plugins } = aglyn

emitter.prependListener(['error', '**'], (...payload) => {
  logger.error(Timestamp.now().toJSON(), ...payload)
})

emitter.on(AglynEvent.PLUGIN_REGISTER, ({ plugin }) => {
  plugins.addDependency(plugin)
})
emitter.on(AglynEvent.PLUGIN_UNREGISTER, ({ pluginId }) => {
  plugins.removeDependency(pluginId)
})

emitter.on(AglynEvent.COMPONENT_REGISTER, ({ component, schema }) => {
  components.registerComponent(component, schema)
})
emitter.on(AglynEvent.COMPONENT_UNREGISTER, ({ componentId }) => {
  components.unregisterComponent(componentId)
})

emitter.on(AglynEvent.PRESET_REGISTER, ({ preset }) => {
  components.registerPreset(preset)
})
emitter.on(AglynEvent.PRESET_UNREGISTER, ({ presetId }) => {
  components.unregisterPreset(presetId)
})

emitter.on(AglynEvent.NODE_CLEAR_ITEMS, () => {
  canvas.clearNodes()
})
emitter.on(AglynEvent.NODE_SET_ITEMS, ({ nodes }) => {
  canvas.setNodes(nodes)
})
emitter.on(AglynEvent.NODE_SET, ({ node, create }) => {
  canvas.setNode(node, create)
})
emitter.on(AglynEvent.NODE_DELETE, ({ node }) => {
  canvas.deleteNode(node)
})
emitter.on(AglynEvent.NODE_DUPLICATE, ({ node }) => {
  canvas.duplicateNode(node)
})
emitter.on(AglynEvent.NODE_REPARENT, ({ node, newParent, index }) => {
  canvas.reparentNode(node, newParent, index)
})
