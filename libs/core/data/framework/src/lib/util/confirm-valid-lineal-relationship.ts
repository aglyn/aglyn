/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { _isArr, _isNum } from '@aglyn/shared-util-guards'
import {
  AglynComponentRenderFlags,
  ComponentsLinealDirectiveFlag,
  ComponentsLinealOrder,
} from '../controllers/aglyn-components.controller'
import { BundleUId, ComponentId } from '../types'


export enum InvalidLinealRelationFlag {
  DISALLOW = ComponentsLinealDirectiveFlag.DISALLOW,
  LIMIT_TO = ComponentsLinealDirectiveFlag.LIMIT_TO,

  ITEM = 0x03,
  PARENT = 0x04,

  COMPONENT = 0x05,
  BUNDLE = 0x06,

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
  componentId: ComponentId,
  bundleId: BundleUId,
  linealOrder: ComponentsLinealOrder,
  governor: typeof InvalidLinealRelationFlag.ITEM | typeof InvalidLinealRelationFlag.PARENT,
) {
  const [directiveType, directiveDefinition] = linealOrder
  const definitionList = (!_isArr(directiveDefinition)
    ? [[undefined, directiveDefinition]]
    : directiveDefinition)

  for (const def of definitionList) {
    const definition = _isArr(def) ? def : [undefined, def]

    // Throw is disallowed
    if (directiveType === ComponentsLinealDirectiveFlag.DISALLOW) {
      for (const [bundleIdDef, componentIdDef] of definition) {
        if (_isNum(componentId) && _isNum(componentIdDef) && componentIdDef === componentId) {
          throw InvalidLinealRelationFlag.DISALLOW_COMPONENT | governor
        }
        if (_isNum(bundleId) && _isNum(bundleIdDef) && bundleIdDef === bundleId) {
          throw InvalidLinealRelationFlag.DISALLOW_BUNDLE | governor
        }
      }
    }

    // Throw if limited to range and missing
    if (directiveType === ComponentsLinealDirectiveFlag.LIMIT_TO) {


      // const hitComponent = !definition.some(([[bundleIdDef, componentIdDef]]) =>)
      //
      // if (_isNum(componentId) && !hit) {
      //   throw InvalidLinealRelationFlag.LIMIT_TO_COMPONENT | context
      // }
      // if (_isNum(bundleId) && _isNum(bundleIdDef) && bundleIdDef === bundleId) {
      //   throw InvalidLinealRelationFlag.LIMIT_TO_BUNDLE | context
      // }
    }

  }
}

export interface ConfirmValidLinealRelationshipOptions {
  item: {
    componentId: ComponentId
    bundleId: ComponentId
    hierarchy: AglynComponentRenderFlags['hierarchy']
  }
  parent: {
    componentId: ComponentId
    bundleId: ComponentId
    hierarchy: AglynComponentRenderFlags['hierarchy']
  }
}

export function confirmValidLinealRelationship(
  options: ConfirmValidLinealRelationshipOptions,
): ConfirmValidLinealRelationshipResponse {
  const {item, parent} = options
  const itemRestrictParentLinealOrder = item.hierarchy?.restrictParent
  const parentRestrictChildrenLinealOrder = parent.hierarchy?.restrictChildren

  try {
    if (_isArr(itemRestrictParentLinealOrder)) {
      validateLinealOrder(
        parent.componentId,
        parent.bundleId,
        itemRestrictParentLinealOrder,
        InvalidLinealRelationFlag.ITEM,
      )
    }
    if (_isArr(parentRestrictChildrenLinealOrder)) {
      validateLinealOrder(
        item.componentId,
        item.bundleId,
        parentRestrictChildrenLinealOrder,
        InvalidLinealRelationFlag.PARENT,
      )
    }
  }
  catch (e) {
    if (e in InvalidLinealRelationFlag) {
      return [false, e]
    }
    throw e
  }

  return [true]
}
export default confirmValidLinealRelationship
