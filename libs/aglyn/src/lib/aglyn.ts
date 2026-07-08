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

/** Wires the runtime's own event handlers; must run once per instance. */
function wireRuntime(instance: Aglyn): Aglyn {
  const { logger, components, canvas, plugins } = instance

  instance.prependListener(['error', '**'], (...payload) => {
    logger.error(Timestamp.now().toJSON(), ...payload)
  })

  instance.on(AglynEvent.PLUGIN_REGISTER, ({ plugin }) => {
    plugins.addDependency(plugin)
  })
  instance.on(AglynEvent.PLUGIN_UNREGISTER, ({ pluginId }) => {
    plugins.removeDependency(pluginId)
  })

  instance.on(AglynEvent.COMPONENT_REGISTER, ({ component, schema }) => {
    components.registerComponent(component, schema)
  })
  instance.on(AglynEvent.COMPONENT_UNREGISTER, ({ componentId }) => {
    components.unregisterComponent(componentId)
  })

  instance.on(AglynEvent.PRESET_REGISTER, ({ preset }) => {
    components.registerPreset(preset)
  })
  instance.on(AglynEvent.PRESET_UNREGISTER, ({ presetId }) => {
    components.unregisterPreset(presetId)
  })

  instance.on(AglynEvent.NODE_CLEAR_ITEMS, () => {
    canvas.clearNodes()
  })
  instance.on(AglynEvent.NODE_SET_ITEMS, ({ nodes }) => {
    canvas.setNodes(nodes)
  })
  instance.on(AglynEvent.NODE_SET, ({ node, create }) => {
    canvas.setNode(node, create)
  })
  instance.on(AglynEvent.NODE_DELETE, ({ node }) => {
    canvas.deleteNode(node)
  })
  instance.on(AglynEvent.NODE_DUPLICATE, ({ node }) => {
    canvas.duplicateNode(node)
  })
  instance.on(AglynEvent.NODE_REPARENT, ({ node, newParent, index }) => {
    canvas.reparentNode(node, newParent, index)
  })
  return instance
}

/**
 * Duplication-proof singleton (AGL-53). A module-scoped `new Aglyn()` is
 * evaluated once PER MODULE COPY — and Next.js can legitimately produce
 * more than one copy in a page's graph: a `'use client'` directive splits
 * the module into the server and client graphs, and the lib's dual
 * ESM/CJS builds are two different module ids to the bundler (the classic
 * dual-package hazard). The tenant app hit exactly this: the page filled
 * one copy's canvas while the components rendered from the other, hydrating
 * an empty page. Keying the instance on `globalThis` under `Symbol.for`
 * (the same pattern mobx/graphql use) makes every copy in a JS realm
 * resolve to one instance, and `wireRuntime` runs once so event handlers
 * never double-fire. SSR semantics are unchanged: the instance was already
 * shared across requests in a warm server process (AGL-51's per-request
 * render-fill resets canvas state per render, and still does).
 *
 * The console app tolerated the duplication only because its editor and
 * canvas both live in the client graph, so they always got the same copy.
 */
const AGLYN_RUNTIME_KEY = Symbol.for('@aglyn/aglyn:runtime')

type GlobalWithAglyn = typeof globalThis & {
  [AGLYN_RUNTIME_KEY]?: Aglyn
}

const globalScope = globalThis as GlobalWithAglyn

export const aglyn: Aglyn =
  globalScope[AGLYN_RUNTIME_KEY] ??
  (globalScope[AGLYN_RUNTIME_KEY] = wireRuntime(new Aglyn()))

export const { logger, components, emitter, canvas, plugins } = aglyn
