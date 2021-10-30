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
import { SvgPathIcon } from '@aglyn/shared-ui-jsx'
import { _isFnT } from '@aglyn/shared-util-guards'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import { forwardRef, HTMLAttributes, useCallback, useRef } from 'react'
import { PanZoom } from 'react-easy-panzoom'
import { BuilderElementRendererComponent } from './builder-element-renderer.component'


const StyledContainer = styled('div')(({theme}) => ({
  flexGrow: 1,
  overflow: 'hidden',
}))

const CanvasPanner = styled(PanZoom, {name: 'CanvasPanner'})(({theme}) => ({
  overflow: 'hidden',
  padding: theme.spacing(3),
  height: '100%',
  ['& > div']: {
    flexGrow: 1,
    display: 'flex',
    height: '100%',
    width: '100%',
  },
}))

const CanvasFrame = styled('div', {name: 'CanvasFrame'})(({theme}) => ({
  flexGrow: 1,
  height: '100%',
  width: '100%',
  background: theme.palette.background.paper,
  boxShadow: theme.shadows[1],
}))

const ZoomControlContainer = styled('div', {name: 'ZoomControlContainer'})(({theme}) => ({
  position: 'fixed',
  right: 0, bottom: 0,
  marginBottom: theme.spacing(1), marginRight: theme.spacing(1),
  opacity: 0.5,
  transition: theme.transitions.create('opacity', {
    duration: theme.transitions.duration.short,
    easing: theme.transitions.easing.easeInOut,
  }),
  ['&:hover']: {
    opacity: 1,
  },
}))

export interface BuilderCanvasRendererComponentProps extends HTMLAttributes<HTMLDivElement> {

}

export const BuilderCanvasRendererComponent = forwardRef<any, BuilderCanvasRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {...rest} = props

    const panRef = useRef<any>()

    const handleZoomIn = useCallback(() => {
      if (_isFnT(panRef.current.zoomIn)) {
        panRef.current.zoomIn()
      }
    }, [])

    const handleZoomOut = useCallback(() => {
      if (_isFnT(panRef.current.zoomOut)) {
        panRef.current.zoomOut()
      }
    }, [])

    const handleZoomReset = useCallback(() => {
      if (_isFnT(panRef.current.reset)) {
        panRef.current.reset()
      }
    }, [])

    return (
      <StyledContainer ref={ref} {...rest}>
        <CanvasPanner
          disableScrollZoom
          disableDoubleClickZoom
          // autoCenter
          enableBoundingBox
          noStateUpdate
          disabled
          ref={panRef}
        >
          <CanvasFrame>
            <CanvasRendererComponent
              id="aglyn:canvas"
              elementRendererComponent={BuilderElementRendererComponent}
            />
          </CanvasFrame>
        </CanvasPanner>

        <ZoomControlContainer>
          <ButtonGroup variant="contained" color="quaternary" aria-label="zoom controls">
            <Tooltip title={'Reset zoom'}>
              <Button onClick={handleZoomReset}>
                <SvgPathIcon fontSize="small" iconId={'fit-to-page'}/>
              </Button>
            </Tooltip>
            <Tooltip title={'Increase zoom (⌘+)'}>
              <Button onClick={handleZoomOut}>
                <SvgPathIcon fontSize="small" iconId={'magnify-minus'}/>
              </Button>
            </Tooltip>
            <Tooltip title={'Decrease zoom (⌘-)'}>
              <Button onClick={handleZoomIn}>
                <SvgPathIcon fontSize="small" iconId={'magnify-plus'}/>
              </Button>
            </Tooltip>
          </ButtonGroup>
        </ZoomControlContainer>

      </StyledContainer>
    )
  },
)

BuilderCanvasRendererComponent.displayName = 'BuilderCanvasRendererComponent'
BuilderCanvasRendererComponent.defaultProps = {}

export default BuilderCanvasRendererComponent
