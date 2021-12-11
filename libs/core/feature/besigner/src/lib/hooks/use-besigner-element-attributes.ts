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

import { BundleUId, ComponentId, ElementId } from '@aglyn/core-data-framework'
import { ElementAttribute } from '@aglyn/core-feature-besigner'
import { useBesignerElementInteractionActivity } from './use-besigner-element-interaction-activity'


function computeActivityValue(self: boolean, child: boolean) {
  if (child) return 'child'
  if (self) return 'self'
  return 'false'
}

export interface UseBesignerElementAttributesOptions {
  $id: ElementId
  componentId: ComponentId
  bundleId?: BundleUId
}

export const useBesignerElementAttributes = (opts: UseBesignerElementAttributesOptions) => {
  const {$id, componentId, bundleId} = opts

  const {isSelfSelected, isSelfHovered, isChildSelected, isChildHovered} =
    useBesignerElementInteractionActivity($id)
  const selected = computeActivityValue(isSelfSelected, isChildSelected)
  const hovered = computeActivityValue(isSelfHovered, isChildHovered)

  const attributes = {
    [ElementAttribute.ELEMENT_ID]: `${$id}`,
    [ElementAttribute.COMPONENT_ID]: `${componentId}`,
    [ElementAttribute.BUNDLE_ID]: bundleId,
    [ElementAttribute.SELECTED]: selected,
    [ElementAttribute.HOVERED]: hovered,
  }

  return attributes
}

export default useBesignerElementAttributes
