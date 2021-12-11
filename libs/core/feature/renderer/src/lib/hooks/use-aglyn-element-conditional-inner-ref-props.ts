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

import type { ElementId } from '@aglyn/core-data-framework'
import { InnerRefProp } from '@aglyn/shared-data-types'
import { yes } from '@aglyn/shared-util-tools'
import { Ref, useMemo } from 'react'
import { useAglynAppContext } from '../contexts/aglyn-app-context'
import useAglynComponentSchema from './use-aglyn-component-schema'
import { useAglynElementData } from './use-aglyn-element-data'

export function useAglynElementConditionalInnerRefProps<T>(
  $id: ElementId,
  ref: Ref<T>
): InnerRefProp<T> {
  const { getApp } = useAglynAppContext()
  const elementData = useAglynElementData($id)
  const schema = useAglynComponentSchema(elementData.componentId, elementData.bundleId)
  const disabled = schema?.renderFlags?.elementRef?.disable
  const innerRef = schema?.renderFlags?.elementRef?.innerRef

  return useMemo(() => {
    return yes(!disabled && innerRef) ? { innerRef: ref } : {}
  }, [$id, getApp, disabled, innerRef])
}
export default useAglynElementConditionalInnerRefProps
