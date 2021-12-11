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

import { ThemeOptions } from '../../vendor/mui'
import { useFontFamily } from '../util/use-font-family'

const defaultFontFamily = useFontFamily('"Raleway"')

export const consoleTypography: ThemeOptions['typography'] = {
  fontFamily: defaultFontFamily,
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
}
export default consoleTypography
