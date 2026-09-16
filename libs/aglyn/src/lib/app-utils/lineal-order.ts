/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { LinealDirectiveFlag } from '../foundation/definitions/components.types'
import type {
  ComponentId,
  ComponentsLinealOrder,
  PluginId,
} from '../foundation/definitions/components.types'

/** A directive as a schema declares it, or as the generated palette carries it. */
/**
 * A lineal order as a JSON emitter writes it (AGL-2905): the directive as
 * the enum's string value rather than the enum, so a generated catalog can
 * carry it and a validator can read it back without the enum in scope.
 */
export type JsonLinealOrder = [
  directiveType: `${LinealDirectiveFlag}`,
  directiveDefinition: string[] | { plugins?: string[]; components?: string[] },
]

export type LinealOrderLike = ComponentsLinealOrder | JsonLinealOrder

/**
 * Which half of a lineal directive a candidate fails, or `null` when the
 * directive admits it.
 *
 * `restrictChildren` and `restrictParent` are one grammar — a `limitedTo` or
 * `forbid` flag over a component list, a plugin list, or both — read from two
 * sides: the besigner's drop check asks it about a dragged element, and the
 * AI node-tree validator asks it about a node a model emitted. The answer has
 * to be the same answer, so the rule lives here with no editor attached and
 * both callers read it (AGL-2905).
 *
 * A `limitedTo` list that is present but empty admits nothing — that is how a
 * component declares it takes no children at all (`layoutSlot`), and the
 * child-contract audit reads the same shape the same way.
 */
export function checkLinealOrder(
  componentId: ComponentId | undefined,
  pluginId: PluginId | undefined,
  order: LinealOrderLike,
): 'component' | 'plugin' | null {
  const [directiveType, directiveDefinition] = order
  const flag: string = directiveType
  const components = Array.isArray(directiveDefinition)
    ? directiveDefinition
    : directiveDefinition?.components
  const plugins = Array.isArray(directiveDefinition)
    ? undefined
    : directiveDefinition?.plugins

  if (flag === LinealDirectiveFlag.DISALLOW) {
    if (components?.some((id) => id === componentId)) return 'component'
    if (plugins?.some((id) => id === pluginId)) return 'plugin'
    return null
  }

  if (flag === LinealDirectiveFlag.LIMIT_TO) {
    if (
      Array.isArray(components) &&
      (components.length === 0 || !components.some((id) => id === componentId))
    ) {
      return 'component'
    }
    if (
      Array.isArray(plugins) &&
      (plugins.length === 0 || !plugins.some((id) => id === pluginId))
    ) {
      return 'plugin'
    }
  }

  return null
}

/**
 * Whether `child` may sit directly under `parent`, reading the child's
 * `restrictParent` and the parent's `restrictChildren` — the two directives
 * the besigner's drop check consults, in that order.
 */
export function linealRelationshipPermits(
  child: {
    componentId?: ComponentId
    pluginId?: PluginId
    restrictParent?: LinealOrderLike
  },
  parent: {
    componentId?: ComponentId
    pluginId?: PluginId
    restrictChildren?: LinealOrderLike
  },
): boolean {
  if (
    child.restrictParent &&
    checkLinealOrder(parent.componentId, parent.pluginId, child.restrictParent)
  ) {
    return false
  }
  if (
    parent.restrictChildren &&
    checkLinealOrder(child.componentId, child.pluginId, parent.restrictChildren)
  ) {
    return false
  }
  return true
}
