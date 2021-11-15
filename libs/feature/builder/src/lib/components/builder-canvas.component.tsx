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

import { alpha, styled } from '@aglyn/shared-feature-themes'
import { ZoomablePanningComponent } from '@aglyn/shared-ui-jsx'
import { forwardRef, HTMLAttributes, Ref } from 'react'


const BuilderCanvasContainer = styled('div', {name: 'BuilderCanvasContainer'})(({theme}) => ({
  flexGrow: 1,
  height: '100%',
  width: '100%',
  backgroundColor: theme.palette.background.default,
  backgroundImage: [
    `linear-gradient(to right, ${alpha(theme.palette.divider, 0.07)} 1px, transparent 1px)`,
    `linear-gradient(to bottom, ${alpha(theme.palette.divider, 0.07)} 1px, transparent 1px)`,
  ].join(','),
  backgroundSize: [
    '10px',
    '10px',
  ].join(' '),
  overflowY: 'hidden',
  overflowX: 'auto',
}))

const BuilderCanvasPanner = styled(ZoomablePanningComponent, {name: 'BuilderCanvasPanner'})(({theme}) => ({
  overflow: 'hidden',
  padding: theme.spacing(3),
  height: '100%',
  width: theme.breakpoints.values.lg,
  ['& > div']: {
    flexGrow: 1,
    display: 'flex',
    height: '100%',
    width: '100%',
  },
}))

export interface BuilderCanvasComponentProps extends HTMLAttributes<HTMLDivElement> {
  pannerRef?: Ref<any>
}

export const BuilderCanvasComponent = forwardRef<any, BuilderCanvasComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, pannerRef, ...rest} = props

    return (
      <BuilderCanvasContainer ref={ref} {...rest}>
        <BuilderCanvasPanner
          {...{ref: pannerRef} as any}
          disableScrollZoom
          disableDoubleClickZoom
          // autoCenter
          enableBoundingBox
          noStateUpdate
          disabled
        >
          {children}
        </BuilderCanvasPanner>
      </BuilderCanvasContainer>
    )
  },
)

BuilderCanvasComponent.displayName = 'BuilderCanvasComponent'
BuilderCanvasComponent.defaultProps = {}

export default BuilderCanvasComponent
