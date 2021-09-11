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

import {
  CanvasRendererComponent,
  CanvasRendererComponentProps,
  ElementsContext,
} from '@aglyn/framework/renderer'
import { ComponentType, forwardRef } from 'react'
import { PanZoom } from 'react-easy-panzoom'
import { BuilderElementRendererComponent } from './builder-element-renderer.component'


export interface BuilderCanvasRendererComponentProps extends Partial<CanvasRendererComponentProps> {
  canvasRendererComponent?: ComponentType<CanvasRendererComponentProps>
}

export const BuilderCanvasRendererComponent = forwardRef<any, BuilderCanvasRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      canvasRendererComponent,
      elementRendererComponent: elementRendererComponentProp,
      ...rest
    } = props
    const CanvasComponent = canvasRendererComponent || CanvasRendererComponent
    const elementRendererComponent = elementRendererComponentProp || BuilderElementRendererComponent

    return (
      <PanZoom disabled>
        <ElementsContext.Consumer>
          {({elements}) => (
            <CanvasComponent
              ref={ref}
              id="aglyn:canvas"
              elements={elements}
              elementRendererComponent={elementRendererComponent}
              {...rest}
            />
          )}
        </ElementsContext.Consumer>
      </PanZoom>
    )
  },
)

BuilderCanvasRendererComponent.displayName = 'BuilderCanvasRendererComponent'
BuilderCanvasRendererComponent.defaultProps = {
}

export default BuilderCanvasRendererComponent
