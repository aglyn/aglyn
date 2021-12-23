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

import {objectDeepMergeMany} from '@aglyn/shared-util-vendor'
import {
  AglynComponentElementDataDenormalized,
  AglynComponentElementTemplate,
  AglynComponentTemplateData,
} from '../controllers/aglyn-components.types'
import {createComponentElementId} from './create-component-element-id'


function traverseComponentTemplate(data: AglynComponentTemplateData): AglynComponentElementDataDenormalized {
  return {
    ...data,
    $id: createComponentElementId(),
    elements: [...data?.elements || []].map((data) => traverseComponentTemplate(data)),
  }
}

export type CreateComponentElementDataOptions =
  | AglynComponentElementTemplate
  | {data: AglynComponentElementDataDenormalized}

export const ELEMENT_DEFAULTS: Partial<AglynComponentElementDataDenormalized> = {
  props: {},
  elements: [],
}

export function createComponentElementData(
  options?: CreateComponentElementDataOptions,
): AglynComponentElementDataDenormalized {
  const {data} = {...options}

  return objectDeepMergeMany([
    {...ELEMENT_DEFAULTS},
    traverseComponentTemplate(data),
  ]) as AglynComponentElementDataDenormalized
}
export default createComponentElementData
