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
import { classKeys } from '../constants'

export const Box = styled('div')(({ theme }) => {
  return {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 1,
    fontSize: '0.72rem',
    color: theme.palette.surface.contrastText,

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
      borderColor: theme.palette.info.dark,
      color: theme.palette.getContrastText(
        alpha(darken(theme.palette.surface.main, 0.26), 0.12),
      ),
      backgroundColor: alpha(darken(theme.palette.surface.main, 0.26), 0.12),

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
    [`&.${classKeys.margin}`]: {
      position: 'relative',
      height: 184,
      minWidth: 258,
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: theme.palette.warning.dark,
      backgroundColor: alpha(theme.palette.surface.main, 0.96),
      color: theme.palette.getContrastText(
        alpha(theme.palette.surface.main, 0.96),
      ),

      [`> .${classKeys.label}`]: {
        borderColor: theme.palette.warning.dark,
        backgroundColor: alpha(
          emphasize(theme.palette.warning.dark, 0.36),
          0.12,
        ),

        ':before': {
          borderRightColor: alpha(theme.palette.warning.dark, 0.36),
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
      borderColor: theme.palette.success.dark,
      backgroundColor: alpha(darken(theme.palette.surface.main, 0.12), 0.96),
      color: theme.palette.getContrastText(
        alpha(darken(theme.palette.surface.main, 0.12), 0.96),
      ),
      background: [
        'linear-gradient(',
        '65deg, ',
        `${alpha(theme.palette.tertiary.main, 0.12)}, `,
        `${alpha(theme.palette.secondary.main, 0.12)}`,
        ') content-box',
      ].join(''),

      [`> .${classKeys.label}`]: {
        borderColor: theme.palette.success.dark,
        backgroundColor: alpha(
          emphasize(theme.palette.success.dark, 0.36),
          0.12,
        ),

        ':before': {
          borderRightColor: alpha(theme.palette.success.dark, 0.36),
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
      borderBottom: `1px solid ${theme.palette.text.secondary}`,
      borderRight: `1px solid ${theme.palette.text.secondary}`,
      color: theme.palette.getContrastText(
        alpha(theme.palette.surface.main, 0.76),
      ),
      backgroundColor: alpha(emphasize(theme.palette.surface.main, 0.36), 0.12),

      ':before': {
        content: '""',
        position: 'absolute',
        left: '-0.09em',
        top: '-0.29em',
        width: '0',
        height: '0.5em',
        background: 'transparent',
        borderRight: `0.5em solid ${alpha(theme.palette.surface.main, 0.36)}`,
        borderBottom: '0.5em solid transparent',
        borderTop: '0.5em solid transparent',
        transform: 'rotate(45deg)',
      },
    },
  }
})

export type BoxProps = JSX.ComponentProps<typeof Box>

export default Box
