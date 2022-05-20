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

import {
  type AglynComponentSchema,
  type BundleUId,
  type ComponentId,
  getComponentSchema,
} from '@aglyn/core-data-framework'
import {useMemo} from 'react'
import {useAglynAppContext} from '../contexts/aglyn-app-context'


export function useAglynComponentSchema(
  componentId: ComponentId,
  bundleId?: BundleUId,
): AglynComponentSchema {
  const app = useAglynAppContext()
  return useMemo(() => {
    return getComponentSchema(app, {componentId, bundleId})
  }, [app, componentId, bundleId])
}
export default useAglynComponentSchema
