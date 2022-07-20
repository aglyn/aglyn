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

import type { AglynComponentPropsFormSchema } from '@aglyn/core-data-foundation'
import { DEFAULT_PROPS_FORM_SCHEMA } from '@aglyn/core-data-foundation'
import { _isArr } from '@aglyn/shared-util-guards'
import { copy } from '@aglyn/shared-util-tools'
import mergeWith from 'lodash-es/mergeWith'

export const buildComponentPropsFormSchema = (
  schema?: AglynComponentPropsFormSchema,
  defaults: AglynComponentPropsFormSchema = DEFAULT_PROPS_FORM_SCHEMA,
): AglynComponentPropsFormSchema => {
  // const _defaults =
  return mergeWith(copy(schema), copy(defaults), (target, source) => {
    if (_isArr(target)) return target.concat(source)
  })
}

export default buildComponentPropsFormSchema
