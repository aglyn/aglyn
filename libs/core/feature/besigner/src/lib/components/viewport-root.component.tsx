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

import {alpha, generateComponentClassKeys, styled} from '@aglyn/shared-feature-themes'
import {_isFnT} from '@aglyn/shared-util-guards'
import Stack, {type StackProps} from '@mui/material/Stack'
import clsx from 'clsx'
import {type ChangeEvent, forwardRef, useCallback, useRef} from 'react'
import {useAglynBesignerPanelValue} from '../hooks/use-aglyn-besigner-panel-value'
import {ViewportCanvasComponent} from './viewport-canvas.component'
import {ViewportZoomControlsComponent} from './viewport-zoom-controls.component'


const classKeys = generateComponentClassKeys('AglynViewport', [
  'panelLeftOpen',
  'panelBottomOpen',
  'panelRightOpen',
])

const AglynViewport = styled(Stack, {
  name: 'AglynViewport',
  // shouldForwardProp(propName) {return propName !== 'panelLeftWidth'},
})<ViewportRootComponentProps>(({theme}) => {
  const bg = theme.palette.background.default
  const base = theme.palette.divider
  const sq = alpha(base, 0.02)
  const outline = alpha(base, 0.0312)
  const corner = alpha(base, 0.016)
  const s = {
    sq: '4px',
    grid: '97px',
    line: '1px',
  }

  return ({
    flexGrow: 1,
    overflow: 'hidden',
    // position: 'relative',
    boxShadow: [
      `inset 0px 2px 4px -3px ${alpha(theme.palette.common.black, 0.08)}`,
      `inset 0px 4px 5px -2px ${alpha(theme.palette.common.black, 0.04)}`,
      `inset 0px 1px 10px -2px ${alpha(theme.palette.common.black, 0.06)}`,
    ].join(','),
    backgroundColor: bg,
    background: [
      `linear-gradient(-90deg, ${sq} ${s.line}, transparent ${s.line})`,
      `linear-gradient(${sq} ${s.line}, transparent ${s.line})`,
      `linear-gradient(-90deg, ${outline} ${s.line}, transparent ${s.line})`,
      `linear-gradient(${outline} ${s.line}, transparent ${s.line})`,
      `linear-gradient(transparent ${s.sq}, ${bg} ${s.sq}, ${bg} ${s.grid}, transparent ${s.grid})`,
      `linear-gradient(-90deg, ${corner} ${s.line}, transparent ${s.line})`,
      `linear-gradient(-90deg, transparent ${s.sq}, ${bg} ${s.sq}, ${bg} ${s.grid}, transparent ${s.grid})`,
      `linear-gradient(${corner} ${s.line}, transparent ${s.line})`,
      corner,
    ].join(','),
    backgroundSize: [
      '10px 10px', '10px 10px', '100px 100px', '100px 100px', '100px 100px',
      '100px 100px', '100px 100px', '100px 100px',
    ].join(','),
    // position: 'relative',
    [`&.${classKeys.panelLeftOpen}`]: {},
    [`&.${classKeys.panelBottomOpen}`]: {},
    [`&.${classKeys.panelRightOpen}`]: {},
  })
})

export interface ViewportRootComponentProps extends StackProps {
  // drawerWidth?: number
}

const ViewportRootComponent = forwardRef<any, ViewportRootComponentProps>(
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

    const elemClassName = clsx({
      [classKeys.panelLeftOpen]: Boolean(leftToggled),
      [classKeys.panelRightOpen]: Boolean(rightToggled),
      [classKeys.panelBottomOpen]: Boolean(bottomToggled),
    }, className)

    return (
      <AglynViewport
        ref={ref}
        id="aglyn:viewport-root"
        aria-label="besigner viewport root"
        className={elemClassName}
        direction="column"
        alignItems="center"
        spacing={0}
        // drawerWidth={left?.drawerWidth}
        {...rest}
      >
        <ViewportCanvasComponent pannerRef={pannerRef} />
        <ViewportZoomControlsComponent
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

export {ViewportRootComponent}
export default ViewportRootComponent
