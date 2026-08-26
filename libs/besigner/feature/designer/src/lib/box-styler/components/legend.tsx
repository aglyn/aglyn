/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { styled } from '@aglyn/shared-ui-theme'
import { Stack, type StackProps, Tooltip } from '@mui/material'
import clsx from 'clsx'
import { classKeys } from '../constants'
import { regionFills } from '../region-fills'

/**
 * The key under the diagram (AGL-2486).
 *
 * you also can't really understand the key below it. It was four
 * small outlined squares whose colours only loosely echoed the regions —
 * something to decode rather than something to read.
 *
 * The fix is to stop describing the regions and start SHOWING them: each
 * swatch is painted with the same `regionFills` declaration as the region
 * it names, texture and all, so the mapping is by appearance rather than
 * by memory. It is also why the swatch grew — a 10px square cannot show a
 * cross-hatch, and a texture you cannot see is not a mapping.
 *
 * Each entry keeps a plain sentence on hover, since "margin" and "padding"
 * are the two words in this panel a non-developer is least likely to know.
 */
export const LEGEND_ITEMS = [
  {
    item: 'margin',
    label: 'Margin',
    hint: 'Space OUTSIDE the element, pushing its neighbors away',
  },
  {
    item: 'border',
    label: 'Border',
    hint: 'The line drawn around the element — set under Borders & Shadows',
  },
  {
    item: 'padding',
    label: 'Padding',
    hint: 'Space INSIDE the element, between its border and its content',
  },
  {
    item: 'contents',
    label: 'Contents',
    hint: "The element's own text or children",
  },
] as const

export type LegendKey = (typeof LEGEND_ITEMS)[number]['item']

interface LegendItemProps extends Partial<StackProps> {
  item: LegendKey
}

export const LegendItem = (props: LegendItemProps) => {
  const { item, className, ...rest } = props
  const entry = LEGEND_ITEMS.find((candidate) => candidate.item === item)

  return (
    <Tooltip title={entry?.hint ?? ''} placement="top">
      <Stack
        direction="row"
        className={clsx(classKeys.legendItem, classKeys[item], className)}
        spacing={0.75}
        {...rest}
        sx={[
          { alignItems: 'center', justifyContent: 'start', cursor: 'help' },
          ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx]),
        ]}
      >
        <div className={classKeys.legendSwatch} />
        <div className={classKeys.legendLabel}>{entry?.label ?? item}</div>
      </Stack>
    </Tooltip>
  )
}

export const Legend = styled(Stack)(({ theme }) => {
  // (theme.vars || theme) so the swatches re-resolve with the colour
  // scheme exactly as the diagram's regions do — they are the same
  // declarations, and they have to flip together.
  const tv = (theme as any).vars || theme
  const fills = regionFills(tv as any)

  /** A swatch IS its region, at 14px. */
  const swatch = (key: keyof typeof fills) => ({
    [`.${classKeys[key === 'contents' ? 'contents' : key]}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: fills[key].borderStyle,
        borderColor: fills[key].borderColor,
        background: fills[key].background,
      },
    },
  })

  return {
    [`.${classKeys.legendSwatch}`]: {
      borderWidth: 1,
      borderRadius: 2,
      content: '" "',
      width: 14,
      height: 14,
      flexShrink: 0,
    },
    ...swatch('margin'),
    ...swatch('border'),
    ...swatch('padding'),
    ...swatch('contents'),
    [`.${classKeys.legendLabel}`]: {
      color: tv.palette.text.secondary,
      fontSize: theme.typography.pxToRem(11),
    },
  }
})

export default Legend
