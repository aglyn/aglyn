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

import { forwardRef, HTMLAttributes } from 'react'
import { AglynComponentData } from '@aglyn/framework/sdk'
import { ElementRendererComponent, ElementRendererComponentProps } from './element-renderer.component'
import { OverrideableComponentProps } from '@aglyn/shared/ui/react'
import { ElementsRendererComponent } from './elements-renderer.component'


export interface CanvasRendererComponentProps extends HTMLAttributes<HTMLElement>, OverrideableComponentProps {
  elements?: AglynComponentData[]
  elementRendererComponent?: ElementRendererComponentProps['elementRendererComponent']
}

export const CanvasRendererComponent = forwardRef<HTMLElement, CanvasRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      component: Component,
      elementRendererComponent: elementRendererComponentProp,
      elements,
      ...rest
    } = props
    const elementRendererComponent = elementRendererComponentProp || ElementRendererComponent
    return (
      <Component ref={ref} {...rest}>
        <ElementsRendererComponent
          children={elements}
          elementRendererComponent={elementRendererComponent}
        />
      </Component>
    )
  },
)

CanvasRendererComponent.displayName = 'CanvasRendererComponent'
CanvasRendererComponent.defaultProps = {
  component: 'div',
  elements: [],
}

export default CanvasRendererComponent
