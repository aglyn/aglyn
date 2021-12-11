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
import type { AnyProps } from '@aglyn/shared-data-types'
import { _isFnT } from '@aglyn/shared-util-guards'
import { useMemo } from 'react'
import useAglynComponentSchema from './use-aglyn-component-schema'
import { useAglynElementData } from './use-aglyn-element-data'

export function useAglynElementResolvedProps<P extends AnyProps>($id: ElementId): P {
  const elementData = useAglynElementData($id)
  const schema = useAglynComponentSchema(elementData.componentId, elementData.bundleId)
  const resolveProps = schema?.renderFlags?.resolveProps

  return useMemo(() => {
    return (
      (_isFnT(resolveProps) ? resolveProps.call(undefined, elementData) : elementData.props) || {}
    )
  }, [resolveProps, elementData]) as P
}
export default useAglynElementResolvedProps
