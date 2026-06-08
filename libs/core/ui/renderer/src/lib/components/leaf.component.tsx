/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { forwardRef } from 'react'
import {
  LeafComponentContext,
  LeafContext,
  type LeafType,
} from '../contexts/tree-context'

export interface LeafProps {
  data: LeafType
  children?: JSX.Children
}

export const LeafComponent = forwardRef<any, LeafProps>((props, ref) => {
  const { children, data } = props
  const { id, props: componentProps } = data

  return (
    <LeafContext.Provider value={data}>
      <LeafComponentContext.Consumer>
        {(LeafComponent) => (
          <LeafComponent ref={ref} data-leaf-id={id} {...componentProps}>
            {children}
          </LeafComponent>
        )}
      </LeafComponentContext.Consumer>
    </LeafContext.Provider>
  )
})

LeafComponent.displayName = 'LeafComponent'

export default LeafComponent
