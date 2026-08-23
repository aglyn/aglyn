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
import { isInlineEditWithin } from '../utils/inline-text-edit.store'
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
    // node.index throws for parentless nodes (the root, or a node whose
    // parent isn't loaded) — selecting the root via the breadcrumbs must not
    // crash the overlay.
    const nodeIndex = node?.parent ? node.index : null
    /**
     * The selection chrome stands down while this node is being edited in
     * place (AGL-2486).
     *
     * Zach: *"background becomes white in when editing"* and *"the element
     * outline doesn't wrap the text on the new line unless you are
     * editing it"*. Both are this overlay. It paints a translucent FILL
     * behind the node as well as an outline (`node-outline.tsx`), and while
     * the author is typing that tint is the one thing standing between the
     * in-place surface and its whole promise — that the text looks exactly
     * as it renders. It is also redundant: the caret and the toolbar
     * already say which element is being edited.
     *
     * Suppressing it here also takes the wrong geometry out of the edited
     * node's way. The rect below is a SINGLE `getBoundingClientRect()`, and
     * an inline run that has wrapped is a set of line fragments that one
     * rectangle cannot describe — the same lesson that removed the editing
     * overlay. That defect still applies to a merely SELECTED wrapped
     * inline element and is not fixed here; it wants `getClientRects()`,
     * drawn per fragment or as their union, and it is shared with the hover
     * outline and the collaborator selection boxes.
     */
    const isBeingEdited = isInlineEditWithin(elementRef?.current ?? null)
    const isOpen = Boolean(elementRef?.current) && !isBeingEdited
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

      // Scrolling any ancestor (the canvas container, panels, or the page
      // body) shifts getBoundingClientRect() values without triggering a
      // resize — capture-phase listener catches them all.
      window.addEventListener('scroll', update, { passive: true, capture: true })

      return () => {
        ro.disconnect()
        window.removeEventListener('resize', update)
        window.removeEventListener('scroll', update, { capture: true })
      }
      // node?.index changes when the node is reordered among siblings (e.g.
      // "shift up"/"shift down"). Reordering moves the same DOM element to a
      // new position without resizing it, so ResizeObserver won't catch it —
      // this dependency forces a rect recompute when sibling order changes.
    }, [elementRef, nodeIndex])

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
        // The anchor rect is viewport-relative; fixed positioning matches it
        // and, unlike the default absolute strategy, cannot extend the
        // document — an overlay past the fold otherwise grows the page,
        // which grows the scroll range, which moves the overlay again
        // (infinite scroll feedback).
        popperOptions={{ strategy: 'fixed' }}
        // Overlays belong to the canvas layer: rendering in place (no body
        // portal) keeps them inside the viewport's stacking context, so the
        // designer chrome (app bars, breadcrumbs) always paints above them.
        disablePortal
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
            popperOptions={{ strategy: 'fixed' }}
            disablePortal
            // keepMounted
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
