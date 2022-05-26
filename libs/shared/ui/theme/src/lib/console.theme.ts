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

import type {PaletteOptions, Theme, ThemeOptions} from '../vendor/mui'
import {buildFontFamilyList} from './constants'
import type {IActionStates} from './theme.types'
import createResponsiveTheme from './util/create-responsive-theme'


export type ColorVariant = 'light' | 'dark'
export type BackgroundRecord = PaletteOptions['background']
export type OrdinalIdentifier = 'primary' | 'secondary' | 'tertiary' | 'quaternary'
export type OrdinalRecord<T extends OrdinalIdentifier = OrdinalIdentifier> = Pick<PaletteOptions, T>
export type PrimaryRecord = OrdinalRecord<'primary'>['primary']
export type SecondaryRecord = OrdinalRecord<'secondary'>['secondary']
export type TertiaryRecord = OrdinalRecord<'tertiary'>['tertiary']
export type QuaternaryRecord = OrdinalRecord<'quaternary'>['quaternary']
export type ActionIdentifier = 'svgBackground' | 'svgFilled' | 'svgStroke'
export type ActionRecord = Pick<PaletteOptions, ActionIdentifier>

export const status = {
  info: {
    main: '#E53935',
    light: '#EA605D',
    dark: '#A02725',
    contrastText: '#FFFFFF',
  },
  error: {
    main: '#E53935',
    light: '#EA605D',
    dark: '#A02725',
    contrastText: '#FFFFFF',
  },
  success: {
    main: '#4CAF50',
    light: '#81C784',
    dark: '#388E3C',
    contrastText: '#000000DE',
  },
  warning: {
    main: '#FFAB40',
    light: '#FFBB66',
    dark: '#B2772C',
    contrastText: '#000000DE',
  },
}

export const shadesOfGrey = {
  50: '#FAFAFA',
  100: '#F5F5F5',
  200: '#EEEEEE',
  300: '#E0E0E0',
  400: '#BDBDBD',
  500: '#9E9E9E',
  600: '#757575',
  700: '#616161',
  800: '#424242',
  900: '#212121',
  A100: '#D5D5D5',
  A200: '#AAAAAA',
  A400: '#303030',
  A700: '#616161',
}

export const backgroundsLight: BackgroundRecord = {
  default: '#F5F5F5',
  secondary: `#F8F9FA`,
  paper: '#FFFFFF',
}
export const backgroundsDark: BackgroundRecord = {
  default: '#1E242B',
  secondary: `#404C5C`,
  paper: '#2C3540',
}

export const ordinalPrimaryLight: PrimaryRecord = {
  main: '#404C5C',
  light: '#666F7C',
  dark: '#2C3540',
  contrastText: '#FFFFFF',
}
export const ordinalPrimaryDark: PrimaryRecord = {
  main: '#2C3540',
  light: '#3D4B5C',
  dark: '#202830',
  contrastText: '#FFFFFF',
}

export const ordinalSecondaryLight: SecondaryRecord = {
  main: '#039BE5',
  light: '#40C4FF',
  dark: '#0277BD',
  contrastText: '#FFFFFF',
}
export const ordinalSecondaryDark: SecondaryRecord = {
  main: '#03A9F4',
  light: '#40C4FF',
  dark: '#026CA0',
  contrastText: '#FFFFFF',
}

export const ordinalTertiaryLight: TertiaryRecord = {
  main: '#9C27B0',
  light: '#AF52BF',
  dark: '#6D1B7B',
  contrastText: '#FFFFFF',
}
export const ordinalTertiaryDark: TertiaryRecord = {
  main: '#AB47BC',
  light: '#BA68C8',
  dark: '#9C27B0',
  contrastText: '#FFFFFF',
}

export const ordinalQuaternaryLight: QuaternaryRecord = {
  main: '#E040FB',
  light: '#E666FB',
  dark: '#9C2CAF',
  contrastText: '#FFFFFF',
}
export const ordinalQuaternaryDark: QuaternaryRecord = {
  main: '#E040FB',
  light: '#E666FB',
  dark: '#9C2CAF',
  contrastText: '#FFFFFF',
}

export const ordinalLight: OrdinalRecord = {
  primary: {...ordinalPrimaryLight},
  secondary: {...ordinalSecondaryLight},
  tertiary: {...ordinalTertiaryLight},
  quaternary: {...ordinalQuaternaryLight},
}
export const ordinalDark: OrdinalRecord = {
  primary: {...ordinalPrimaryDark},
  secondary: {...ordinalSecondaryDark},
  tertiary: {...ordinalTertiaryDark},
  quaternary: {...ordinalQuaternaryDark},
}

export const actionSvgBgLight: IActionStates = {
  main: shadesOfGrey[50],
  hover: shadesOfGrey[50],
  active: shadesOfGrey[50],
  focus: shadesOfGrey[50],
}
export const actionSvgBgDark: IActionStates = {
  main: shadesOfGrey[50],
  hover: shadesOfGrey[50],
  active: shadesOfGrey[50],
  focus: shadesOfGrey[50],
}
export const actionSvgFilledLight: IActionStates = {
  main: shadesOfGrey[500],
  hover: ordinalSecondaryLight.light,
  active: ordinalSecondaryLight.light,
  focus: ordinalSecondaryLight.light,
}
export const actionSvgFilledDark: IActionStates = {
  main: shadesOfGrey[500],
  hover: ordinalSecondaryDark.light,
  active: ordinalSecondaryDark.light,
  focus: ordinalSecondaryDark.light,
}

export const actionSvgStrokeLight: IActionStates = {
  main: '#FFFFFF',
  hover: '#FFFFFF',
  active: '#FFFFFF',
  focus: '#FFFFFF',
}
export const actionSvgStrokeDark: IActionStates = {
  main: '#FFFFFF',
  hover: '#FFFFFF',
  active: '#FFFFFF',
  focus: '#FFFFFF',
}

export const actionsLight: ActionRecord = {
  svgBackground: actionSvgBgLight,
  svgFilled: actionSvgFilledLight,
  svgStroke: actionSvgStrokeLight,
}
export const actionsDark: ActionRecord = {
  svgBackground: actionSvgBgDark,
  svgFilled: actionSvgFilledDark,
  svgStroke: actionSvgStrokeDark,
}

const shadowKeyUmbraOpacity = 0.2
const shadowKeyPenumbraOpacity = 0.14
const shadowAmbientShadowOpacity = 0.12

function createShadowInset(...px) {
  return [
    `inset ${px[0]}px ${px[1]}px ${px[2]}px ${px[3]}px rgba(0,0,0,${shadowKeyUmbraOpacity})`,
    `inset ${px[4]}px ${px[5]}px ${px[6]}px ${px[7]}px rgba(0,0,0,${shadowKeyPenumbraOpacity})`,
    `inset ${px[8]}px ${px[9]}px ${px[10]}px ${px[11]}px rgba(0,0,0,${shadowAmbientShadowOpacity})`,
  ].join(',')
}

const baseOptions: ThemeOptions = {
  components: {
    MuiAppBar: {
      defaultProps: {
        enableColorOnDark: true,
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: {
          width: 32,
          height: 32,
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
            pointerEvents: 'none',
            textDecoration: 'none',
            filter: 'grayscale(1) opacity(0.65)',
          },
        },
      },
    },
    MuiFab: {
      defaultProps: {
        color: 'secondary',
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
      variants: [
        {
          props: {variant: 'outlined'} as any, // @TODO ⚠️ fix typing
          style: ({theme}) => ({
            border: `1px solid`,
            borderColor: `inherit`,
          }),
        },
      ],
    },
    MuiLink: {
      defaultProps: {
        color: 'secondary',
      },
      styleOverrides: {
        root: {
          '&[disabled], &.disabled': {
            pointerEvents: 'none',
            textDecoration: 'none',
            filter: 'grayscale(1) opacity(0.65)',
          },
        },
      },
    },
    MuiMenu: {},
    MuiToolbar: {
      styleOverrides: {
        root: ({theme}) => ({
          [theme.breakpoints.up('sm')]: {
            paddingLeft: theme.spacing(3),
            paddingRight: theme.spacing(3),
          },
        }),
      },
    },
    MuiTooltip: {
      defaultProps: {
        arrow: true,
      },
    },
  },
  mixins: {},
  shadowsInset: [
    'none',
    createShadowInset(0, 2, 1, -1, 0, 1, 1, -0, 0, 1, 3, -0),
    createShadowInset(0, 3, 1, -2, 0, 2, 2, -0, 0, 1, 5, -0),
    createShadowInset(0, 3, 3, -2, 0, 3, 4, -0, 0, 1, 8, -0),
    createShadowInset(0, 2, 4, -1, 0, 4, 5, -0, 0, 1, 10, -0),
    createShadowInset(0, 3, 5, -1, 0, 5, 8, -0, 0, 1, 14, -0),
    createShadowInset(0, 3, 5, -1, 0, 6, 10, -0, 0, 1, 18, -0),
    createShadowInset(0, 4, 5, -2, 0, 7, 10, -1, 0, 2, 16, -1),
    createShadowInset(0, 5, 5, -3, 0, 8, 10, -1, 0, 3, 14, -2),
    createShadowInset(0, 5, 6, -3, 0, 9, 12, -1, 0, 3, 16, -2),
    createShadowInset(0, 6, 6, -3, 0, 10, 14, -1, 0, 4, 18, -3),
    createShadowInset(0, 6, 7, -4, 0, 11, 15, -1, 0, 4, 20, -3),
    createShadowInset(0, 7, 8, -4, 0, 12, 17, -2, 0, 5, 22, -4),
    createShadowInset(0, 7, 8, -4, 0, 13, 19, -2, 0, 5, 24, -4),
    createShadowInset(0, 7, 9, -4, 0, 14, 21, -2, 0, 5, 26, -4),
    createShadowInset(0, 8, 9, -5, 0, 15, 22, -2, 0, 6, 28, -5),
    createShadowInset(0, 8, 10, -5, 0, 16, 24, -2, 0, 6, 30, -5),
    createShadowInset(0, 8, 11, -5, 0, 17, 26, -2, 0, 6, 32, -5),
    createShadowInset(0, 9, 11, -5, 0, 18, 28, -2, 0, 7, 34, -6),
    createShadowInset(0, 9, 12, -6, 0, 19, 29, -2, 0, 7, 36, -6),
    createShadowInset(0, 10, 13, -6, 0, 20, 31, -3, 0, 8, 38, -7),
    createShadowInset(0, 10, 13, -6, 0, 21, 33, -3, 0, 8, 40, -7),
    createShadowInset(0, 10, 14, -6, 0, 22, 35, -3, 0, 8, 42, -7),
    createShadowInset(0, 11, 14, -7, 0, 23, 36, -3, 0, 9, 44, -8),
    createShadowInset(0, 11, 15, -7, 0, 24, 38, -3, 0, 9, 46, -8),
  ],
  shape: {
    borderRadius: 10,
    appIconBorderRadius: `17.544%`,
  },
  spacing: 8,
  typography: {
    fontFamily: buildFontFamilyList().join(','),
    // fontSize: 14,
    // htmlFontSize: 16,
    // fontWeightLight: 300,
    // fontWeightRegular: 400,
    // fontWeightMedium: 500,
    // fontWeightBold: 700,
    // h1: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '6rem',
    //   fontWeight: 300,
    //   lineHeight: 1.167,
    //   letterSpacing: '-0.01562em',
    // },
    // h2: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '3.75rem',
    //   fontWeight: 300,
    //   lineHeight: 1.2,
    //   letterSpacing: '-0.00833em',
    // },
    // h3: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '3rem',
    //   fontWeight: 400,
    //   lineHeight: 1.167,
    //   letterSpacing: '0em',
    // },
    // h4: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '2.125rem',
    //   fontWeight: 400,
    //   lineHeight: 1.235,
    //   letterSpacing: '0.00735em',
    // },
    // h5: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '1.5rem',
    //   fontWeight: 500,
    //   lineHeight: 1.334,
    //   letterSpacing: '0em',
    // },
    // h6: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '1.25rem',
    //   fontWeight: 700,
    //   lineHeight: 1.6,
    //   letterSpacing: '0.0075em',
    // },
    // subtitle1: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '1rem',
    //   fontWeight: 400,
    //   lineHeight: 1.75,
    //   letterSpacing: '0.00938em',
    // },
    // subtitle2: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '0.875rem',
    //   fontWeight: 500,
    //   lineHeight: 1.57,
    //   letterSpacing: '0.00714em',
    // },
    // body1: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '1rem',
    //   fontWeight: 400,
    //   lineHeight: 1.5,
    //   letterSpacing: '0.00938em',
    // },
    // body2: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '0.875rem',
    //   fontWeight: 400,
    //   lineHeight: 1.43,
    //   letterSpacing: '0.01071em',
    // },
    // button: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '0.875rem',
    //   fontWeight: 500,
    //   lineHeight: 1.75,
    //   letterSpacing: '0.02857em',
    //   textTransform: 'uppercase',
    // },
    // caption: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '0.75rem',
    //   fontWeight: 400,
    //   lineHeight: 1.66,
    //   letterSpacing: '0.03333em',
    // },
    // overline: {
    //   fontFamily: defaultFontFamily,
    //   fontSize: '0.75rem',
    //   fontWeight: 400,
    //   lineHeight: 2.66,
    //   letterSpacing: '0.08333em',
    //   textTransform: 'uppercase',
    // },
  },
  zIndex: {
    blocking: 999999,
  },
}

export const consoleOptions: ThemeOptions = {
  ...baseOptions,
  palette: {
    mode: 'light',
    background: {...backgroundsLight},
    grey: {...shadesOfGrey},
    ...ordinalLight,
    ...actionsLight,
    ...status,
  },
}
export const consoleOptionsDark: ThemeOptions = {
  ...baseOptions,
  palette: {
    mode: 'dark',
    background: {...backgroundsDark},
    grey: {...shadesOfGrey},
    ...ordinalDark,
    ...actionsDark,
    ...status,
  },
}

export const consoleThemeLight: Theme = createResponsiveTheme({
  themeOptions: {...consoleOptions},
})
export const consoleThemeDark: Theme = createResponsiveTheme({
  themeOptions: {...consoleOptionsDark},
})
export const getConsoleTheme = (mode: 'light' | 'dark' = 'light') => {
  const theme = {
    light: consoleThemeLight,
    dark: consoleThemeDark,
  }
  return theme[mode]
}
export const getConsoleMetaThemeColor = (mode: 'light' | 'dark' = 'light') => {
  const themeColor = {
    light: consoleThemeLight.palette.secondary.main,
    dark: consoleThemeDark.palette.primary.main,
  }
  return themeColor[mode]
}
export default consoleThemeLight
