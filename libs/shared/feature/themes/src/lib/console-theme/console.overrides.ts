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

import {type ThemeOptions} from '../../vendor/mui'


export const consoleOverrides: ThemeOptions['components'] = {
  MuiAvatar: {
    styleOverrides: {
      root: {
        width: 32,
        height: 32,
      },
    },
  },
  MuiIconButton: {
    defaultProps: {
      color: 'secondary',
    },
    // color: 'inherit', // Default color to inherit
    styleOverrides: {
      root: ({theme}) => ({
        padding: theme.spacing(1),
      }),
    },
  },
  MuiLink: {
    defaultProps: {
      color: 'secondary',
    },
    styleOverrides: {
      root: {
        '&[disabled], &.disabled': {
          pointerEvents: 'default',
          textDecoration: 'none',
          filter: 'grayscale(1) opacity(0.65)',
        },
      },
    },
  },
  MuiButton: {
    defaultProps: {
      color: 'secondary',
    },
    styleOverrides: {
      root: {
        '&a[disabled], &.disabled': {
          pointerEvents: 'default',
          textDecoration: 'none',
          filter: 'grayscale(1) opacity(0.65)',
        },
      },
    },
  },
  MuiTooltip: {
    defaultProps: {
      arrow: true,
    },
  },
  MuiToolbar: {
    styleOverrides: {
      root: ({theme}) => ({
        [theme.breakpoints.up('sm')]: {
          paddingLeft: theme.spacing(2),
          paddingRight: theme.spacing(2),
        },
      }),
    },
  },
}
export default consoleOverrides
