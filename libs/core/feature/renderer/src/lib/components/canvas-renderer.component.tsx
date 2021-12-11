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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/core-data-framework'
import { OverrideableComponentProps } from '@aglyn/shared-data-types'
import Box from '@mui/material/Box'
import { forwardRef, HTMLAttributes } from 'react'
import { useAglynElementData } from '../hooks/use-aglyn-element-data'
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

const CanvasRendererComponent = forwardRef<any, CanvasRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const { elementRendererComponent: elementRendererComponentProp, children, ...rest } = props
    const elementRendererComponent = elementRendererComponentProp || ElementRendererComponent
    const elements = useAglynElementData(CANVAS_ROOT_ELEMENT_ID, 'elements')
    return (
      <Box ref={ref} {...rest}>
        <ElementsRendererComponent
          elements={elements}
          elementRendererComponent={elementRendererComponent}
        />
        {children}
      </Box>
    )
  }
)

CanvasRendererComponent.displayName = 'CanvasRendererComponent'
CanvasRendererComponent.defaultProps = {
  component: 'div',
}

export { CanvasRendererComponent }
export default CanvasRendererComponent
