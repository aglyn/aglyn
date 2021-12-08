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

import { PaletteOptions } from '../../vendor/mui'
import { IActionStates } from '../theme.types'


/**
 * Console Theme
 */
export namespace ConsolePalette {
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

  export type ColorVariant = 'light' | 'dark'
  export type BackgroundRecord = PaletteOptions['background']

  export namespace Background {
    export const light: BackgroundRecord = {
      default: '#F5F5F5',
      secondary: `#F8F9FA`,
      paper: '#FFFFFF',
    }
    export const dark: BackgroundRecord = {
      default: '#1E242B',
      paper: '#2C3540',
    }
  }

  export type OrdinalIdentifier = 'primary' | 'secondary' | 'tertiary' | 'quaternary'
  export type OrdinalRecord = Pick<PaletteOptions, OrdinalIdentifier>

  export namespace Ordinal {
    export type PrimaryRecord = PaletteOptions['primary']
    export type SecondaryRecord = PaletteOptions['secondary']
    export type TertiaryRecord = PaletteOptions['tertiary']
    export type QuaternaryRecord = PaletteOptions['quaternary']

    export namespace Primary {
      export const LIGHT: PrimaryRecord = {
        main: '#404C5C',
        light: '#666F7C',
        dark: '#2C3540',
        contrastText: '#FFFFFF',
      }
      export const DARK: PrimaryRecord = {
        main: '#2C3540',
        light: '#3D4B5C',
        dark: '#202830',
        contrastText: '#FFFFFF',
      }
    }

    export namespace Secondary {
      export const LIGHT: SecondaryRecord = {
        main: '#039BE5',
        light: '#40C4FF',
        dark: '#0277BD',
        contrastText: '#FFFFFF',
      }
      export const DARK: SecondaryRecord = {
        main: '#03A9F4',
        light: '#40C4FF',
        dark: '#026CA0',
        contrastText: '#000000',
      }
    }

    export namespace Tertiary {
      export const LIGHT: TertiaryRecord = {
        main: '#9C27B0',
        light: '#AF52BF',
        dark: '#6D1B7B',
        contrastText: '#FFFFFF',
      }
      export const DARK: TertiaryRecord = {
        main: '#AB47BC',
        light: '#BA68C8',
        dark: '#9C27B0',
        contrastText: '#FFFFFF',
      }
    }

    export namespace Quaternary {
      export const LIGHT: QuaternaryRecord = {
        main: '#E040FB',
        light: '#E666FB',
        dark: '#9C2CAF',
        contrastText: '#FFFFFF',
      }
      export const DARK: QuaternaryRecord = {
        main: '#E040FB',
        light: '#E666FB',
        dark: '#9C2CAF',
        contrastText: '#FFFFFF',
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


  export type ActionIdentifier = 'svgBackground' | 'svgFilled' | 'svgStroke'
  export type ActionRecord = Pick<PaletteOptions, ActionIdentifier>

  // TODO: SETUP COLORS
  export namespace Action {
    export namespace SvgBackground {
      export const LIGHT: IActionStates = {
        main:  ConsolePalette.shadesOfGrey[50],
        hover:  ConsolePalette.shadesOfGrey[50],
        active:  ConsolePalette.shadesOfGrey[50],
        focus:  ConsolePalette.shadesOfGrey[50],
      }
      export const DARK: IActionStates = {
        main:  ConsolePalette.shadesOfGrey[50],
        hover:  ConsolePalette.shadesOfGrey[50],
        active:  ConsolePalette.shadesOfGrey[50],
        focus: ConsolePalette.shadesOfGrey[50],
      }
    }
    export namespace SvgFilled {
      export const LIGHT: IActionStates = {
        main:  ConsolePalette.shadesOfGrey[500],
        hover: Ordinal.LIGHT.secondary['light'],
        active: Ordinal.LIGHT.secondary['light'],
        focus: Ordinal.LIGHT.secondary['light'],
      }
      export const DARK: IActionStates = {
        main:  ConsolePalette.shadesOfGrey[500],
        hover: Ordinal.LIGHT.secondary['light'],
        active: Ordinal.LIGHT.secondary['light'],
        focus: Ordinal.LIGHT.secondary['light'],
      }
    }
    export namespace SvgStroke {
      export const LIGHT: IActionStates = {
        main: '#FFFFFF',
        hover: '#FFFFFF',
        active: '#FFFFFF',
        focus: '#FFFFFF',
      }
      export const DARK: IActionStates = {
        main: '#FFFFFF',
        hover: '#FFFFFF',
        active: '#FFFFFF',
        focus: '#FFFFFF',
      }
    }

    export const LIGHT: ActionRecord = {
      svgBackground: SvgBackground.LIGHT,
      svgFilled: SvgFilled.LIGHT,
      svgStroke: SvgStroke.LIGHT,
    }
    export const DARK: ActionRecord = {
      svgBackground: SvgBackground.DARK,
      svgFilled: SvgFilled.DARK,
      svgStroke: SvgStroke.DARK,
    }
  }
}

export const consolePalette: Record<Uppercase<ConsolePalette.ColorVariant>, PaletteOptions> = {
  LIGHT: {
    mode: 'light',
    background: {...ConsolePalette.Background.light},
    grey: {...ConsolePalette.shadesOfGrey},
    ...ConsolePalette.Ordinal.LIGHT,
    ...ConsolePalette.Action.LIGHT,
    ...ConsolePalette.status,
  },
  DARK: {
    mode: 'dark',
    background: {...ConsolePalette.Background.dark},
    grey: {...ConsolePalette.shadesOfGrey},
    ...ConsolePalette.Ordinal.DARK,
    ...ConsolePalette.Action.DARK,
    ...ConsolePalette.status,
  },
}

export default consolePalette
