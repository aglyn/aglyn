/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { ThemeOptions } from '../types'
import '../mui-overrides'


/**
 * Console Theme
 */
export namespace ConsolePalette {

  export type ColorVariant = 'light' | 'dark'
  export type BackgroundRecord = ThemeOptions['palette']['background']

  export namespace Background {
    export const light: BackgroundRecord = {
      default: '#fafafa',
      paper: '#ffffff',
    }
    export const dark: BackgroundRecord = {
      default: '#1e242b',
      paper: '#2c3540',
    }
  }

  export type OrdinalIdentifier = 'primary' | 'secondary' | 'tertiary' | 'quaternary'
  export type OrdinalRecord = Pick<ThemeOptions['palette'], OrdinalIdentifier>

  export namespace Ordinal {
    export type PrimaryRecord = ThemeOptions['palette']['primary']
    export type SecondaryRecord = ThemeOptions['palette']['secondary']
    export type TertiaryRecord = ThemeOptions['palette']['tertiary']
    export type QuaternaryRecord = ThemeOptions['palette']['quaternary']

    export namespace Primary {
      export const LIGHT: PrimaryRecord = {
        main: '#404c5c',
        light: '#666f7c',
        dark: '#2c3540',
        contrastText: '#ffffff',
      }
      export const DARK: PrimaryRecord = {
        main: '#2c3540',
        light: '#3d4b5c',
        dark: '#202830',
        contrastText: '#ffffff',
      }
    }

    export namespace Secondary {
      export const LIGHT: SecondaryRecord = {
        main: '#039be5',
        light: '#40c4ff',
        dark: '#0277bd',
        contrastText: '#ffffff',
      }
      export const DARK: SecondaryRecord = {
        main: '#03a9f4',
        light: '#40c4ff',
        dark: '#026ca0',
        contrastText: '#000000',
      }
    }

    export namespace Tertiary {
      export const LIGHT: TertiaryRecord = {
        main: '#9c27b0',
        light: '#af52bf',
        dark: '#6d1b7b',
        contrastText: '#ffffff',
      }
      export const DARK: TertiaryRecord = {
        main: '#ab47bc',
        light: '#ba68c8',
        dark: '#9c27b0',
        contrastText: '#ffffff',
      }
    }

    export namespace Quaternary {
      export const LIGHT: QuaternaryRecord = {
        main: '#e040fb',
        light: '#e666fb',
        dark: '#9c2caf',
        contrastText: '#ffffff',
      }
      export const DARK: QuaternaryRecord = {
        main: '#e040fb',
        light: '#e666fb',
        dark: '#9c2caf',
        contrastText: '#ffffff',
      }
    }

    export const LIGHT: OrdinalRecord = {
      primary: {...Primary.LIGHT},
      secondary: {...Secondary.LIGHT},
      tertiary: {...Tertiary.LIGHT},
      quaternary: {...Quaternary.LIGHT},
    }
    export const DARK: OrdinalRecord = {
      primary: {...Primary.DARK},
      secondary: {...Secondary.DARK},
      tertiary: {...Tertiary.DARK},
      quaternary: {...Quaternary.DARK},
    }
  }

  export const status = {
    info: {
      main: '#e53935',
      light: '#ea605d',
      dark: '#a02725',
      contrastText: '#ffffff',
    },
    error: {
      main: '#e53935',
      light: '#ea605d',
      dark: '#a02725',
      contrastText: '#ffffff',
    },
    success: {
      light: '#81c784',
      main: '#4caf50',
      dark: '#388e3c',
      contrastText: '#000000de',
    },
    warning: {
      main: '#ffab40',
      light: '#ffbb66',
      dark: '#b2772c',
      contrastText: '#000000de',
    },
  }

  export const shadesOfGrey = {
    50: '#fafafa',
    100: '#f5f5f5',
    200: '#eeeeee',
    300: '#e0e0e0',
    400: '#bdbdbd',
    500: '#9e9e9e',
    600: '#757575',
    700: '#616161',
    800: '#424242',
    900: '#212121',
    A100: '#d5d5d5',
    A200: '#aaaaaa',
    A400: '#303030',
    A700: '#616161',
  }
}

export const consolePalette: Record<Uppercase<ConsolePalette.ColorVariant>, ThemeOptions['palette']> = {
  LIGHT: {
    type: 'light',
    ...ConsolePalette.Ordinal.LIGHT,
    ...ConsolePalette.status,
    grey: {...ConsolePalette.shadesOfGrey},
    background: {...ConsolePalette.Background.light},
  },
  DARK: {
    type: 'dark',
    ...ConsolePalette.Ordinal.DARK,
    ...ConsolePalette.status,
    grey: {...ConsolePalette.shadesOfGrey},
    background: {...ConsolePalette.Background.dark},
  },
}

export default consolePalette
