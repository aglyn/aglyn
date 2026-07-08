/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import * as Besigner from '@aglyn/besigner'
import { BesignerDeviceFlag } from '@aglyn/besigner'
import { LOADING_OVERLAY_ELEMENT } from '@aglyn/shared-ui-jsx'
import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import clsx from 'clsx'
import dynamic from 'next/dynamic'
// import {ZoomablePanningComponent} from '@aglyn/shared-ui-jsx'
import { ComponentProps, forwardRef, type Ref } from 'react'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import type { ViewportFrameComponentProps } from './viewport-frame.component'

const canvasArtboardClassKeys = generateComponentClassKeys(
  'AglynCanvasArtboard',
  ['responsive', 'deviceXs', 'deviceSm', 'deviceMd', 'deviceLg', 'deviceXl'],
)

const ViewportCanvas = styled('div', {
  name: 'AglynViewportCanvas',
})({
  flexGrow: 1,
  // minHeight: '100%',
  width: '100%',
  overflowY: 'auto',
  overflowX: 'auto',
  // display: 'flex',
  // Bound-content marker (AGL-97): elements whose props carry binding
  // tokens get a subtle dotted underline so editors can
  // spot dynamic content whether tokens are shown raw or resolved.
  '& [data-aglyn-bound]': {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: 'rgba(123, 31, 162, 0.55)',
    textUnderlineOffset: 3,
  },
})

const ViewportArtboard = styled('div', {
  name: 'AglynViewportArtboard',
})(({ theme }) => ({
  overflow: 'hidden',
  minHeight: '100%',
  padding: theme.spacing(3),
  marginLeft: 'auto',
  marginRight: 'auto',
  display: 'flex',
  flexDirection: 'column',
  transition: theme.transitions.create(['width'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  [`&, &.${canvasArtboardClassKeys.responsive}`]: { width: '100%' },
  [`&.${canvasArtboardClassKeys.deviceXs}`]: { width: 390 },
  [`&.${canvasArtboardClassKeys.deviceSm}`]: {
    width: theme.breakpoints.values.sm,
  },
  [`&.${canvasArtboardClassKeys.deviceMd}`]: {
    width: theme.breakpoints.values.md,
  },
  [`&.${canvasArtboardClassKeys.deviceLg}`]: {
    width: theme.breakpoints.values.lg,
  },
  [`&.${canvasArtboardClassKeys.deviceXl}`]: {
    width: theme.breakpoints.values.xl,
  },
}))

const ViewportFrameComponent = dynamic<ViewportFrameComponentProps>(
  () =>
    import('./viewport-frame.component').then(
      (mod) => mod.ViewportFrameComponent,
    ),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)

export interface ViewportCanvasComponentProps
  extends ComponentProps<typeof ViewportCanvas> {
  pannerRef?: Ref<any>
}

export const ViewportCanvasComponent = forwardRef<
  any,
  ViewportCanvasComponentProps
>((props, ref) => {
  const { ...rest } = props

  const [devicePreview] = useAglynBesignerFlag('devicePreview')
  const artboardClass = clsx({
    [canvasArtboardClassKeys.responsive]:
      BesignerDeviceFlag.RESPONSIVE === devicePreview,
    [canvasArtboardClassKeys.deviceXs]: BesignerDeviceFlag.XS === devicePreview,
    [canvasArtboardClassKeys.deviceSm]: BesignerDeviceFlag.SM === devicePreview,
    [canvasArtboardClassKeys.deviceMd]: BesignerDeviceFlag.MD === devicePreview,
    [canvasArtboardClassKeys.deviceLg]: BesignerDeviceFlag.LG === devicePreview,
    [canvasArtboardClassKeys.deviceXl]: BesignerDeviceFlag.XL === devicePreview,
  })

  return (
    <ViewportCanvas
      ref={ref}
      id="aglyn:viewport-canvas"
      onMouseDown={(event) => {
        // Clicking empty canvas — the panning surface or the artboard's own
        // background (node clicks stop propagation in DraggableDroppable) —
        // deselects all (AGL-12).
        const target = event.target as HTMLElement
        if (
          target === event.currentTarget ||
          target.id === 'aglyn:viewport-artboard'
        ) {
          Besigner.focus.clearSelection()
        }
      }}
      {...rest}
    >
      <ViewportArtboard id="aglyn:viewport-artboard" className={artboardClass}>
        <ViewportFrameComponent />
      </ViewportArtboard>
    </ViewportCanvas>
  )
})

ViewportCanvasComponent.displayName = 'ViewportCanvasComponent'
ViewportCanvasComponent.aglyn = true

export default ViewportCanvasComponent
