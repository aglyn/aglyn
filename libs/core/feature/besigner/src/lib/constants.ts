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

export const DEFAULT_LEFT_DRAWER_WIDTH = 240

function buildAttributeKey(name: string): `${ELEMENT_ATTRIBUTE_PREFIX}${typeof name}` {
  return `${ELEMENT_ATTRIBUTE_PREFIX}${name}`
}
export const ELEMENT_ATTRIBUTE_PREFIX = 'data-aglyn-'
export type ELEMENT_ATTRIBUTE_PREFIX = typeof ELEMENT_ATTRIBUTE_PREFIX
export const ElementAttribute = {
  ELEMENT_ID: buildAttributeKey('element-id'),
  COMPONENT_ID: buildAttributeKey('component-id'),
  BUNDLE_ID: buildAttributeKey('bundle-id'),
  SELECTED: buildAttributeKey('selected'),
  HOVERED: buildAttributeKey('hovered'),
}
export type ElementAttribute = typeof ElementAttribute
