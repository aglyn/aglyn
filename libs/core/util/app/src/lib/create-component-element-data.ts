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

import type {
  AglynComponentElementTemplate,
  AglynComponentTemplateData,
  AglynElementNormalized,
} from '@aglyn/core-data-foundation'
import type { MutableKeys } from '@aglyn/shared-data-types'
import { copy } from '@aglyn/shared-util-tools'
import defaultsDeep from 'lodash-es/defaultsDeep'
import createComponentElementId from './create-component-element-id'

function traverseComponentTemplate(
  data: AglynComponentTemplateData,
): AglynElementNormalized {
  const response = { ...data } as AglynElementNormalized

  ;(response as MutableKeys<AglynElementNormalized, '$id' | 'elements'>).$id =
    createComponentElementId()

  const children: AglynElementNormalized[] = []
  for (const element of response?.elements || []) {
    children.push(traverseComponentTemplate(element))
  }
  response.elements = children
  return response
}

export type CreateComponentElementDataOptions =
  | AglynComponentElementTemplate
  | { data: AglynElementNormalized }

export const ELEMENT_DEFAULTS: Partial<AglynElementNormalized> = {
  props: {},
  elements: [],
}

export function createComponentElementData(
  options?: CreateComponentElementDataOptions,
): AglynElementNormalized {
  return defaultsDeep(
    traverseComponentTemplate(copy(options?.data)),
    copy(ELEMENT_DEFAULTS),
  )
}
export default createComponentElementData
