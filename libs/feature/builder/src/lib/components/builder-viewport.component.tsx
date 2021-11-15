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

import { styled } from '@aglyn/shared-feature-themes'
import { _isFnT } from '@aglyn/shared-util-guards'
import Stack, {StackProps} from '@mui/material/Stack'
import { ChangeEvent, forwardRef, HTMLAttributes, useCallback, useRef } from 'react'
import BuilderCanvasComponent from './builder-canvas.component'
import BuilderFrameComponent from './builder-frame.component'
import BuilderZoomControlsComponent from './builder-zoom-controls.component'


const StyledContainer = styled(Stack, {name: 'StyledContainer'})({
  flexGrow: 1,
  overflow: 'hidden',
  position: 'relative',
})

const CanvasShadow = styled('div', {name: 'CanvasShadow'})(({theme}) => ({
  flexGrow: 1,
  overflow: 'hidden',
  width: '100%',
  height: '100%',
  left: 0, right: 0, top: 0, bottom: 0,
  position: 'absolute',
  zIndex: theme.zIndex.appBar - 1,
  boxShadow: theme.insetShadows[2],
  backgroundColor: 'transparent',
  pointerEvents: 'none',
}))


export interface BuilderViewportComponentProps extends StackProps {

}

export const BuilderViewportComponent = forwardRef<any, BuilderViewportComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    const pannerRef = useRef<any>()

    const handleZoomReset = useCallback((e: ChangeEvent<unknown>) => {
      if (_isFnT(pannerRef.current.reset)) {
        pannerRef.current.reset()
      }
    }, [])

    const handleZoomDecrease = useCallback((e: ChangeEvent<unknown>) => {
      if (_isFnT(pannerRef.current.zoomOut)) {
        pannerRef.current.zoomOut()
      }
    }, [])

    const handleZoomIncrease = useCallback((e: ChangeEvent<unknown>) => {
      if (_isFnT(pannerRef.current.zoomIn)) {
        pannerRef.current.zoomIn()
      }
    }, [])

    return (
      <StyledContainer
        ref={ref}
        {...rest}
      >
        <CanvasShadow />
        <BuilderCanvasComponent pannerRef={pannerRef}>
          <BuilderFrameComponent />
        </BuilderCanvasComponent>
        <BuilderZoomControlsComponent
          onZoomReset={handleZoomReset}
          onZoomDecrease={handleZoomDecrease}
          onZoomIncrease={handleZoomIncrease}
        />
        {children}
      </StyledContainer>
    )
  },
)

BuilderViewportComponent.displayName = 'BuilderViewportComponent'
BuilderViewportComponent.defaultProps = {}

export default BuilderViewportComponent
