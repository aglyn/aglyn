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

export enum FontFamily {
  ADOBE_ARABIC = '"Adobe Arabic"',
  APPLE_COLOR_EMOJI = '"Apple Color Emoji"',
  APPLE_GOTHIC = 'AppleGothic',
  APPLE_SYMBOLS = '"Apple Symbols"',
  APPLE_SYSTEM = '-apple-system',
  ARIAL = 'Arial',
  ARIAL_BLACK = '"Arial Black"',
  ARIAL_HEBREW = '"Arial Hebrew"',
  ARIAL_NARRWOW = '"Arial Narrow"',
  ARIAL_UNICODE_MS = '"Arial Unicode MS"',
  BLINK_MAC_SYSTEM_FONT = 'BlinkMacSystemFont',
  CENTURY_GOTHIC = '"Century Gothic"',
  CHALKBOARD = 'Chalkboard',
  CHALKBOARD_SE = '"Chalkboard SE"',
  COURIER = 'Courier',
  COURIER_NEW = '"Courier New"',
  DAMASCUS = 'Damascus',
  DARLESTON = 'Darleston',
  ELIANTO = 'Elianto',
  FIRA_CODE = '"Fira Code"',
  FONT_AWESOME = 'FontAwesome',
  FONT_AWESOME_5_BRANDS = '"Font Awesome 5 Brands"',
  FONT_AWESOME_5_FREE = '"Font Awesome 5 Free"',
  FRUTIGER_NEUE_LT = '"Frutiger Neue LT"',
  FRUTIGER_NEUE_LT_PRO = '"Frutiger Neue LT Pro"',
  FUTURA = 'Futura',
  HELVETICA = 'Helvetica',
  HELVETICA_NEUE = '"Helvetica Neue"',
  MONOSPACED = 'Monospaced',
  MYRIAD_ARABIC = '"Myriad Arabic"',
  MYRIAD_HEBREW = '"Myriad Hebrew"',
  MYRIAD_PRO = '"Myriad Pro"',
  PT_MONO = '"PT Mono"',
  PT_SANS = '"PT Sans"',
  PT_SANS_CAPTION = '"PT Sans Caption"',
  PT_SANS_NARROW = '"PT Sans Narrown"',
  PT_SERIF = '"PT Serif"',
  PT_SERIF_CAPTION = '"PT Serif Caption"',
  RALEWAY = 'Raleway',
  ROBOTO = 'Roboto',
  ROBOTO_CONDENSED = '"Roboto Condensed"',
  Rockwell = 'Rockwell',
  SANS_SERIF = 'sans-serif',
  SEGOE_UI = '"Segoe UI"',
  SEGOE_UI_EMOJI = '"Segoe UI Emoji"',
  SEGOE_UI_SYMBOL = '"Segoe UI Symbol"',
  SF_PRO = '"SF Pro"',
  SF_PRO_DISPLAY = '"SF Pro Display"',
  SF_PRO_TEXT = '"SF Pro Text"',
  TIMES_NEW_ROMAN = '"Times New Roman"',
  VERDANA = 'Verdana',
}

export const FALLBACK_FONT_FAMILY = [
  FontFamily.APPLE_SYSTEM,
  FontFamily.BLINK_MAC_SYSTEM_FONT,
  FontFamily.SEGOE_UI,
  FontFamily.ROBOTO,
  FontFamily.ROBOTO_CONDENSED,
  FontFamily.HELVETICA_NEUE,
  FontFamily.ARIAL,
  FontFamily.SANS_SERIF,
  FontFamily.APPLE_COLOR_EMOJI,
  FontFamily.SEGOE_UI_EMOJI,
  FontFamily.SEGOE_UI_SYMBOL,
]
