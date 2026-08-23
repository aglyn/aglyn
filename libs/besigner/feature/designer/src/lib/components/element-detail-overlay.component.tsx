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

import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Box, IconButton, Paper, Popper, Typography } from '@mui/material'
import { useEffect } from 'react'
import { describeElement } from '../utils/describe-element'
import ElementDetailView from './element-detail.component'

/** Gap between the card and the panel, in px. Crossed within the close delay. */
const ANCHOR_OFFSET = 10

export interface ElementDetailOverlayProps {
  /** The picker item to describe, or null when nothing is active. */
  item: any
  /** The card the panel points at. */
  anchor: HTMLElement | null
  /** Held open by a click rather than by the pointer. */
  pinned?: boolean
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onDismiss?: () => void
}

/**
 * The Elements panel's detail, floated out over the canvas (AGL-2486).
 *
 * It started as a band docked under the grid, which was the safe answer to
 * "a tooltip must not cover what it describes" and a bad answer to
 * everything else: a ~300px column cannot hold a preview, a description,
 * derived facts, an attribute list and a link, so the preview came out a
 * sliver and the prose wrapped to nothing.
 *
 * Floating gives it real width. What floating costs — and what makes most
 * of these unusable — is that the content follows the pointer, so moving
 * toward a link inside it changes what it says. That is solved in
 * `useDetailHoverIntent`, not here: a click PINS, and a pin outranks the
 * pointer, so everything in this panel is reachable. This component only has
 * to not undo that, which means keeping its own pointer events live and
 * feeding enter/leave back to the same intent state.
 *
 * Anchored `right-start` so it opens INTO the canvas and never covers the
 * card being pointed at — the failure the box-styler tooltips had. Portalled,
 * so the panel's own `overflow: auto` cannot clip it, and out of flow, so it
 * cannot push the grid and slide the card out from under the cursor the way
 * the docked band did.
 */
export function ElementDetailOverlay(props: ElementDetailOverlayProps) {
  const { item, anchor, pinned, onPointerEnter, onPointerLeave, onDismiss } =
    props

  // Escape dismisses a pinned panel — it is modeless, so it must not be a
  // trap, and the pointer is not the way out of a pinned one.
  useEffect(() => {
    if (!pinned) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinned, onDismiss])

  const detail = describeElement(item)
  const open = Boolean(item && anchor && detail)

  return (
    <Popper
      open={open}
      anchorEl={anchor}
      placement="right-start"
      data-testid="element-detail-overlay"
      modifiers={[
        { name: 'offset', options: { offset: [0, ANCHOR_OFFSET] } },
        // Flip only as a last resort: flipping to `left` would put the panel
        // over the grid it came from.
        { name: 'flip', options: { fallbackPlacements: ['right', 'bottom-start'] } },
        { name: 'preventOverflow', options: { padding: 8 } },
      ]}
      // BELOW modal, not above it. `tooltip` (1500) outranks `modal` (1300),
      // so the panel painted over the element dialog's own backdrop. Anything
      // that floats over the canvas has to lose to a dialog, or it becomes a
      // bug for every modal added after it. Taken from the theme scale rather
      // than written as a literal, so it moves if the scale does.
      sx={{ zIndex: (theme) => theme.zIndex.modal - 1 }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <Paper
        elevation={8}
        sx={{
          // Floating means it is no longer bounded by a ~300px dock, so it
          // takes the room. Width is what actually enlarges the preview:
          // the stage composes at a desktop width and scales to fit, so a
          // wider panel is a bigger picture, not just more whitespace.
          width: 460,
          maxHeight: '78vh',
          overflowY: 'auto',
          p: 1.5,
          border: 1,
          borderColor: 'divider',
        }}
      >
        {pinned ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: 0.5,
            }}
          >
            <Typography variant="caption" color="textSecondary">
              {'Pinned — click the element again to release'}
            </Typography>
            <IconButton
              size="small"
              aria-label="close element detail"
              onClick={onDismiss}
            >
              <MdiIcon path={ICON_VARIANT_CLOSE.path} fontSize="inherit" />
            </IconButton>
          </Box>
        ) : null}
        {/* The same content component the dialog renders — one description of
            an element, two placements. */}
        <ElementDetailView detail={detail} node={item} previewHeight={300} />
      </Paper>
    </Popper>
  )
}
ElementDetailOverlay.displayName = 'ElementDetailOverlay'

export default ElementDetailOverlay
