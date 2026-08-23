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

/** The four regions of the box, outermost first, each with the plain
 * sentence that says what it is (AGL-2486). */
export const LEGEND_ITEMS = [
  { item: 'margin', label: 'Margin', hint: 'Space OUTSIDE the element, pushing its neighbours away' },
  { item: 'border', label: 'Border', hint: 'The line drawn around the element — set under Borders & Shadows' },
  { item: 'padding', label: 'Padding', hint: 'Space INSIDE the element, between its border and its content' },
  { item: 'contents', label: 'Content', hint: "The element's own text or children" },
] as const

export type LegendKey = (typeof LEGEND_ITEMS)[number]['item']

interface LegendItemProps extends Partial<StackProps> {
  item: LegendKey
}

export const LegendItem = (props: LegendItemProps) => {
  const { item, className, ...rest } = props
  const entry = LEGEND_ITEMS.find((candidate) => candidate.item === item)

  return (
    <Tooltip title={entry?.hint ?? ''}>
      <Stack
        direction="row"
        className={clsx(classKeys.legendItem, classKeys[item], className)}
        spacing={0.5}
        {...rest}
        sx={[
          { alignItems: 'center', justifyContent: 'start' },
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
  const tv = (theme as any).vars || theme
  return {
    [`.${classKeys.legendSwatch}`]: {
      borderStyle: 'solid',
      borderWidth: 1,
      content: '" "',
      width: 10,
      height: 10,
      flexShrink: 0,
    },
    [`.${classKeys.margin}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: 'dashed',
        borderColor: tv.palette.warning.dark,
        backgroundColor: `rgba(${tv.palette.warning.mainChannel} / 0.24)`,
      },
    },
    [`.${classKeys.border}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: 'solid',
        borderColor: tv.palette.info.main,
        backgroundColor: `rgba(${tv.palette.info.mainChannel} / 0.24)`,
      },
    },
    [`.${classKeys.padding}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: 'dashed',
        borderColor: tv.palette.success.dark,
        backgroundColor: `rgba(${tv.palette.success.mainChannel} / 0.24)`,
      },
    },
    [`.${classKeys.contents}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: 'solid',
        borderColor: tv.palette.text.secondary,
        backgroundColor: tv.palette.background.default,
      },
    },
    [`.${classKeys.legendLabel}`]: {
      color: tv.palette.text.secondary,
      fontSize: theme.typography.pxToRem(11),
    },
  }
})

export default Legend
