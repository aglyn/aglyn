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

import { ComponentManager } from './components-manager'
import { AglynEvent, emitter } from './emit-manager'
import { ScreenManager } from './screen-manager'
import { UAManager } from './ua-manager'

export * from './constants'
export * from './types'
export * from './utils'

export * from './components-manager'
export * from './emit-manager'
export * from './plugin-manager'
export * from './screen-manager'
export * from './ua-manager'

export const components = new ComponentManager()

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

export const screen = new ScreenManager()

emitter.on(AglynEvent.NODE_CLEAR_ITEMS, () => {
  screen.clearNodes()
})
emitter.on(AglynEvent.NODE_SET_ITEMS, ({ nodes }) => {
  screen.setNodes(nodes)
})
emitter.on(AglynEvent.NODE_SET, ({ node, create }) => {
  screen.setNode(node, create)
})
emitter.on(AglynEvent.NODE_DELETE, ({ node }) => {
  screen.deleteNode(node)
})
emitter.on(AglynEvent.NODE_DUPLICATE, ({ node }) => {
  screen.duplicateNode(node)
})
emitter.on(AglynEvent.NODE_REPARENT, ({ node, newParent, index }) => {
  screen.reparentNode(node, newParent, index)
})

export const ua = new UAManager()

console.log('this/ aglyn', this)
