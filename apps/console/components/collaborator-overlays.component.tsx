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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn'
import { useRenderedCanvasElements } from '@aglyn/besigner-ui'
import { Box } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import type { PresenceEntry } from '../hooks/use-presence'

/** Where one collaborator's marks should be painted, in viewport pixels. */
interface Placement {
  uid: string
  displayName: string
  colour: string
  cursor?: { x: number; y: number }
  selection?: { top: number; left: number; width: number; height: number }
}

/**
 * Remote cursors and selections, drawn over the canvas (AGL-677).
 *
 * Positions are measured from the live DOM every frame rather than stored,
 * because everything underneath moves for reasons presence never hears
 * about: the canvas scrolls, panels open, the device-preview width changes,
 * and the document itself reflows as people edit it. A cached rectangle is
 * wrong within one frame of any of those, and a stale outline around the
 * wrong element is worse than no outline.
 *
 * The loop only runs while somebody else is actually in the room, so a
 * single-player session pays nothing.
 *
 * Elements come from the canvas's own `RenderedCanvasElements` registry, not
 * from `document.querySelector`. The `[data-aglyn="leaf:<id>"]` attribute
 * that `nodeElementSelector` builds belongs to the *site renderer* — it is
 * what interactions resolve against on a live page — and the besigner canvas
 * does not emit it. The canvas also renders into shadow roots, so a document
 * query would not reach its elements even if it did.
 */
export function CollaboratorOverlays({
  entries,
}: {
  entries: PresenceEntry[]
}) {
  const { elements } = useRenderedCanvasElements()
  const [placements, setPlacements] = useState<Placement[]>([])
  // The measuring loop reads the latest roster through a ref, so a cursor
  // tick (up to ~16/second, per collaborator) updates what it draws without
  // tearing down and restarting the loop.
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  // Identity of the collaborator set, so the effect re-arms when someone
  // joins or leaves but not on every cursor tick.
  const roster = entries
    .map((entry) => `${entry.uid}:${entry.colour}:${entry.displayName}`)
    .join('|')

  useEffect(() => {
    if (!entriesRef.current.length) {
      setPlacements([])
      return undefined
    }
    let frame = 0
    let stopped = false
    // The latest entries are read through a ref-like closure variable so the
    // measuring loop is not restarted 16 times a second by cursor updates.
    const measure = () => {
      if (stopped) return
      const registry = elements.current ?? {}
      const rootBox = registry[CANVAS_ROOT_ELEMENT_ID]?.node?.getBoundingClientRect()
      const next: Placement[] = []
      for (const entry of entriesRef.current) {
        const placement: Placement = {
          uid: entry.uid,
          displayName: entry.displayName,
          colour: entry.colour ?? '#1a73e8',
        }
        if (
          rootBox?.width &&
          typeof entry.cursorX === 'number' &&
          typeof entry.cursorY === 'number'
        ) {
          placement.cursor = {
            x: rootBox.left + entry.cursorX * rootBox.width,
            y: rootBox.top + entry.cursorY * rootBox.height,
          }
        }
        if (entry.selectedNodeId) {
          const box = registry[entry.selectedNodeId]?.node?.getBoundingClientRect()
          if (box?.width || box?.height) {
            placement.selection = {
              top: box.top,
              left: box.left,
              width: box.width,
              height: box.height,
            }
          }
        }
        if (placement.cursor || placement.selection) next.push(placement)
      }
      setPlacements(next)
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster])

  if (!placements.length) return null

  return (
    <Box
      aria-hidden
      sx={{
        position: 'fixed',
        inset: 0,
        // Above the canvas, below every dialog and menu — and never
        // intercepting a click, or the person you are watching would stop
        // being able to edit.
        zIndex: (theme) => theme.zIndex.appBar - 1,
        pointerEvents: 'none',
      }}
    >
      {placements.map((placement) => (
        <Box key={placement.uid}>
          {placement.selection ? (
            <Box
              sx={{
                position: 'absolute',
                top: placement.selection.top,
                left: placement.selection.left,
                width: placement.selection.width,
                height: placement.selection.height,
                border: `2px solid ${placement.colour}`,
                borderRadius: '2px',
                boxSizing: 'border-box',
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  top: -18,
                  left: -2,
                  px: 0.75,
                  height: 18,
                  lineHeight: '18px',
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  color: '#fff',
                  bgcolor: placement.colour,
                  borderRadius: '2px 2px 0 0',
                }}
              >
                {placement.displayName}
              </Box>
            </Box>
          ) : null}
          {placement.cursor ? (
            <Box
              sx={{
                position: 'absolute',
                top: placement.cursor.y,
                left: placement.cursor.x,
                transform: 'translate(-1px, -1px)',
              }}
            >
              {/* A pointer drawn rather than an emoji or an icon font: it has
                  to read at any zoom and sit exactly on the hot spot. */}
              <Box
                component="svg"
                viewBox="0 0 16 16"
                sx={{ width: 16, height: 16, display: 'block' }}
              >
                <path
                  d="M1 1l5.5 13 2-5.5L14 6.5z"
                  fill={placement.colour}
                  stroke="#fff"
                  strokeWidth="1"
                  strokeLinejoin="round"
                />
              </Box>
              {!placement.selection ? (
                <Box
                  sx={{
                    ml: 1.25,
                    mt: -0.5,
                    px: 0.75,
                    height: 18,
                    lineHeight: '18px',
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    color: '#fff',
                    bgcolor: placement.colour,
                    borderRadius: '9px',
                    display: 'inline-block',
                  }}
                >
                  {placement.displayName}
                </Box>
              ) : null}
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

CollaboratorOverlays.displayName = 'CollaboratorOverlays'

export default CollaboratorOverlays
