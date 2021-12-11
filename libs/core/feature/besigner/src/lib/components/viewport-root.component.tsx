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

import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'
import { _isFnT } from '@aglyn/shared-util-guards'
import Stack, { StackProps } from '@mui/material/Stack'
import clsx from 'clsx'
import { ChangeEvent, forwardRef, useCallback, useRef } from 'react'
import { useAglynBesignerPanelValue } from '../hooks/use-aglyn-besigner-panel-value'
import { ViewportCanvasComponent } from './viewport-canvas.component'
import { ZoomControlsComponent } from './zoom-controls.component'


const classKeys = generateComponentClassKeys('AglynViewport', [
  'panelLeftOpen',
  'panelBottomOpen',
  'panelRightOpen',
])

const AglynViewport = styled(Stack, {
  name: 'AglynViewport',
  // shouldForwardProp(propName) {return propName !== 'panelLeftWidth'},
})<ViewportRootComponentProps>({
  flexGrow: 1,
  overflow: 'hidden',
  // position: 'relative',
  [`&.${classKeys.panelLeftOpen}`]: {},
  [`&.${classKeys.panelBottomOpen}`]: {},
  [`&.${classKeys.panelRightOpen}`]: {},
})

const CanvasShadow = styled('div', {
  name: 'AglynCanvasShadow'
})(({theme}) => ({
  flexGrow: 1,
  overflow: 'hidden',
  width: '100%',
  height: '100%',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  // position: 'absolute',
  zIndex: theme.zIndex.appBar - 1,
  boxShadow: theme.insetShadows[3],
  backgroundColor: 'transparent',
  pointerEvents: 'none',
}))

export interface ViewportRootComponentProps extends StackProps {
  // drawerWidth?: number
}

export const ViewportRootComponent = forwardRef<any, ViewportRootComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, className, ...rest} = props

    const pannerRef = useRef<any>()

    const handleZoomReset = useCallback((e: ChangeEvent<unknown>) => {
      if (_isFnT(pannerRef.current?.reset)) {
        pannerRef.current.reset()
      }
    }, [])

    const handleZoomDecrease = useCallback((e: ChangeEvent<unknown>) => {
      if (_isFnT(pannerRef.current?.zoomOut)) {
        pannerRef.current.zoomOut()
      }
    }, [])

    const handleZoomIncrease = useCallback((e: ChangeEvent<unknown>) => {
      if (_isFnT(pannerRef.current?.zoomIn)) {
        pannerRef.current.zoomIn()
      }
    }, [])

    const leftToggled = useAglynBesignerPanelValue('panelLeft', 'toggled')
    const rightToggled = useAglynBesignerPanelValue('panelRight', 'toggled')
    const bottomToggled = useAglynBesignerPanelValue('panelBottom', 'toggled')

    const elemClassName = clsx(
      {
        [classKeys.panelLeftOpen]: Boolean(leftToggled),
        [classKeys.panelRightOpen]: Boolean(rightToggled),
        [classKeys.panelBottomOpen]: Boolean(bottomToggled),
      },
      className,
    )

    return (
      <AglynViewport
        ref={ref}
        className={elemClassName}
        // drawerWidth={left?.drawerWidth}
        {...rest}
      >
        <CanvasShadow />
        <ViewportCanvasComponent pannerRef={pannerRef} />
        <ZoomControlsComponent
          onZoomReset={handleZoomReset}
          onZoomDecrease={handleZoomDecrease}
          onZoomIncrease={handleZoomIncrease}
        />
        {children}
      </AglynViewport>
    )
  },
)

ViewportRootComponent.displayName = 'ViewportRootComponent'
ViewportRootComponent.defaultProps = {}

export default ViewportRootComponent
