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

import { FlexboxButtonGroup } from '@aglyn/besigner-ui-form-fields'
import type { Measurement } from '@aglyn/shared-data-enums'
import '@aglyn/shared-data-jsx'
import { alpha, darken } from '@aglyn/shared-ui-theme'
import { ButtonBase, Collapse, lighten, styled } from '@mui/material'
import { emphasize } from '@mui/system/colorManipulator'
import { forwardRef, useCallback, useState } from 'react'
import type { Measurements } from '../types'

export { Measurements }

const GAP = 1
const BTN_SIZE = 20
const HEIGHT = 200

const StyledWrapper = styled('div')(({ theme }) => ({
  width: '100%',
  height: HEIGHT,
  backgroundColor: theme.palette.surface.dark,
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  textAlign: 'center',
  overflow: 'hidden',

  '.marginButton': {
    overflow: 'hidden',
    textAlign: 'center',
    bgcolor: 'secondary.light',
    cursor: 'pointer',
    backfaceVisibility: 'hidden',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: theme.palette.warning.dark,
    backgroundColor: alpha(theme.palette.surface.main, 0.96),
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
      marginBottom: GAP,
      height: `${BTN_SIZE}%`,
      borderBottomWidth: 0,
      clipPath: `polygon(0% 0%, 100% 0%, ${
        100 - BTN_SIZE
      }% 100%, ${BTN_SIZE}% 100%)`,
    },

    '&.marginLeft': {
      top: 0,
      left: 0,
      position: 'absolute',
      borderRightWidth: 0,
      height: '100%',
      width: `calc(${BTN_SIZE}% - ${GAP}px)`,
      marginRight: GAP,
      clipPath: `polygon(0% 0%, 100% ${BTN_SIZE}%, 100% ${
        100 - BTN_SIZE
      }%, 0% 100%)`,
    },

    '&.marginRight': {
      top: 0,
      right: 0,
      borderLeftWidth: 0,
      height: '100%',
      width: `calc(${BTN_SIZE}% - ${GAP}px)`,
      marginLeft: GAP,
      position: 'absolute',
      clipPath: `polygon(0% ${BTN_SIZE}%, 100% 0%, 100% 100%, 0% ${
        100 - BTN_SIZE
      }%)`,
    },

    '&.marginBottom': {
      width: `calc(100% - ${GAP * 2}px)`,
      marginLeft: GAP,
      marginTop: GAP,
      borderTopWidth: 0,
      height: `${BTN_SIZE}%`,
      clipPath: `polygon(${BTN_SIZE}% 0%, ${
        100 - BTN_SIZE
      }% 0%, 100% 100%, 0% 100%)`,
    },
  },

  '.paddingContainer': {
    width: `calc(100% - ${BTN_SIZE * 2}%)`,
    height: `calc(100% - ${BTN_SIZE * 2}%)`,
    display: 'flex',
    flexDirection: 'column',
    margin: '0 auto',
    position: 'relative',
    textAlign: 'center',
    overflow: 'hidden',
  },

  '.paddingButton': {
    overflow: 'hidden',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: theme.palette.success.dark,
    backfaceVisibility: 'hidden',
    backgroundColor: darken(theme.palette.surface.main, 0.12),
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
      marginLeft: GAP,
      marginBottom: GAP,
      height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
      borderBottomWidth: 0,
      clipPath: `polygon(0% 0%, 100% 0%, calc(${BTN_SIZE * 2}% + (${
        100 - BTN_SIZE
      }% * 0.3333334)) 100%, calc(${BTN_SIZE}% + (${
        BTN_SIZE * 2
      }% * 0.3333334)) 100%)`,
    },

    '&.paddingLeft': {
      top: 0,
      left: 0,
      position: 'absolute',
      borderRightWidth: 0,
      height: '100%',
      width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
      clipPath: `polygon(0% 0%, 100% calc(${BTN_SIZE}% + (${
        BTN_SIZE * 2
      }% * 0.3333334)), 100% calc(${BTN_SIZE * 2}% + (${
        100 - BTN_SIZE
      }% * 0.3333334)), 0% 100%)`,
    },

    '&.paddingRight': {
      top: 0,
      right: 0,
      position: 'absolute',
      height: '100%',
      marginLeft: GAP,
      width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
      borderLeftWidth: 0,
      clipPath: `polygon(0% calc(${BTN_SIZE}% + (${
        BTN_SIZE * 2
      }% * 0.3333334)), 100% 0%, 100% 100%, 0% calc(${BTN_SIZE * 2}% + (${
        100 - BTN_SIZE
      }% * 0.3333334)))`,
    },

    '&.paddingBottom': {
      width: `calc(100% - ${GAP * 2}px)`,
      marginLeft: GAP,
      marginTop: GAP,
      height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
      borderTopWidth: 0,
      clipPath: `polygon(calc(${BTN_SIZE}% + (${
        BTN_SIZE * 2
      }% * 0.3333334)) 0%, calc(${BTN_SIZE * 2}% + (${
        100 - BTN_SIZE
      }% * 0.3333334)) 0%, 100% 100%, 0% 100%)`,
    },
  },

  '.contents': {
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: theme.palette.info.dark,
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.surface.light,
    width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
    height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
    margin: '0 auto',
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
      borderRight: `0.5em solid ${alpha(theme.palette.info.dark, 0.36)}`,
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
    borderBottom: `1px solid ${theme.palette.text.secondary}`,
    borderRight: `1px solid ${theme.palette.text.secondary}`,
    color: theme.palette.getContrastText(
      alpha(theme.palette.surface.main, 0.76),
    ),
    backgroundColor: alpha(emphasize(theme.palette.surface.main, 0.36), 0.12),
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
      borderColor: theme.palette.warning.dark,
      backgroundColor: lighten(theme.palette.warning.dark, 0.48),
      color: theme.palette.getContrastText(
        emphasize(theme.palette.warning.dark, 0.48),
      ),

      '& > .arrow:before': {
        borderTopColor: darken(theme.palette.warning.dark, 0.12),
      },
    },

    '&.padding': {
      borderColor: theme.palette.success.dark,
      backgroundColor: lighten(theme.palette.success.dark, 0.48),
      color: theme.palette.getContrastText(
        emphasize(theme.palette.success.dark, 0.48),
      ),

      '& > .arrow:before': {
        borderTopColor: darken(theme.palette.success.dark, 0.12),
      },
    },
  },
}))

export interface BoxButtonStylerProps
  extends Omit<JSX.ComponentProps<typeof StyledWrapper>, 'onChange'> {
  measurements?: Measurements
  size?: { width?: Measurement; height: Measurement }
  onChange?: (measurements?: Measurements) => void
}

export const BoxButtonStyler = forwardRef<any, BoxButtonStylerProps>(
  (props, ref) => {
    const { measurements, size, onChange, ...rest } = props
    const { width, height } = { ...size }
    const [editing, setEditing] = useState(null)

    const handleChange = useCallback(
      (key: keyof Measurements) => (dimension: Measurement) => {
        const res = { ...measurements, [key]: dimension }
        onChange && onChange(res)
      },
      [onChange, measurements],
    )

    return (
      <>
        <StyledWrapper ref={ref} {...rest}>
          <ButtonBase className="marginButton marginTop">mt</ButtonBase>
          <ButtonBase className="marginButton marginLeft">ml</ButtonBase>

          <div className="paddingContainer">
            <ButtonBase className="paddingButton paddingTop">pt</ButtonBase>
            <ButtonBase className="paddingButton paddingLeft">pl</ButtonBase>

            <div className="contents">
              <div>Contents</div>
            </div>

            <ButtonBase className="paddingButton paddingRight">pr</ButtonBase>
            <ButtonBase className="paddingButton paddingBottom">pb</ButtonBase>

            <div className="label padding">
              <div className="arrow"></div>
              {'Padding'}
            </div>
          </div>
          <ButtonBase className="marginButton marginRight">mr</ButtonBase>
          <ButtonBase className="marginButton marginBottom">mb</ButtonBase>

          <div className="label margin">
            <div className="arrow"></div>
            {'Margin'}
          </div>
        </StyledWrapper>
        <Collapse in={editing}></Collapse>
      </>
    )
  },
)
BoxButtonStyler.displayName = 'BoxButtonStyler'

export default BoxButtonStyler
