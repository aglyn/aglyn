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

import type * as Aglyn from '@aglyn/aglyn'
import { components, LinealDirectiveFlag } from '@aglyn/aglyn'
import { _isArr, _isArrEmpty } from '@aglyn/shared-util-tools'

export enum InvalidLinealRelationFlag {
  DISALLOW = 0x01,
  LIMIT_TO = 0x02,

  ITEM = 0x04,
  PARENT = 0x08,

  COMPONENT = 0x10,
  BUNDLE = 0x20,

  DISALLOW_COMPONENT = DISALLOW | COMPONENT,
  DISALLOW_BUNDLE = DISALLOW | BUNDLE,
  LIMIT_TO_COMPONENT = LIMIT_TO | COMPONENT,
  LIMIT_TO_BUNDLE = LIMIT_TO | BUNDLE,

  DISALLOW_COMPONENT_ITEM = DISALLOW_COMPONENT | ITEM,
  DISALLOW_BUNDLE_ITEM = DISALLOW_BUNDLE | ITEM,
  LIMIT_TO_COMPONENT_ITEM = LIMIT_TO_COMPONENT | ITEM,
  LIMIT_TO_BUNDLE_ITEM = LIMIT_TO_BUNDLE | ITEM,

  DISALLOW_COMPONENT_PARENT = DISALLOW_COMPONENT | PARENT,
  DISALLOW_BUNDLE_PARENT = DISALLOW_BUNDLE | PARENT,
  LIMIT_TO_COMPONENT_PARENT = LIMIT_TO_COMPONENT | PARENT,
  LIMIT_TO_BUNDLE_PARENT = LIMIT_TO_BUNDLE | PARENT,
}

export type ConfirmValidLinealRelationshipResponse =
  | [isValid: true]
  | [isValid: false, reason: InvalidLinealRelationFlag]

function validateLinealOrder(
  componentId: Aglyn.ComponentId,
  pluginId: Aglyn.PluginId,
  linealOrder: Aglyn.ComponentsLinealOrder,
  governor:
    | typeof InvalidLinealRelationFlag.ITEM
    | typeof InvalidLinealRelationFlag.PARENT,
) {
  const [directiveType, directiveDefinition] = linealOrder
  const definition = {
    components: _isArr(directiveDefinition)
      ? [...directiveDefinition]
      : directiveDefinition?.components,
    plugins: _isArr(directiveDefinition)
      ? undefined
      : directiveDefinition?.plugins,
  }

  // Throw is disallowed
  if (directiveType === LinealDirectiveFlag.DISALLOW) {
    if (definition?.components?.some((cid) => cid === componentId)) {
      throw InvalidLinealRelationFlag.DISALLOW_COMPONENT | governor
    }
    if (definition?.plugins?.some((pid) => pid === pluginId)) {
      throw InvalidLinealRelationFlag.DISALLOW_BUNDLE | governor
    }
  }

  // Throw if limited to range and missing
  if (directiveType === LinealDirectiveFlag.LIMIT_TO) {
    if (
      _isArr(definition?.components) &&
      (_isArrEmpty(definition?.components) ||
        !definition?.components?.some((cid) => cid === componentId))
    ) {
      throw InvalidLinealRelationFlag.DISALLOW_COMPONENT | governor
    }
    if (
      _isArr(definition?.plugins) &&
      (_isArrEmpty(definition?.plugins) ||
        !definition?.plugins?.some((pid) => pid === pluginId))
    ) {
      throw InvalidLinealRelationFlag.DISALLOW_BUNDLE | governor
    }
  }
}

export type LinealItem = {
  componentId?: Aglyn.ComponentId
  pluginId?: Aglyn.PluginId
  restrictParent?: Aglyn.ComponentsLinealOrder
  restrictChildren?: Aglyn.ComponentsLinealOrder
}

function componentLabel(componentId?: Aglyn.ComponentId): string | undefined {
  if (!componentId) return undefined
  return components.getLabel(componentId) ?? componentId
}

function allowedComponentLabels(
  linealOrder?: Aglyn.ComponentsLinealOrder,
): string[] {
  if (!linealOrder) return []
  const [directiveType, directiveDefinition] = linealOrder
  if (directiveType !== LinealDirectiveFlag.LIMIT_TO) return []
  const components = _isArr(directiveDefinition)
    ? directiveDefinition
    : directiveDefinition?.components
  return (components ?? [])
    .map((id) => componentLabel(id))
    .filter(Boolean) as string[]
}

/**
 * Human-readable explanation for a failed lineal validation, e.g.
 * "Toolbar Content must be placed inside App Bar". Pair with the reason
 * flag returned by {@link confirmValidLinealRelationship}.
 */
export function describeInvalidLinealRelationship(
  item: LinealItem,
  parent: LinealItem,
  reason: InvalidLinealRelationFlag,
): string {
  const itemLabel = componentLabel(item.componentId) ?? 'This element'
  const parentLabel =
    parent.componentId && parent.componentId !== 'div'
      ? componentLabel(parent.componentId) ?? parent.componentId
      : 'the document'

  // ITEM governor: the dragged element's own restrictParent failed.
  if (reason & InvalidLinealRelationFlag.ITEM) {
    const allowed = allowedComponentLabels(item.restrictParent)
    if (allowed.length) {
      return `${itemLabel} must be placed inside ${allowed.join(' or ')}`
    }
    return `${itemLabel} can't be placed inside ${parentLabel}`
  }

  // PARENT governor: the target's restrictChildren failed.
  const allowed = allowedComponentLabels(parent.restrictChildren)
  if (allowed.length) {
    return `${parentLabel} only accepts ${allowed.join(', ')}`
  }
  return `${parentLabel} doesn't accept ${itemLabel}`
}

export function confirmValidLinealRelationship(
  item: LinealItem,
  parent: LinealItem,
): ConfirmValidLinealRelationshipResponse {
  try {
    if (item.restrictParent) {
      validateLinealOrder(
        parent.componentId,
        parent.pluginId,
        item.restrictParent,
        InvalidLinealRelationFlag.ITEM,
      )
    }
    if (parent.restrictChildren) {
      validateLinealOrder(
        item.componentId,
        item.pluginId,
        parent.restrictChildren,
        InvalidLinealRelationFlag.PARENT,
      )
    }
  } catch (e) {
    console.error(e)
    if (typeof e === 'number') {
      return [false, e]
    }
    throw e
  }

  return [true]
}
export default confirmValidLinealRelationship
