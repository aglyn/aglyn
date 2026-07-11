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
  buildCssMeasurement,
  type Measurement,
} from '@aglyn/shared-data-enums'
import {
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { forwardRef, useCallback, useState } from 'react'
import Box, { type BoxProps } from './components/box'
import BoxButtonStyler from './components/box-button-styler'
import Contents from './components/contents'
import Legend, { LegendItem } from './components/legend'
import MarginStyler from './components/margin-styler'
import PaddingStyler from './components/padding-styler'
import type { Measurements } from './types'

export type { Measurements }

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

export interface BoxStylerProps extends Omit<BoxProps, 'onChange'> {
  measurements?: Measurements
  width?: Measurement
  height?: Measurement
  onChange?: (measurements?: Measurements) => void
}

export const BoxStyler = forwardRef<any, BoxStylerProps>((
  { measurements, width, height, onChange, ...rest }: BoxStylerProps,
  ref,
) => {
  const [scope, setScope] = useState<BoxScope>('each')

  const handleChange = useCallback(
    (key: keyof Measurements) => (dimension: Measurement) => {
      // Persist CSS strings, never {value, unit} objects — sx consumers
      // (MUI, the tenant runtime) only understand CSS values (AGL-334).
      const css = buildCssMeasurement(dimension)
      const res: Measurements = { ...measurements }
      for (const target of boxScopeKeys(key, scope)) {
        res[target] = css as any
      }
      onChange?.(res)
    },
    [onChange, measurements, scope],
  )

  return (
    <>
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

      <BoxButtonStyler
        measurements={measurements}
        scope={scope}
        onChange={handleChange}
      />

      <Box ref={ref} {...rest}>
        <MarginStyler
          onChange={handleChange}
          marginTop={measurements?.marginTop}
          marginRight={measurements?.marginRight}
          marginBottom={measurements?.marginBottom}
          marginLeft={measurements?.marginLeft}
        >
          <PaddingStyler
            onChange={handleChange}
            paddingTop={measurements?.paddingTop}
            paddingRight={measurements?.paddingRight}
            paddingBottom={measurements?.paddingBottom}
            paddingLeft={measurements?.paddingLeft}
          >
            <Contents />
          </PaddingStyler>
        </MarginStyler>

        <Legend
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'space-around', mt: 1, mb: 2 }}
        >
          <LegendItem item={'margin'} />
          <LegendItem item={'padding'} />
          <LegendItem item={'contents'} />
        </Legend>
      </Box>
    </>
  )
})
BoxStyler.displayName = 'BoxStyler'

export default BoxStyler
