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

import { alpha, generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'
import { ZoomablePanningComponent } from '@aglyn/shared-ui-jsx'
import { forwardRef, HTMLAttributes, Ref } from 'react'
import { ViewportFrameComponent } from './viewport-frame.component'


const ViewportCanvas = styled('div', {
  name: 'AglynViewportCanvas'
})(({theme}) => ({
  flexGrow: 1,
  minHeight: '100%',
  width: '100%',
  backgroundColor: theme.palette.background.secondary,
  // position: 'relative',
  backgroundImage: [
    `radial-gradient(circle, ${alpha(
      theme.palette.tertiary.main,
      0.28,
    )} 0.086em, rgba(0,0,0,0) 1px)`,
    // `linear-gradient(to bottom, ${alpha(theme.palette.divider, 0.07)} 1px, transparent 1px)`,
  ].join(','),
  backgroundSize: ['30px', '30px'].join(' '),
  overflowY: 'auto',
  overflowX: 'auto',
  // display: 'flex',
}))

const canvasArtboardClassKeys = generateComponentClassKeys('AglynCanvasArtboard', [
  'deviceXl',
  'deviceLg',
  'deviceMd',
  'deviceSm',
  'deviceXs',
])
const CanvasArtboard = styled('div', {
  name: 'AglynCanvasArtboard'
})(({theme}) => ({
  overflow: 'hidden',
  minHeight: '100%',
  padding: theme.spacing(3),
  marginLeft: 'auto',
  marginRight: 'auto',
  display: 'flex',
  flexDirection: 'column',
  width: 1280,
  [`&.${canvasArtboardClassKeys.deviceXl}`]: {width: theme.breakpoints.values.xl},
  [`&.${canvasArtboardClassKeys.deviceLg}`]: {width: theme.breakpoints.values.lg},
  [`&.${canvasArtboardClassKeys.deviceMd}`]: {width: theme.breakpoints.values.md},
  [`&.${canvasArtboardClassKeys.deviceSm}`]: {width: theme.breakpoints.values.sm},
  [`&.${canvasArtboardClassKeys.deviceXs}`]: {width: theme.breakpoints.values.xs},
}))

const ArtboardPanner = styled(ZoomablePanningComponent, {name: 'AglynArtboardPanner'})(
  ({theme}) => ({
    overflow: 'hidden',
    padding: theme.spacing(3),
    height: '100%',
    width: theme.breakpoints.values.lg,
    marginLeft: 'auto',
    marginRight: 'auto',
    ['& > div']: {
      flexGrow: 1,
      display: 'flex',
      height: '100%',
      width: '100%',
    },
  }),
)

export interface ViewportCanvasComponentProps extends HTMLAttributes<HTMLDivElement> {
  pannerRef?: Ref<any>
}

const ViewportCanvasComponent = forwardRef<any, ViewportCanvasComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, pannerRef, ...rest} = props

    return (
      <ViewportCanvas ref={ref} {...rest}>
        <CanvasArtboard>
          {/*<ViewportCanvasPanner*/}
          {/*  {...{ref: pannerRef} as any}*/}
          {/*  disableScrollZoom*/}
          {/*  disableDoubleClickZoom*/}
          {/*  // autoCenter*/}
          {/*  enableBoundingBox*/}
          {/*  noStateUpdate*/}
          {/*  disabled*/}
          {/*>*/}
          <ViewportFrameComponent />
          {/*</ViewportCanvasPanner>*/}
        </CanvasArtboard>

        {/*<RulerComponent*/}
        {/*  variant="vertical"*/}
        {/*  sx={{position: 'relative', mt: '-16px', ml: '-22px'}}*/}
        {/*/>*/}
        {/*<RulerComponent*/}
        {/*  variant="horizontal"*/}
        {/*  sx={{position: 'relative', ml: '-11px', mt: '-20px'}}*/}
        {/*/>*/}
        {children}
      </ViewportCanvas>
    )
  },
)

ViewportCanvasComponent.displayName = 'ViewportCanvasComponent'
ViewportCanvasComponent.defaultProps = {}

export { ViewportCanvasComponent }
export default ViewportCanvasComponent
