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
  AglynNodeItemDenormalized,
  AglynNodePresetSchema,
} from '../foundation'
import { cloneDeep } from '@aglyn/shared-util-tools'
import defaultsDeep from 'lodash-es/defaultsDeep'
import createComponentElementId from './create-component-element-id'

export function traverseNodePreset(
  data: AglynNodePresetSchema['data'],
): AglynNodeItemDenormalized {
  const response: AglynNodeItemDenormalized = {
    ...data,
    $id: createComponentElementId(),
    nodes: [],
    props: { ...data?.props },
  }
  const current = Array.isArray(data?.nodes) ? data.nodes : []
  for (const child of current) {
    response.nodes.push(traverseNodePreset(child))
  }
  return response
}

export type CreateComponentElementDataOptions =
  | AglynNodePresetSchema
  | { data: AglynNodePresetSchema['data'] }

export const ELEMENT_DEFAULTS: Partial<AglynNodeItemDenormalized> = {
  props: {},
  nodes: [],
}

export function createComponentElementData(
  options?: CreateComponentElementDataOptions,
): AglynNodeItemDenormalized {
  return defaultsDeep(
    traverseNodePreset(cloneDeep(options?.data)),
    cloneDeep(ELEMENT_DEFAULTS),
  )
}
export default createComponentElementData
