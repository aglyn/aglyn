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

import {
  AglynComponentElementData,
  AglynComponentElementTemplateData,
  TemplateSubElementData,
} from '@aglyn/core-data-framework'
import { objectDeepMergeMany } from '@aglyn/shared-util-vendor'
import { createElementDataId } from './create-element-data-id'


export const ELEMENT_DEFAULTS: Partial<AglynComponentElementData> = {
  props: {},
  elements: [],
}

export function createElementData(
  template: AglynComponentElementTemplateData,
): AglynComponentElementData {
  const {data} = template

  function mapTemplate(data: TemplateSubElementData): AglynComponentElementData {
    return {
      ...data,
      $id: createElementDataId(),
      elements: [...(data.elements ?? [])].map((data) => mapTemplate(data)),
    }
  }

  return objectDeepMergeMany([
    {...ELEMENT_DEFAULTS},
    mapTemplate(data),
  ]) as AglynComponentElementData
}
