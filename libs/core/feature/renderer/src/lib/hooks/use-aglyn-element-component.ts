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

import type { IAglynComponent, ElementId } from '@aglyn/core-data-framework'
import { getComponent } from '@aglyn/core-data-framework'
import { useMemo } from 'react'
import { useAglynAppContext } from '../contexts/aglyn-app-context'
import { useAglynElementData } from './use-aglyn-element-data'

export function useAglynElementComponent($id: ElementId): IAglynComponent {
  const { getApp } = useAglynAppContext()
  const elementData = useAglynElementData($id)
  const componentId = elementData.componentId
  const bundleId = elementData.bundleId
  return useMemo(() => {
    return getComponent(getApp(), { componentId, bundleId })
  }, [getApp, componentId, bundleId])
}
export default useAglynElementComponent
