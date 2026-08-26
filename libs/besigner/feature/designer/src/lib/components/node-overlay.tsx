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
  type ElementFragmentRects,
  getElementFragmentRects,
} from '@aglyn/shared-util-dom'
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

const DEFAULT_GEOMETRY: ElementFragmentRects = {
  fragments: [DEFAULT_RECT as any],
  union: DEFAULT_RECT as any,
  first: DEFAULT_RECT as any,
}

/**
 * Whole-pixel identity of a measured geometry (AGL-2486).
 *
 * The measuring callback runs on every scroll event anywhere on the page, on
 * every resize, and on every ResizeObserver tick. Before this it called
 * `setRect(serializeRect(...))` unconditionally — a NEW object each time, so
 * scrolling a side panel re-rendered this observer and everything under it at
 * event rate even though the element had not moved. Fragment sets are larger,
 * and committing a fresh ARRAY every frame is exactly the shape that froze a
 * tab in the collaborator overlay on 2026-08-22.
 *
 * MEASURING is cheap; COMMITTING is not. Rounding first means sub-pixel
 * jitter cannot churn a render on its own. This is strictly less per-event
 * work than the single-rect code did, not more.
 */
function fingerprintGeometry(geometry: ElementFragmentRects): string {
  return geometry.fragments
    .map(
      (rect) =>
        `${Math.round(rect.left)},${Math.round(rect.top)},` +
        `${Math.round(rect.width)},${Math.round(rect.height)}`,
    )
    .join(';')
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
    // Node.index throws for parentless nodes (the root, or a node whose
    // parent isn't loaded) — selecting the root via the breadcrumbs must not
    // crash the overlay.
    const nodeIndex = node?.parent ? node.index : null
    /**
     * The selection chrome stands down while this node is being edited in
     * place (AGL-2486).
     *
     * outline doesn't wrap the text on the new line unless you are
     * editing it"*. Both are this overlay. It paints a translucent FILL
     * behind the node as well as an outline (`node-outline.tsx`), and while
     * the author is typing that tint is the one thing standing between the
     * in-place surface and its whole promise — that the text looks exactly
     * as it renders. It is also redundant: the caret and the toolbar
     * already say which element is being edited.
     *
     * Suppressing it here also took the wrong geometry out of the edited
     * node's way while the geometry was still wrong. It no longer is: the
     * chrome below is drawn from `getClientRects()`, one outline per line
     * fragment, so a SELECTED wrapped inline run is outlined correctly too.
     * Standing the fill down during an edit remains right for its own
     * reason — the in-place surface must look exactly as it renders.
     */
    const isBeingEdited = isInlineEditWithin(elementRef?.current ?? null)
    const isOpen = Boolean(elementRef?.current) && !isBeingEdited
    const [geometry, setGeometry] =
      useState<ElementFragmentRects>(DEFAULT_GEOMETRY)
    const { union: rect, fragments, first } = geometry

    useIsomorphicLayoutEffect(() => {
      const el = elementRef?.current
      if (!el || !('getBoundingClientRect' in el)) return

      /**
       * The element's REAL shape, not its bounding box (AGL-2486).
       *
       * fragments and one rectangle cannot describe it — see
       * `getElementFragmentRects` for why the union is not merely imprecise
       * but a different shape. A block yields one fragment that IS the
       * bounding rect, so nothing about block geometry changes.
       */
      let committed = ''
      const update = () => {
        const next = getElementFragmentRects(el)
        const fingerprint = fingerprintGeometry(next)
        if (fingerprint === committed) return
        committed = fingerprint
        setGeometry(next)
      }
      update()

      // Re-sync when the element or its shadow-DOM host resizes (covers prop
      // changes that affect layout, e.g. flexDirection column→row) and when
      // the canvas container resizes or the window resizes.
      // ResizeObserver is not in every jsdom setup, and an unguarded
      // constructor in a layout effect takes the whole overlay down with it.
      // The listeners below still carry scroll and resize. Same guard, for
      // the same reason, as `use-anchored-rect.ts`.
      const ro =
        typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
      ro?.observe(el)
      const shadowHost = (el.getRootNode() as ShadowRoot | null)?.host ?? null
      if (shadowHost) ro?.observe(shadowHost)
      window.addEventListener('resize', update, { passive: true })

      // Scrolling any ancestor (the canvas container, panels, or the page
      // body) shifts getBoundingClientRect() values without triggering a
      // resize — capture-phase listener catches them all.
      window.addEventListener('scroll', update, { passive: true, capture: true })

      return () => {
        ro?.disconnect()
        window.removeEventListener('resize', update)
        window.removeEventListener('scroll', update, { capture: true })
      }
      // Node?.index changes when the node is reordered among siblings (e.g.
      // "shift up"/"shift down"). Reordering moves the same DOM element to a
      // new position without resizing it, so ResizeObserver won't catch it —
      // this dependency forces a rect recompute when sibling order changes.
    }, [elementRef, nodeIndex])

    // Popper types its anchor rect as a full `DOMRect`; the measured rects
    // are plain geometry and carry no `toJSON`, which popper never calls.
    const virtualElement = useMemo<() => VirtualElement>(() => {
      return () => ({
        getBoundingClientRect: () => rect as unknown as DOMRect,
      })
    }, [rect])

    /**
     * Where the label chip, the quick actions and the DRAG affordance hang
     * (AGL-2486).
     *
     * They used to hang off the union rect, and a fragment set has no obvious
     * single anchor. The union corner is the wrong one: an inline run that
     * begins mid-line and wraps has a union whose left edge comes from the
     * SECOND line, so a chip placed there floats above a sibling's text
     * rather than above the element it names — and the drag handle would be
     * offered at a point the element does not occupy.
     *
     * The first fragment is where the run STARTS in reading order. It is
     * where the eye already is, it is always on the element, and for a block
     * — every one of which has exactly one fragment — it is the union, so
     * nothing moves for the overwhelming majority of nodes.
     */
    const anchorElement = useMemo<() => VirtualElement>(() => {
      return () => ({
        getBoundingClientRect: () => first as unknown as DOMRect,
      })
    }, [first])

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
        // Transition
        {...rest}
      >
        <div>
          {/* One outline per line fragment, positioned relative to the
              union the popper is anchored on. A block has exactly one
              fragment and it IS the union, so it lands at 0,0 with the
              union's size — the same box, from the same numbers, as
              before AGL-2486. The chip renders once, below, so a two-line
              heading reads as one selected element with two line boxes,
              which is what a browser's own selection looks like. */}
          {fragments.map((fragment, index) => (
            <NodeOutline
              key={index}
              node={node}
              data-aglyn-fragment={index}
              style={{
                left: fragment.left - rect.left,
                top: fragment.top - rect.top,
                right: 'auto',
                bottom: 'auto',
                width: fragment.width,
                height: fragment.height,
              }}
            />
          ))}

          <MuiPopper
            open={isOpen}
            anchorEl={anchorElement}
            placement={variant === 'hovered' ? 'top-start' : undefined}
            modifiers={innerModifiers}
            popperOptions={{ strategy: 'fixed' }}
            disablePortal
            // KeepMounted
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
