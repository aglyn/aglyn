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
  AglynComponentPropsFormSchema,
  BundleId,
  ComponentId,
} from '@aglyn/core-data-foundation'
import { useAglynComponentSchema } from '@aglyn/core-feature-renderer'
import { buildComponentPropsFormSchema } from '@aglyn/core-util-app'

import { useMemo } from 'react'

export interface UseComponentFormSchema extends AglynComponentPropsFormSchema {}

export interface UseComponentFormSchemaOptions {
  componentId: ComponentId
  bundleId?: BundleId
}

export const useComponentFormSchema = (
  opts: UseComponentFormSchemaOptions,
): UseComponentFormSchema => {
  const { componentId, bundleId } = opts
  const componentSchema = useAglynComponentSchema(componentId, bundleId)
  const formSchema = componentSchema?.formSchema

  return useMemo(() => {
    return buildComponentPropsFormSchema(formSchema)
  }, [formSchema])
}

export default useComponentFormSchema
