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

import { getContextStore } from '@aglyn/core-data-framework'
import { OverrideableComponentProps } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import { useStoreMap } from 'effector-react'
import { forwardRef, HTMLAttributes } from 'react'
import { useAglynAppContext } from '../contexts/aglyn-app-context'
import {
  ElementRendererComponent,
  ElementRendererComponentProps,
} from './element-renderer.component'
import { ElementsRendererComponent } from './elements-renderer.component'


export interface CanvasRendererComponentProps
  extends HTMLAttributes<HTMLElement>,
    OverrideableComponentProps {
  elementRendererComponent?: ElementRendererComponentProps['elementRendererComponent']
}

export const CanvasRendererComponent = forwardRef<any, CanvasRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      elementRendererComponent: elementRendererComponentProp,
      children,
      ...rest
    } = props
    const elementRendererComponent = elementRendererComponentProp || ElementRendererComponent
    const {getApp} = useAglynAppContext()
    const store = getContextStore(getApp(), {storeId: 'elements'})
    const elements = useStoreMap(store, (elements) => {
      return elements['present']['__root__'].elements
    })
    return (
      <Box ref={ref} {...rest}>
        <ElementsRendererComponent
          elements={elements}
          elementRendererComponent={elementRendererComponent}
        />
        {children}
      </Box>
    )
  },
)

CanvasRendererComponent.displayName = 'CanvasRendererComponent'
CanvasRendererComponent.defaultProps = {
  component: 'div',
}

export default CanvasRendererComponent
