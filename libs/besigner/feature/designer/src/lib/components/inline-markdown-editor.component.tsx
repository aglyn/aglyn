/**
 * @license
 * Copyright 2026 Aglyn LLC
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
'use client'

import type * as Aglyn from '@aglyn/aglyn'
import { canvas } from '@aglyn/aglyn'
import { MarkdownField } from '@aglyn/aglyn-markdown-editor'
import * as Besigner from '@aglyn/besigner'
import { Box, Button, Paper, Typography } from '@mui/material'
import { observer } from 'mobx-react-lite'
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  clampToViewport,
  useAnchoredRect,
} from '../hooks/use-anchored-rect'
import { useDebouncedCommit } from '../hooks/use-debounced-commit'
import { useMarkdownMediaPicker } from '../hooks/use-markdown-media-picker'
import {
  inlineMarkdownEdit,
  type InlineMarkdownEditRect,
} from '../utils/inline-markdown-edit.store'

/** The canvas scroller: the box the editor is clipped to and scrolls. */
const CANVAS_VIEWPORT_ID = 'aglyn:viewport-canvas'
const NO_RECT = { left: 0, top: 0, width: 0, height: 0 }
/** The editor box's padding, `p: 1`. */
const PAPER_PADDING = 8

/** An element's height, kept current as it resizes. */
function useMeasuredHeight(): [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    if (!element) return undefined
    const update = () => setHeight(element.offsetHeight)
    update()
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [element])
  return [setElement, height]
}

/**
 * Whether something between the wheel's target and the editor will scroll
 * on its own in this direction: a wide table, a long snippet. Those keep the
 * wheel; everything else hands it to the canvas.
 */
function scrollsInside(
  target: EventTarget | null,
  root: Element,
  deltaX: number,
  deltaY: number,
): boolean {
  let element = target instanceof Element ? target : null
  while (element && element !== root) {
    if (element instanceof HTMLElement) {
      const style = getComputedStyle(element)
      const canY =
        /auto|scroll/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight &&
        (deltaY > 0
          ? element.scrollTop + element.clientHeight < element.scrollHeight
          : element.scrollTop > 0)
      const canX =
        /auto|scroll/.test(style.overflowX) &&
        element.scrollWidth > element.clientWidth &&
        (deltaX > 0
          ? element.scrollLeft + element.clientWidth < element.scrollWidth
          : element.scrollLeft > 0)
      if ((deltaY !== 0 && canY) || (deltaX !== 0 && canX)) return true
    }
    element = element.parentElement
  }
  return false
}

interface SurfaceProps {
  node: Aglyn.NodeSchema<any>
  rect: InlineMarkdownEditRect
  /** The element `rect` was measured from, re-measured as the canvas moves. */
  anchor?: Element
  attributeName: string
  initialValue: string
  /** Whether the canvas selection still names the node being edited. */
  selected: boolean
}

/**
 * The mounted half. Everything that can lose an author's work lives here, and
 * it is deliberately the same machinery the attributes panel uses.
 *
 * ## When the edit reaches the model
 *
 * `MarkdownVisualEditor` emits on every input event, so the newest string is
 * always in hand. From there this is `useDebouncedCommit` (AGL-567), exactly as
 * the panel wires it: a 250 ms trailing debounce, plus the hook's own
 * flush-on-unmount. Every way of leaving the editor unmounts this component —
 * Done, Escape, the selection moving to another node, the screen changing, the
 * designer closing — so every exit path flushes. There is NO discard path, and
 * that is the point: with a debounced commit a "cancel" could only ever throw
 * away the last 250 ms of a document that is otherwise already written, which
 * is a worse lie than committing and leaving Cmd+Z to do the undoing.
 *
 * What is deliberately NOT here is a commit on blur. The toolbar, the link
 * popover and the URL dialog all move focus (two of them into a portal), so a
 * blur-committed local draft would strand everything typed since the previous
 * focus change — silently, with the canvas still showing the right text. The
 * panel's wrapper learned this the same way (AGL-1616).
 *
 * ## Why the value is not re-derived
 *
 * `initialValue` seeds local state once and the node's props are never read
 * back into the editor. The editor re-parses its row model whenever the
 * incoming value differs from the string it last emitted, resetting undo and
 * the caret; feeding a commit — or a co-editing peer's write — back in would do
 * that mid-sentence.
 */
const InlineMarkdownEditorSurface = observer(function InlineMarkdownEditorSurface(
  props: SurfaceProps,
) {
  const { node, rect, anchor, attributeName, initialValue, selected } = props
  // Follows the element as the canvas scrolls or resizes (AGL-1644).
  const live = useAnchoredRect(anchor, rect)
  const [value, setValue] = useState(initialValue)
  const latestRef = useRef(initialValue)
  const committedRef = useRef(initialValue)
  // The toolbar's image action opens the host's media library rather than a
  // "paste a URL" prompt (AGL-1645). The picker is a modal that takes focus,
  // which is exactly what a blur-committed editor cannot survive — and the
  // reason this one commits on a debounce instead is written out above.
  const { editorRef, onPickImageFromMedia } = useMarkdownMediaPicker()

  const commit = useCallback(() => {
    const current = inlineMarkdownEdit.node ?? node
    if (!current) return
    if (latestRef.current === committedRef.current) return
    committedRef.current = latestRef.current
    // Read the node's props at commit time, not at open: `updateNodeProps`
    // REPLACES the props object, so anything a peer or the panel changed while
    // the editor was open has to be spread from the live node.
    canvas.updateNodeProps(current, {
      ...current.props,
      [attributeName]: latestRef.current,
    })
  }, [attributeName, node])

  const { schedule } = useDebouncedCommit(commit)

  const handleChange = useCallback(
    (next: string) => {
      latestRef.current = next
      setValue(next)
      schedule()
    },
    [schedule],
  )

  // The edit follows the selection: the double-click's own mousedown selected
  // this node, so the selection moving off it (another node, the hierarchy
  // tree, a click on empty canvas) means the author is done here. Closing
  // unmounts this surface, which flushes.
  useEffect(() => {
    if (!selected) inlineMarkdownEdit.close()
  }, [selected])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    // Escape CLOSES and keeps. It is not a cancel — see the commit note above.
    event.stopPropagation()
    inlineMarkdownEdit.close()
  }, [])

  const handleDone = useCallback(() => {
    inlineMarkdownEdit.close()
  }, [])

  const label = String(
    node?.componentSchema?.attributes?.find(
      (attribute) => attribute?.name === attributeName,
    )?.label ?? 'Content',
  )

  // A double-click inside the editor selects a word. It must never reach the
  // canvas, whose panning surface treats a double-click as zoom-in
  // (`ZoomablePanningComponent`). Node double-clicks are already consumed at
  // the leaf; this covers the overlay that sits on top of it.
  const stop = useCallback((event: MouseEvent) => {
    event.stopPropagation()
  }, [])

  /**
   * The editor covers the element, all of it, and the canvas scrolls it
   * (AGL-4216).
   *
   * It used to be a box capped at 75% of the screen that scrolled inside
   * itself, inside an editor that also scrolled itself past 480px. Two scrolls
   * deep, the toolbar was gone the moment the author scrolled to the part
   * they wanted to change. Now the field grows with the document and lies
   * over the element as it renders; the header and toolbar pin to the top of
   * the canvas while any of it is in view and leave with its bottom edge, as
   * a sticky header does on a page.
   *
   * It cannot be CSS sticky: the editor sits over the canvas in the overlay
   * layer, not inside the scroller (whose artboard clips with `overflow:
   * hidden`, which would switch sticky off anyway), so the offset is worked
   * out from where the element is against the canvas's own top edge.
   */
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setScroller(document.getElementById(CANVAS_VIEWPORT_ID))
  }, [])
  const viewport = useAnchoredRect(scroller ?? undefined, NO_RECT)
  const [measureBox, boxHeight] = useMeasuredHeight()
  const [measureGroup, groupHeight] = useMeasuredHeight()

  // Scrolling over the editor scrolls the canvas under it. The editor is a
  // fixed overlay, so the browser hands its wheel to the page instead: the
  // document sat still and the designer's own chrome scrolled out of place.
  // A native listener, because React registers wheel as passive and a
  // passive listener cannot stop the page scrolling as well.
  const [editorEl, setEditorEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!editorEl || !scroller) return undefined
    const onWheel = (event: globalThis.WheelEvent) => {
      if (event.ctrlKey) return
      if (scrollsInside(event.target, editorEl, event.deltaX, event.deltaY)) {
        return
      }
      event.preventDefault()
      scroller.scrollBy({ left: event.deltaX, top: event.deltaY })
    }
    editorEl.addEventListener('wheel', onWheel, { passive: false })
    return () => editorEl.removeEventListener('wheel', onWheel)
  }, [editorEl, scroller])

  const clip = viewport.width > 0 ? viewport : null
  const area = clip ?? {
    left: 0,
    top: 0,
    width: typeof window === 'undefined' ? Infinity : window.innerWidth,
    height: typeof window === 'undefined' ? Infinity : window.innerHeight,
  }
  const width = Math.min(Math.max(live.width, 360), area.width - 16)
  const left = clampToViewport(live.left - area.left, width, area.width)
  const top = live.top - area.top
  // Pinned flush with the canvas's top edge while the element's top is above
  // it (the group rests 8px into the box, under its padding), and never past
  // the element's bottom, where the box's bottom padding stays below it.
  const toolbarOffset = Math.max(
    0,
    Math.min(-top - PAPER_PADDING, boxHeight - groupHeight - PAPER_PADDING * 2),
  )

  return (
    <Box
      data-aglyn="overlay:inline-markdown-clip"
      sx={{
        position: 'fixed',
        left: area.left,
        top: area.top,
        width: area.width,
        height: area.height,
        // The canvas's own edges: the part of the editor scrolled above the
        // canvas must not paint over the designer's app bar.
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: (theme) => theme.zIndex.modal,
      }}
    >
      <Box
        data-aglyn="overlay:inline-markdown-editor"
        data-testid="inline-markdown-editor"
        onKeyDown={handleKeyDown}
        onMouseDown={stop}
        onDoubleClick={stop}
        ref={setEditorEl}
        sx={{
          position: 'absolute',
          left,
          top,
          width,
          maxWidth: '90vw',
          pointerEvents: 'auto',
        }}
      >
        <Paper ref={measureBox} elevation={8} sx={{ p: 1 }}>
          <MarkdownField
            label={label}
            value={value}
            onChange={handleChange}
            editorRef={editorRef}
            onPickImageFromMedia={onPickImageFromMedia}
            toolbarOffset={toolbarOffset}
            toolbarGroupRef={measureGroup}
            toolbarHeader={
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  pb: 0.5,
                }}
              >
                <Typography variant="caption" color="text.secondary" noWrap>
                  <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                    {label}
                  </Box>
                  {' · editing on the canvas — changes are kept as you type'}
                </Typography>
                <Button size="small" color="primary" onClick={handleDone}>
                  {'Done'}
                </Button>
              </Box>
            }
            // The editor grows with the document instead of scrolling inside
            // itself, and starts at least as tall as the element it covers so
            // nothing of the rendered element shows around it. The OPEN rect,
            // deliberately: the height must not change under the author
            // mid-sentence just because the canvas relaid out.
            maxHeight="none"
            minHeight={Math.max(rect.height - groupHeight - 24, 200)}
          />
        </Paper>
      </Box>
    </Box>
  )
})
InlineMarkdownEditorSurface.displayName = 'InlineMarkdownEditorSurface'

/**
 * In-place markdown editing on the besigner canvas (AGL-1624).
 *
 * Double-clicking a component whose schema declares a `FieldComponentType
 * .MARKDOWN` attribute opens the WYSIWYG over the element instead of sending
 * the author to the attributes panel — the canvas half of AGL-1616, which
 * shipped the panel half.
 *
 * Mounted once next to `InlineTextEditorComponent` in the viewport overlays,
 * outside the closed canvas shadow root, so it positions in screen
 * coordinates. `key`ed on the node so switching nodes remounts the surface,
 * which is what turns every close into a flush.
 */
export const InlineMarkdownEditorComponent = observer(
  function InlineMarkdownEditorComponent() {
    const node = inlineMarkdownEdit.node
    const rect = inlineMarkdownEdit.rect
    const attributeName = inlineMarkdownEdit.attributeName
    if (!node || !rect || !attributeName) return null
    return (
      <InlineMarkdownEditorSurface
        key={`${node.$id}:${attributeName}`}
        node={node}
        rect={rect}
        anchor={inlineMarkdownEdit.anchor}
        attributeName={attributeName}
        initialValue={inlineMarkdownEdit.initialValue}
        selected={Besigner.focus.isNodeSelected(node)}
      />
    )
  },
)
InlineMarkdownEditorComponent.displayName = 'InlineMarkdownEditorComponent'

export default InlineMarkdownEditorComponent
