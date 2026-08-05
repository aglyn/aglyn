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

import { mdiPlusBoxOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { alpha, Box } from '@mui/material'
import { useCallback } from 'react'
import { useAddElementDrawerCallback } from '../hooks/use-add-element-drawer-callback'

/** Editor chrome, so the accent is literal — see `SlotMarker` in node-leaf. */
const SLOT_ACCENT = '#00B0FF'

/**
 * Stand-in for an empty screen document.
 *
 * An empty screen has nothing to aim at. Inside a shared layout that is not
 * merely unhelpful, it is invisible: the layout's slot passes its children
 * straight through, so a screen with no nodes collapses to a ZERO-HEIGHT
 * strip pinched between locked chrome — on the marketing site the nav
 * rendered directly into the footer with no gap at all. There was no region
 * to click, nothing to drop onto, and no hint that the screen's own content
 * belongs in between.
 *
 * Rendering this as the root leaf's child rather than as a sibling is what
 * makes drag-and-drop work: the root is already wrapped in
 * `DraggableDroppable`, so giving it height is enough for a drop to resolve
 * against the document root. Clicking opens the same Add Element drawer the
 * INSERT menu uses, with no parent — which the drawer callback resolves to
 * the root.
 */
export function EmptyDocumentSlot() {
  const addElement = useAddElementDrawerCallback()
  const handleClick = useCallback(() => {
    // No parent: the drawer callback falls back to the document root, which
    // is the only correct target for a document with nothing in it.
    void addElement()
  }, [addElement])

  return (
    <Box
      data-aglyn-empty-document=""
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleClick()
        }
      }}
      sx={{
        // NO outer margin (AGL-1265). This box IS the document: it is the
        // root leaf's only child, and a drop anywhere on it resolves against
        // the document root. A margin here bought nothing and cost alignment
        // — measured, `m: 2` pushed the dashed border 16px inside the root's
        // border box on the LEFT and RIGHT, while the vertical margins
        // collapsed straight through the root and showed no gap at all. So
        // the one dashed rectangle on an empty canvas sat inside the grey
        // dotted document outline and inside the selection overlay (which
        // measures the root leaf, `node-overlay.tsx`), reading as an editor
        // that cannot line its own chrome up. Padding, not margin, keeps the
        // label off the edge.
        p: 4,
        minHeight: 220,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        cursor: 'pointer',
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: SLOT_ACCENT,
        backgroundColor: alpha(SLOT_ACCENT, 0.06),
        borderRadius: 1,
        color: 'text.secondary',
        fontFamily: 'sans-serif',
        textAlign: 'center',
        transition: 'background-color 120ms ease, border-color 120ms ease',
        '&:hover, &:focus-visible': {
          backgroundColor: alpha(SLOT_ACCENT, 0.12),
        },
      }}
    >
      <MdiIcon path={mdiPlusBoxOutline.path} sx={{ color: SLOT_ACCENT }} />
      <Box component="span" sx={{ color: SLOT_ACCENT, fontWeight: 700 }}>
        {'This screen is empty'}
      </Box>
      <Box component="span" sx={{ fontSize: 13 }}>
        {'Drag an element here, or click to add one'}
      </Box>
    </Box>
  )
}
EmptyDocumentSlot.displayName = 'EmptyDocumentSlot'

export default EmptyDocumentSlot
