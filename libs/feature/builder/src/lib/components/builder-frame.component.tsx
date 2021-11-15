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

import { CanvasRendererComponent } from '@aglyn/feature-renderer'
import { styled } from '@aglyn/shared-feature-themes'
import { forwardRef, HTMLAttributes } from 'react'
import { BuilderElementRendererComponent } from './builder-element-renderer.component'


const BuilderFrameContainer = styled('div', {name: 'BuilderFrameContainer'})(({theme}) => ({
  flexGrow: 1,
  height: '100%',
  width: '100%',
  background: theme.palette.background.paper,
  boxShadow: theme.shadows[1],
}))

export interface BuilderFrameComponentProps extends HTMLAttributes<HTMLDivElement> {

}

export const BuilderFrameComponent = forwardRef<any, BuilderFrameComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    return (
      <BuilderFrameContainer ref={ref} {...rest}>
        <CanvasRendererComponent
          id="aglyn:canvas"
          elementRendererComponent={BuilderElementRendererComponent}
        />
        {children}
      </BuilderFrameContainer>
    )
  },
)

BuilderFrameComponent.displayName = 'BuilderFrameComponent'
BuilderFrameComponent.defaultProps = {}

export default BuilderFrameComponent
