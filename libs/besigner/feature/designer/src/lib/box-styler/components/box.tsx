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

import { alpha, darken, styled } from '@aglyn/shared-ui-theme'
import { emphasize } from '@mui/system/colorManipulator'
import type { ComponentProps } from 'react'
import { classKeys } from '../constants'

export const Box = styled('div')(({ theme }) => {
  // In CSS vars mode theme.palette.* always returns the static light values;
  // use (theme.vars || theme) so all palette refs become live CSS custom-property
  // references that switch when the .dark class toggles on <html>.
  const tv = (theme as any).vars || theme
  return {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 1,
    fontSize: '0.72rem',
    color: tv.palette.surface.contrastText,

    [`&.${classKeys.margin}, &.${classKeys.padding}`]: {
      flexShrink: 0.36,
    },
    [`&:not(.${classKeys.row})`]: {
      justifyContent: 'space-around',
    },
    [`&.${classKeys.row}`]: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    [`> *`]: {
      width: '100%',
      textAlign: 'center',
    },
    [`&.${classKeys.contents}`]: {
      // flexShrink: 0.52,
      position: 'relative',
      minHeight: 24,
      minWidth: 78,
      maxWidth: 168,
      borderStyle: 'solid',
      borderWidth: 1,
      borderColor: tv.palette.info.dark,
      color: theme.palette.getContrastText(
        alpha(darken(theme.palette.surface.main, 0.26), 0.12),
      ),
      backgroundColor: `rgba(${tv.palette.surface.darkChannel} / 0.12)`,

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
    [`&.${classKeys.margin}`]: {
      position: 'relative',
      height: 184,
      minWidth: 258,
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: tv.palette.warning.dark,
      backgroundColor: `rgba(${tv.palette.surface.mainChannel} / 0.96)`,
      color: theme.palette.getContrastText(
        alpha(theme.palette.surface.main, 0.96),
      ),

      [`> .${classKeys.label}`]: {
        borderColor: tv.palette.warning.dark,
        backgroundColor: `rgba(${tv.palette.warning.darkChannel} / 0.12)`,

        ':before': {
          borderRightColor: `rgba(${tv.palette.warning.darkChannel} / 0.36)`,
        },
      },
    },
    [`&.${classKeys.padding}`]: {
      position: 'relative',
      height: 104,
      minWidth: 168,
      padding: 2,
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: tv.palette.success.dark,
      backgroundColor: `rgba(${tv.palette.surface.darkChannel} / 0.96)`,
      color: theme.palette.getContrastText(
        alpha(darken(theme.palette.surface.main, 0.12), 0.96),
      ),
      background: [
        'linear-gradient(',
        '65deg, ',
        `rgba(${tv.palette.tertiary.mainChannel} / 0.12), `,
        `rgba(${tv.palette.secondary.mainChannel} / 0.12)`,
        ') content-box',
      ].join(''),

      [`> .${classKeys.label}`]: {
        borderColor: tv.palette.success.dark,
        backgroundColor: `rgba(${tv.palette.success.darkChannel} / 0.12)`,

        ':before': {
          borderRightColor: `rgba(${tv.palette.success.darkChannel} / 0.36)`,
        },
      },
    },
    [`.${classKeys.label}`]: {
      width: 'auto',
      position: 'absolute',
      textAlign: 'left',
      left: 0,
      top: 0,
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

      ':before': {
        content: '""',
        position: 'absolute',
        left: '-0.09em',
        top: '-0.29em',
        width: '0',
        height: '0.5em',
        background: 'transparent',
        borderRight: `0.5em solid rgba(${tv.palette.surface.mainChannel} / 0.36)`,
        borderBottom: '0.5em solid transparent',
        borderTop: '0.5em solid transparent',
        transform: 'rotate(45deg)',
      },
    },
  }
})

export type BoxProps = ComponentProps<typeof Box>

export default Box
