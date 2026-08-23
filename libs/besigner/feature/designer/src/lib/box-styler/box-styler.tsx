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

import {
  Box,
  Collapse,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'

import type { SpacingScaleOption } from '../utils/theme-scale-options'
import BoxDiagram, { SIDE_LABELS } from './components/box-diagram'
import Legend, { LegendItem } from './components/legend'
import SpacingEditor from './components/spacing-editor'
import type { BoxSpacingValue } from './spacing-value'
import type { Measurements } from './types'

export type { Measurements }

/**
 * The box/spacing styler — ONE implementation (AGL-2486, item 5).
 *
 * There were two, stacked one above the other in the same panel: this
 * trapezoid diagram, and a second nested-box diagram with eight always-on
 * number fields below it. Both edited the same eight properties and they
 * did not agree — the second was built on `parseCssMeasurement`, which
 * takes a string, so every element carrying a theme spacing step (a
 * number) showed its padding in the first diagram and "default" in the
 * second. Worse than confusing: touching a field in the second one
 * replaced a theme-tracking step with a flattened `Npx` string.
 *
 * What survives is the diagram that could already read what was stored,
 * now with the border band the box model actually has, one editor that
 * opens under the side you clicked, and the theme's own spacing ladder as
 * the first answer it offers.
 */

/** How an edit fans out across the box sides (AGL-334). */
export type BoxScope = 'each' | 'axis' | 'all'

const MARGIN_KEYS = [
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
] as const
const PADDING_KEYS = [
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const

/** The keys an edit to `key` writes, given the active scope. */
export function boxScopeKeys(
  key: keyof Measurements,
  scope: BoxScope,
): Array<keyof Measurements> {
  const group = key.startsWith('margin') ? MARGIN_KEYS : PADDING_KEYS
  if (scope === 'all') return [...group]
  if (scope === 'axis') {
    const vertical = key.endsWith('Top') || key.endsWith('Bottom')
    return group.filter((item) =>
      vertical
        ? item.endsWith('Top') || item.endsWith('Bottom')
        : item.endsWith('Left') || item.endsWith('Right'),
    )
  }
  return [key]
}

export interface BoxStylerProps {
  measurements?: Measurements
  /** The site theme's spacing ladder (AGL-2486). */
  spacingSteps?: readonly SpacingScaleOption[]
  /** The element's border shorthand, drawn in the diagram for context. */
  border?: string
  onChange?: (measurements?: Measurements) => void
}

export const BoxStyler = forwardRef<any, BoxStylerProps>(
  ({ measurements, spacingSteps, border, onChange }: BoxStylerProps, ref) => {
    const [scope, setScope] = useState<BoxScope>('each')
    const [editing, setEditing] = useState<keyof Measurements | null>(null)

    /**
     * The side the collapsing panel keeps showing on the way OUT
     * (AGL-2486, Zach 2026-08-23).
     *
     * `<Collapse in={...}>{editing ? <Editor/> : null}</Collapse>` opens
     * with an animation and closes with none: the moment `editing` goes
     * null the child is replaced by `null`, so the content is gone before
     * `Collapse` has begun its exit and all one sees is a jump. Holding
     * the last side lets the editor stay mounted for the length of the
     * exit, and `unmountOnExit` on the Collapse — which runs AFTER the
     * transition, not instead of it — does the removal. Closing is then
     * the reverse of opening, which is the whole ask.
     */
    const lastEditing = useRef<keyof Measurements | null>(null)
    useEffect(() => {
      if (editing) lastEditing.current = editing
    }, [editing])
    const shown = editing ?? lastEditing.current

    const handleSelect = useCallback(
      (key: keyof Measurements) =>
        setEditing((prev) => (prev === key ? null : key)),
      [],
    )

    const handleChange = useCallback(
      (key: keyof Measurements) => (value: BoxSpacingValue) => {
        const res: Measurements = { ...measurements }
        for (const target of boxScopeKeys(key, scope)) {
          // The value is stored AS GIVEN: a number stays a number so MUI
          // resolves it through `theme.spacing`, a string stays the CSS
          // length it already is, and `undefined` clears the property.
          // The old handler ran everything through `buildCssMeasurement`
          // first, which is why a step could never be written from here.
          res[target] = value
        }
        onChange?.(res)
      },
      [onChange, measurements, scope],
    )

    return (
      <Box ref={ref}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 1,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {'Apply to'}
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={scope}
            onChange={(event, value) => value && setScope(value)}
          >
            <ToggleButton value="each" sx={{ px: 1, py: 0.25 }}>
              <Tooltip title="Each side individually">
                <span>{'Side'}</span>
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="axis" sx={{ px: 1, py: 0.25 }}>
              <Tooltip title="Vertical or horizontal pair together">
                <span>{'Axis'}</span>
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="all" sx={{ px: 1, py: 0.25 }}>
              <Tooltip title="All four sides together">
                <span>{'All'}</span>
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <BoxDiagram
          measurements={measurements}
          steps={spacingSteps}
          border={border}
          editing={editing ?? undefined}
          onSelect={handleSelect}
        />

        <Collapse in={Boolean(editing)} unmountOnExit>
          {shown ? (
            <Stack sx={{ mt: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {SIDE_LABELS[shown]}
                {scope && scope !== 'each' ? ` (${scope})` : ''}
              </Typography>
              <SpacingEditor
                // Keyed by side so moving between sides remounts the
                // editor rather than carrying the previous one's custom
                // latch across.
                key={shown}
                value={measurements?.[shown]}
                steps={spacingSteps}
                label={SIDE_LABELS[shown]}
                onChange={handleChange(shown)}
              />
            </Stack>
          ) : null}
        </Collapse>

        {/* The legend stays. Removing it was part of a redraw Zach did not
            ask for — he liked this control as it was, and the key belongs
            to the treatment he liked. It gains the border swatch, because
            the diagram now has a border region for the BORDER label to
            sit on. */}
        <Legend
          direction="row"
          spacing={1}
          sx={{
            alignItems: 'center',
            justifyContent: 'space-around',
            mt: 1,
            mb: 2,
          }}
        >
          <LegendItem item={'margin'} />
          <LegendItem item={'border'} />
          <LegendItem item={'padding'} />
          <LegendItem item={'contents'} />
        </Legend>
      </Box>
    )
  },
)
BoxStyler.displayName = 'BoxStyler'

export default BoxStyler
