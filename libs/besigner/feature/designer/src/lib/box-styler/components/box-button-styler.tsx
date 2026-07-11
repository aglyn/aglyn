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

import type { Measurement } from '@aglyn/shared-data-enums'
import { alpha, darken } from '@aglyn/shared-ui-theme'
import {
  ButtonBase,
  Collapse,
  lighten,
  Stack,
  styled,
  Typography,
} from '@mui/material'
import { emphasize } from '@mui/system/colorManipulator'
import { type ComponentProps, forwardRef, useCallback, useState } from 'react'
import type { Measurements } from '../types'
import DimensionControl from './dimension-control'

export type { Measurements }

const GAP = 2
const BTN_SIZE = 20
const HORZ_BTN = {
  H: 48,
  W: 100,
}
const HEIGHT = 200

export type PolyType = {
  topLX: string
  topLY: string
  topRX: string
  topRY: string
  btmRX: string
  btmRY: string
  btmLX: string
  btmLY: string
}

const polygon = (options: PolyType) => {
  const topL = `${options.topLX || '0%'} ${options.topLY || '0%'}`
  const topR = `${options.topRX || '0%'} ${options.topRY || '0%'}`
  const btmR = `${options.btmRX || '0%'} ${options.btmRY || '0%'}`
  const btmL = `${options.btmLX || '0%'} ${options.btmLY || '0%'}`
  return `polygon(${topL}, ${topR}, ${btmR}, ${btmL})`
}

const StyledWrapper = styled('div')(({ theme }) => {
  // In CSS vars mode theme.palette.* always returns static light values;
  // use (theme.vars || theme) so palette refs become live CSS custom-property
  // references that switch when the .dark class toggles on <html>.
  const tv = (theme as any).vars || theme
  return {
  width: '100%',
  height: HEIGHT,
  backgroundColor: theme.palette.common.black,
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  textAlign: 'center',
  overflow: 'hidden',
  borderStyle: 'dashed',
  borderWidth: 1,
  borderColor: tv.palette.warning.dark,
  padding: 1,

  '.marginButton': {
    overflow: 'hidden',
    textAlign: 'center',
    bgcolor: 'secondary.light',
    cursor: 'pointer',
    backfaceVisibility: 'hidden',
    backgroundColor: `rgba(${tv.palette.surface.mainChannel} / 0.96)`,
    color: theme.palette.getContrastText(
      alpha(theme.palette.surface.main, 0.96),
    ),
    background: [
      'linear-gradient(',
      '260deg, ',
      `${darken(theme.palette.surface.light, 0.08)}, `,
      `${lighten(theme.palette.surface.light, 0.12)}`,
      ') content-box',
    ].join(''),

    '&.marginTop': {
      width: `calc(100% - ${GAP * 2}px)`,
      marginLeft: GAP,
      marginRight: GAP,
      height: `calc(${BTN_SIZE}% - ${GAP}px)`,
      borderBottomWidth: 0,
      clipPath: polygon({
        topLX: '0%',
        topLY: '0%',
        topRX: '100%',
        topRY: '0%',
        btmRX: `${100 - BTN_SIZE}%`,
        btmRY: '100%',
        btmLX: `${BTN_SIZE}%`,
        btmLY: '100%',
      }),
    },

    '&.marginBottom': {
      width: `calc(100% - ${GAP}px)`,
      marginLeft: GAP,
      borderTopWidth: 0,
      height: `${BTN_SIZE}%`,
      clipPath: polygon({
        topLX: `${BTN_SIZE}%`,
        topLY: `0%`,
        topRX: `${100 - BTN_SIZE}%`,
        topRY: '0%',
        btmRX: `100%`,
        btmRY: '100%',
        btmLX: `0%`,
        btmLY: `100%`,
      }),
    },

    '&.marginLeft': {
      left: 1,
      top: 0,
      position: 'absolute',
      borderRightWidth: 0,
      height: `calc(100% - ${GAP}px)`,
      width: `${BTN_SIZE}%`,
      clipPath: polygon({
        topLX: `0%`,
        topLY: `0%`,
        topRX: `100%`,
        topRY: `${BTN_SIZE}%`,
        btmRX: `100%`,
        btmRY: `${100 - BTN_SIZE}%`,
        btmLX: `0%`,
        btmLY: `100%`,
      }),
    },

    '&.marginRight': {
      right: 1,
      borderLeftWidth: 0,
      height: `calc(100% - ${GAP * 2}px)`,
      width: `${BTN_SIZE}%`,
      position: 'absolute',
      clipPath: polygon({
        topLX: '0%',
        topLY: `${BTN_SIZE}%`,
        topRX: '100%',
        topRY: '0%',
        btmRX: `100%`,
        btmRY: '100%',
        btmLX: `0%`,
        btmLY: `${100 - BTN_SIZE}%`,
      }),
    },
  },

  '.paddingContainer': {
    width: `calc(${BTN_SIZE * 3}% - ${GAP * 2}px)`,
    height: `${BTN_SIZE * 3}%`,
    display: 'flex',
    padding: 1,
    flexDirection: 'column',
    margin: `${GAP}px auto`,
    position: 'relative',
    textAlign: 'center',
    overflow: 'hidden',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: tv.palette.success.dark,
    boxSizing: 'border-box',
  },

  '.paddingButton': {
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    backgroundColor: `rgba(${tv.palette.surface.darkChannel} / 0.96)`,
    background: [
      'linear-gradient(',
      '65deg, ',
      `${lighten(theme.palette.tertiary.main, 0.76)}, `,
      `${lighten(theme.palette.secondary.main, 0.76)}`,
      ') content-box',
    ].join(''),
    color: theme.palette.getContrastText(
      lighten(theme.palette.tertiary.main, 0.76),
    ),

    '&.paddingTop': {
      width: `calc(100% - ${GAP * 2}px)`,
      height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
      marginLeft: GAP,
      // marginRight: GAP,
      clipPath: polygon({
        topLX: `0%`,
        topLY: `0%`,
        topRX: `100%`,
        topRY: `0%`,
        btmRX: `calc(${BTN_SIZE * 2}% + (${
          100 - BTN_SIZE
        }% * 0.3333334) - ${GAP}px)`,
        btmRY: `100%`,
        btmLX: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) + ${GAP}px)`,
        btmLY: `100%`,
      }),
    },

    '&.paddingLeft': {
      position: 'absolute',
      top: 0,
      left: 1,
      height: `calc(100% - ${GAP * 2}px)`,
      width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
      marginTop: GAP,
      marginBottom: GAP,
      clipPath: polygon({
        topLX: `0%`,
        topLY: `0%`,
        topRX: `100%`,
        topRY: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) + ${GAP}px)`,
        btmRX: `100%`,
        btmRY: `calc(${BTN_SIZE * 2}% + (${
          100 - BTN_SIZE
        }% * 0.3333334) - ${GAP}px)`,
        btmLX: `0%`,
        btmLY: `100%`,
      }),
    },

    '&.paddingRight': {
      position: 'absolute',
      top: 0,
      right: 1,
      height: `calc(100% - ${GAP * 2}px)`,
      width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
      marginTop: GAP,
      marginBottom: GAP,
      clipPath: polygon({
        topLX: `0%`,
        topLY: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) + ${GAP}px)`,
        topRX: `100%`,
        topRY: `0%`,
        btmRX: `100%`,
        btmRY: `100%`,
        btmLX: `0%`,
        btmLY: `calc(${BTN_SIZE * 2}% + (${
          100 - BTN_SIZE
        }% * 0.3333334) - ${GAP}px)`,
      }),
    },

    '&.paddingBottom': {
      width: `calc(100% - ${GAP * 2}px)`,
      height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
      marginLeft: GAP,
      marginRight: GAP,
      clipPath: polygon({
        topLX: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) + ${GAP}px)`,
        topLY: `0%`,
        topRX: `calc(${BTN_SIZE * 2}% + (${
          100 - BTN_SIZE
        }% * 0.3333334) - ${GAP}px)`,
        topRY: `0%`,
        btmRX: `100%`,
        btmRY: `100%`,
        btmLX: `0%`,
        btmLY: `100%`,
      }),
    },
  },

  '.contents': {
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: tv.palette.info.dark,
    color: tv.palette.text.primary,
    backgroundColor: tv.palette.surface.light,
    width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) - ${GAP * 2}px)`,
    height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) - ${
      GAP * 2
    }px)`,
    margin: `${GAP}px auto`,
    position: 'relative',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,

    ':before': {
      content: '""',
      position: 'absolute',
      left: '-0.09em',
      top: '-0.29em',
      width: '0',
      height: '0.5em',
      background: 'transparent',
      borderRight: `0.5em solid rgba(${tv.palette.info.darkChannel} / 0.36)`,
      borderBottom: '0.5em solid transparent',
      borderTop: '0.5em solid transparent',
      transform: 'rotate(45deg)',
    },
  },

  '.label': {
    width: 'auto',
    position: 'absolute',
    textAlign: 'left',
    pointerEvents: 'none',
    left: 1,
    top: 1,
    paddingLeft: theme.spacing(0.5),
    paddingRight: theme.spacing(0.5),
    paddingTop: theme.spacing(0.25),
    paddingBottom: theme.spacing(0.25),
    borderBottom: `1px solid ${tv.palette.text.secondary}`,
    borderRight: `1px solid ${tv.palette.text.secondary}`,
    color: theme.palette.getContrastText(
      alpha(theme.palette.surface.main, 0.76),
    ),
    backgroundColor: `rgba(${tv.palette.surface.darkChannel} / 0.12)`,
    fontSize: theme.typography.pxToRem(12),

    '& > .arrow:before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      borderTop: `0.5em solid ${emphasize(theme.palette.surface.main, 0.36)}`,
      borderRight: '0.5em solid transparent',
      overflow: 'hidden',
    },

    '&.margin': {
      borderColor: tv.palette.warning.dark,
      backgroundColor: lighten(theme.palette.warning.dark, 0.48),
      color: theme.palette.getContrastText(
        emphasize(theme.palette.warning.dark, 0.48),
      ),

      '& > .arrow:before': {
        borderTopColor: darken(theme.palette.warning.dark, 0.12),
      },
    },

    '&.padding': {
      borderColor: tv.palette.success.dark,
      backgroundColor: lighten(theme.palette.success.dark, 0.48),
      color: theme.palette.getContrastText(
        emphasize(theme.palette.success.dark, 0.48),
      ),

      '& > .arrow:before': {
        borderTopColor: darken(theme.palette.success.dark, 0.12),
      },
    },
  },
}})

/** Human labels for the collapse editor's title (AGL-334). */
const SIDE_LABELS: Record<keyof Measurements, string> = {
  marginTop: 'Margin top',
  marginRight: 'Margin right',
  marginBottom: 'Margin bottom',
  marginLeft: 'Margin left',
  paddingTop: 'Padding top',
  paddingRight: 'Padding right',
  paddingBottom: 'Padding bottom',
  paddingLeft: 'Padding left',
}

export interface BoxButtonStylerProps
  extends Omit<ComponentProps<typeof StyledWrapper>, 'onChange'> {
  measurements?: Measurements
  size?: { width?: Measurement; height: Measurement }
  /** Scope label rendered in the editor ('each' | 'axis' | 'all'). */
  scope?: string
  onChange?: (
    key: keyof Measurements,
  ) => (dimension: Measurement) => void
}

export const BoxButtonStyler = forwardRef<any, BoxButtonStylerProps>(
  (props, ref) => {
    const { measurements, size, scope, onChange, ...rest } = props
    const { width, height } = { ...size }
    const [editing, setEditing] = useState<keyof Measurements | null>(null)

    const handleSelect = useCallback(
      (key: keyof Measurements) => () =>
        setEditing((prev) => (prev === key ? null : key)),
      [],
    )

    const sideButton = (key: keyof Measurements, abbr: string) => (
      <ButtonBase
        className={`${key.startsWith('margin') ? 'marginButton' : 'paddingButton'} ${key}`}
        onClick={handleSelect(key)}
        aria-label={SIDE_LABELS[key]}
        sx={editing === key ? { outline: '2px solid', outlineOffset: -2 } : undefined}
      >
        {measurements?.[key] ?? abbr}
      </ButtonBase>
    )

    return (
      <>
        <StyledWrapper ref={ref} {...rest}>
          {sideButton('marginTop', 'mt')}
          {sideButton('marginLeft', 'ml')}

          <div className="paddingContainer">
            {sideButton('paddingTop', 'pt')}
            {sideButton('paddingLeft', 'pl')}

            <div className="contents">
              <div>Contents</div>
            </div>

            {sideButton('paddingRight', 'pr')}
            {sideButton('paddingBottom', 'pb')}

            <div className="label padding">
              <div className="arrow"></div>
              {'Padding'}
            </div>
          </div>
          {sideButton('marginRight', 'mr')}
          {sideButton('marginBottom', 'mb')}

          <div className="label margin">
            <div className="arrow"></div>
            {'Margin'}
          </div>
        </StyledWrapper>

        <Collapse in={Boolean(editing)}>
          {editing ? (
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', mt: 1 }}
            >
              <Typography variant="caption" sx={{ flex: 1 }}>
                {SIDE_LABELS[editing]}
                {scope && scope !== 'each' ? ` (${scope})` : ''}
              </Typography>
              <DimensionControl
                dimension={(measurements?.[editing] as string) ?? ''}
                onChange={onChange?.(editing)}
              />
            </Stack>
          ) : null}
        </Collapse>
      </>
    )
  },
)
BoxButtonStyler.displayName = 'BoxButtonStyler'

export default BoxButtonStyler
