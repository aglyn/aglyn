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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import { useIsomorphicLayoutEffect } from '@aglyn/shared-ui-jsx'
import {
  Popper as MuiPopper,
  type PopperProps as MuiPopperProps,
} from '@mui/material'
import { VirtualElement } from '@popperjs/core'
import { observer } from 'mobx-react-lite'
import { forwardRef, useMemo, useState } from 'react'
import NodeOutline from './node-outline'
import NodeQuickActions from './node-quick-actions'

const outerModifiers = [
  {
    name: 'flip',
    enabled: false,
    options: {
      altBoundary: false,
      rootBoundary: 'viewport',
      padding: 0,
    },
  },
  {
    name: 'preventOverflow',
    enabled: false,
    options: {
      altAxis: false,
      altBoundary: false,
      tether: false,
      rootBoundary: 'viewport',
      padding: 0,
    },
  },
]

const innerModifiers = [
  {
    name: 'flip',
    enabled: true,
    options: {
      altBoundary: true,
      rootBoundary: 'viewport',
      padding: 0,
    },
  },
  {
    name: 'preventOverflow',
    enabled: true,
    options: {
      altAxis: true,
      altBoundary: true,
      tether: true,
      rootBoundary: 'viewport',
      padding: 0,
    },
  },
]

const DEFAULT_RECT = {
  top: 0,
  left: 0,
  width: 0,
  height: 0,
} as DOMRect

export function serializeRect(rect: DOMRect): any {
  return JSON.parse(JSON.stringify(rect || DEFAULT_RECT))
}

export interface NodeOverlayProps extends Partial<MuiPopperProps> {
  variant: 'hovered' | 'selected'
}

const NodeOverlay = observer(
  forwardRef<any, NodeOverlayProps>((props, ref) => {
    const { variant, ...rest } = props || {}

    const state =
      variant === 'selected'
        ? Besigner.focus.getLastSelected()
        : Besigner.focus.getHovered()
    const $id = state?.$id
    const node = Aglyn.canvas.getNode($id)

    const elementRef = Besigner.refs.get($id)
    const isOpen = Boolean(elementRef?.current)
    const [rect, setRect] = useState<DOMRect>(DEFAULT_RECT)

    useIsomorphicLayoutEffect(() => {
      const el = elementRef?.current
      if (!el || !('getBoundingClientRect' in el)) return

      const update = () => setRect(serializeRect(el.getBoundingClientRect()))
      update()

      // Re-sync when the element or its shadow-DOM host resizes (covers prop
      // changes that affect layout, e.g. flexDirection column→row) and when
      // the canvas container resizes or the window resizes.
      const ro = new ResizeObserver(update)
      ro.observe(el)
      const shadowHost = (el.getRootNode() as ShadowRoot | null)?.host ?? null
      if (shadowHost) ro.observe(shadowHost)
      window.addEventListener('resize', update, { passive: true })

      // In device preview mode the artboard has a fixed width so the canvas
      // scroll container can scroll — scroll shifts getBoundingClientRect()
      // values without triggering a resize, so we need a scroll listener too.
      const scrollContainer = document.getElementById('aglyn:viewport-canvas')
      scrollContainer?.addEventListener('scroll', update, { passive: true })

      return () => {
        ro.disconnect()
        window.removeEventListener('resize', update)
        scrollContainer?.removeEventListener('scroll', update)
      }
    }, [elementRef])

    const virtualElement = useMemo<() => VirtualElement>(() => {
      return () => ({
        getBoundingClientRect: () => rect,
      })
    }, [rect])

    return (
      <MuiPopper
        ref={ref}
        anchorEl={virtualElement}
        placement="top-start"
        modifiers={outerModifiers}
        open={isOpen}
        keepMounted
        // disablePortal
        // transition
        {...rest}
      >
        <div>
          <NodeOutline node={node} style={{ width: rect.width, height: rect.height }} />

          <MuiPopper
            open={isOpen}
            anchorEl={virtualElement}
            placement={variant === 'hovered' ? 'top-start' : undefined}
            modifiers={innerModifiers}
            // keepMounted
            // disablePortal
            // transition
            sx={{
              ['&[data-popper-placement^=top] #aglyn\\:element-overlay-label']:
                {
                  borderTopLeftRadius: 3,
                  borderTopRightRadius: 3,
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                },
              ['&[data-popper-placement^=bottom] #aglyn\\:element-overlay-label']:
                {
                  borderTopLeftRadius: 0,
                  borderTopRightRadius: 0,
                  borderBottomLeftRadius: 3,
                  borderBottomRightRadius: 3,
                },
            }}
          >
            <NodeQuickActions
              node={node}
              variant={variant === 'selected' ? 'actions' : 'label'}
            />
          </MuiPopper>
        </div>
      </MuiPopper>
    )
  }),
)

NodeOverlay.displayName = 'NodeOverlay'

export default NodeOverlay
