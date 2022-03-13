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

import type {PaletteOptions} from '../../vendor/mui'
import type {IActionStates} from '../theme.types'


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
  contrastText: '#000000',
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

export const consolePalette: Record<Uppercase<ColorVariant>, PaletteOptions> = {
  LIGHT: {
    mode: 'light',
    background: {...backgroundsLight},
    grey: {...shadesOfGrey},
    ...ordinalLight,
    ...actionsLight,
    ...status,
  },
  DARK: {
    mode: 'dark',
    background: {...backgroundsDark},
    grey: {...shadesOfGrey},
    ...ordinalDark,
    ...actionsDark,
    ...status,
  },
}

export default consolePalette
