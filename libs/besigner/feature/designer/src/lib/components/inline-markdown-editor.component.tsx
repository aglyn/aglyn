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

import * as Aglyn from '@aglyn/aglyn'
import { MarkdownField } from '@aglyn/aglyn-markdown-editor'
import * as Besigner from '@aglyn/besigner'
import { Box, Button, Paper, Typography } from '@mui/material'
import { observer } from 'mobx-react-lite'
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
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
    Aglyn.canvas.updateNodeProps(current, {
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

  // A double-click inside the editor selects a word. It must never reach the
  // canvas, whose panning surface treats a double-click as zoom-in
  // (`ZoomablePanningComponent`). Node double-clicks are already consumed at
  // the leaf; this covers the overlay that sits on top of it.
  const stop = useCallback((event: MouseEvent) => {
    event.stopPropagation()
  }, [])

  // Read at render, which `useAnchoredRect` makes safe: it re-renders on every
  // scroll and resize, so these are never a stale snapshot.
  const viewportWidth =
    typeof window === 'undefined' ? Infinity : window.innerWidth
  const viewportHeight =
    typeof window === 'undefined' ? Infinity : window.innerHeight
  const width = Math.max(live.width, 360)
  // A long document is usually TALLER than the viewport, so the element's top
  // edge is frequently scrolled off the top of the screen while it is being
  // edited. The editor waits at the nearest edge until the element comes back
  // rather than following it out of sight; KEEP_VISIBLE is how much of it has
  // to remain reachable at the bottom.
  const KEEP_VISIBLE = 160

  return (
    <Box
      data-aglyn="overlay:inline-markdown-editor"
      data-testid="inline-markdown-editor"
      onKeyDown={handleKeyDown}
      onMouseDown={stop}
      onDoubleClick={stop}
      sx={{
        position: 'fixed',
        left: clampToViewport(live.left, width, viewportWidth),
        top: clampToViewport(live.top, KEEP_VISIBLE, viewportHeight),
        width,
        maxWidth: '90vw',
        zIndex: (theme) => theme.zIndex.modal,
      }}
    >
      <Paper elevation={8} sx={{ p: 1, maxHeight: '75vh', overflowY: 'auto' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 0.5,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {'Editing on the canvas — changes are kept as you type'}
          </Typography>
          <Button size="small" color="primary" onClick={handleDone}>
            {'Done'}
          </Button>
        </Box>
        <MarkdownField
          label={String(
            node?.componentSchema?.attributes?.find(
              (attribute) => attribute?.name === attributeName,
            )?.label ?? 'Content',
          )}
          value={value}
          onChange={handleChange}
          editorRef={editorRef}
          onPickImageFromMedia={onPickImageFromMedia}
          // The OPEN rect, deliberately, not the live one: position follows the
          // element, but the editor's own height must not change under the
          // author mid-sentence just because the canvas relaid out.
          minHeight={Math.min(Math.max(rect.height, 200), 520)}
        />
      </Paper>
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
