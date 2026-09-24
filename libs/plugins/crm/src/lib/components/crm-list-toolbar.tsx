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

import { Stack } from '@mui/material'
import type { ReactNode } from 'react'

/*
 * The two halves of a CRM list card's chrome (AGL-3311).
 *
 * A list card has record actions (Import CSV, Export CSV, New …) and list
 * filters (the saved view, the selects, the search). Neither belongs in
 * `CardDisplay`'s `actions`: that is MUI's `CardActions`, a footer, so a list
 * that passes them there draws its filters under the grid and, once the row
 * outgrows the card, clips the create button off its right edge.
 *
 * The record actions go in the card header's action slot, as
 * `HeaderProps={{ action: <CrmListActions>…</CrmListActions> }}`; the filters
 * go in `<CrmListToolbar>` directly above the grid. Both wrap rather than
 * overflow, so the card holds at any width.
 */

/** The card's record actions, top right, wrapping under the title when narrow. */
export function CrmListActions({ children }: { children: ReactNode }) {
  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: 1,
        // A button wraps as a whole, never its label across two lines.
        '& .MuiButton-root': { whiteSpace: 'nowrap' },
      }}
    >
      {children}
    </Stack>
  )
}

/** The list's filters, above the grid, left-aligned and wrapping. */
export function CrmListToolbar({
  label,
  children,
}: {
  /** What the toolbar filters, for assistive technology ("Lead filters"). */
  label: string
  children: ReactNode
}) {
  return (
    <Stack
      direction="row"
      role="toolbar"
      aria-label={label}
      useFlexGap
      sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
    >
      {children}
    </Stack>
  )
}
