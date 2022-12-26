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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import {
  Popper as MuiPopper,
  type PopperProps as MuiPopperProps,
} from '@mui/material'
import { VirtualElement } from '@popperjs/core'
import { observer } from 'mobx-react-lite'
import { forwardRef } from 'react'
import { Else, If, Then } from 'react-if'
import ElementOverlayActionsComponent from './element-overlay-actions.component'
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

export interface NodeOverlayProps extends Partial<MuiPopperProps> {
  variant: 'hovered' | 'selected'
}

const NodeOverlayRaw = forwardRef<any, NodeOverlayProps>((props, ref) => {
  const { variant, ...rest } = props || {}

  const state =
    variant === 'selected'
      ? Besigner.focus.state.lastSelected
      : Besigner.focus.state.hovered
  const $id = state?.$id
  const node = Aglyn.canvas.getNode($id)

  const elementRef = Besigner.refs.get($id)
  const isOpen = Boolean(elementRef?.node.current)

  const virtualElement: VirtualElement = {
    getBoundingClientRect: (): DOMRect => {
      if (elementRef?.node.current) {
        return elementRef?.node.current.getBoundingClientRect()
      }
      return {
        top: 10,
        left: 10,
        bottom: 20,
        right: 100,
        width: 90,
        height: 10,
      } as DOMRect
    },
    contextElement: elementRef?.node.current,
  }

  return (
    <MuiPopper
      ref={ref}
      anchorEl={virtualElement}
      placement="top-start"
      modifiers={outerModifiers}
      open={isOpen}
      keepMounted
      disablePortal
      {...rest}
    >
      {({ placement, TransitionProps }) => {
        return (
          <>
            <NodeOutline node={node} />

            <MuiPopper
              open
              anchorEl={virtualElement}
              placement={variant === 'hovered' ? 'top-start' : undefined}
              modifiers={innerModifiers}
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
              disablePortal
              {...rest}
            >
              <If condition={variant === 'selected'}>
                <Then>
                  <ElementOverlayActionsComponent $id={$id} />
                </Then>
                <Else>
                  <NodeQuickActions node={node} />
                </Else>
              </If>
            </MuiPopper>
          </>
        )
      }}
    </MuiPopper>
  )
})

NodeOverlayRaw.displayName = 'NodeOverlay'

export const NodeOverlay = observer(NodeOverlayRaw)
export default NodeOverlay
