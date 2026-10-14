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

import {
  Button,
  Chip,
  Collapse,
  Link,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material'
import { lazy, Suspense, useState } from 'react'

// The picker frame is its own chunk: an Actions editor that never picks an
// element never downloads it.
const ElementPickerDialog = lazy(() => import('./element-picker-dialog.component'))

/** The stored form of a picked element: the renderer's leaf stamp. */
const LEAF_SELECTOR = /^\[data-aglyn="leaf:[^"]+"\]$/

export interface ElementSelectorFieldProps {
  /** What the field targets, as the step or trigger names it. */
  label: string
  /** The stored selector. */
  value: string
  onChange: (value: string) => void
  /**
   * The site whose pages the picker opens. Without one (an editor that is
   * not about one site) the field is the custom selector alone.
   */
  hostId?: string
  /** The page the picker opens first, e.g. the trigger's "Only on pages". */
  initialPath?: string
  /** What an empty field does, e.g. "Header or nav". */
  emptyLabel?: string
  placeholder?: string
}

/**
 * An element target picked on the live page (AGL-3758). "Pick element"
 * opens the site's page in a frame and the builder clicks the element; the
 * stored selector is the one the Besigner's Interactions picker stores. A
 * typed CSS selector is still there, behind "Use a custom selector".
 */
export function ElementSelectorField(props: ElementSelectorFieldProps) {
  const { label, value, onChange, hostId, initialPath, emptyLabel, placeholder } =
    props
  const [picking, setPicking] = useState(false)
  const [pickedLabel, setPickedLabel] = useState<string | null>(null)
  const custom = Boolean(value) && !LEAF_SELECTOR.test(value)
  const [advanced, setAdvanced] = useState(custom)

  const customField = (
    <TextField
      label={hostId ? 'Custom selector' : label}
      value={value}
      onChange={(event) => {
        setPickedLabel(null)
        onChange(event.target.value)
      }}
      size="small"
      fullWidth
      placeholder={placeholder}
      helperText={hostId ? 'Any CSS selector; it replaces the picked element' : undefined}
    />
  )
  if (!hostId) return <Stack sx={{ flex: 1 }}>{customField}</Stack>

  const chip = !value
    ? (emptyLabel ?? 'No element yet')
    : custom
      ? value
      : (pickedLabel ?? 'Picked element')
  return (
    <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
      <Stack
        useFlexGap
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Button size="small" variant="outlined" onClick={() => setPicking(true)}>
          {value ? `Change ${label.toLowerCase()}` : `Pick ${label.toLowerCase()}`}
        </Button>
        <Tooltip title={value || ''}>
          <Chip
            size="small"
            label={chip}
            variant={value ? 'filled' : 'outlined'}
            color={value ? 'primary' : 'default'}
            onDelete={value ? () => onChange('') : undefined}
            sx={{ maxWidth: 260 }}
          />
        </Tooltip>
      </Stack>
      <Link
        component="button"
        type="button"
        variant="caption"
        underline="hover"
        onClick={() => setAdvanced((open) => !open)}
        sx={{ alignSelf: 'flex-start' }}
      >
        {advanced ? 'Hide custom selector' : 'Use a custom selector'}
      </Link>
      <Collapse in={advanced} unmountOnExit>
        {customField}
      </Collapse>
      {picking ? (
        <Suspense fallback={null}>
          <ElementPickerDialog
            hostId={hostId}
            initialPath={initialPath}
            onClose={() => setPicking(false)}
            onPicked={(selector, picked) => {
              setPickedLabel(picked)
              setAdvanced(false)
              onChange(selector)
              setPicking(false)
            }}
          />
        </Suspense>
      ) : null}
    </Stack>
  )
}

export default ElementSelectorField
