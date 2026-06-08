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

import { arraySortBy } from '@aglyn/shared-util-tools'
import {
  amber,
  blue,
  blueGrey,
  brown,
  common,
  cyan,
  deepOrange,
  deepPurple,
  green,
  grey,
  indigo,
  lightBlue,
  lightGreen,
  lime,
  orange,
  pink,
  purple,
  red,
  teal,
  yellow,
} from '@mui/material/colors'

const sortPalette = (palette: Record<string, string>) => {
  return arraySortBy(Object.entries(palette), ([k]) => {
    return parseInt(k, 11)
  })
}

export const materialPalettes = [
  { id: 'red', shades: sortPalette(red) },
  { id: 'pink', shades: sortPalette(pink) },
  { id: 'purple', shades: sortPalette(purple) },
  { id: 'deepPurple', shades: sortPalette(deepPurple) },
  { id: 'indigo', shades: sortPalette(indigo) },
  { id: 'blue', shades: sortPalette(blue) },
  { id: 'lightBlue', shades: sortPalette(lightBlue) },
  { id: 'cyan', shades: sortPalette(cyan) },
  { id: 'teal', shades: sortPalette(teal) },
  { id: 'green', shades: sortPalette(green) },
  { id: 'lightGreen', shades: sortPalette(lightGreen) },
  { id: 'lime', shades: sortPalette(lime) },
  { id: 'yellow', shades: sortPalette(yellow) },
  { id: 'amber', shades: sortPalette(amber) },
  { id: 'orange', shades: sortPalette(orange) },
  { id: 'deepOrange', shades: sortPalette(deepOrange) },
  { id: 'brown', shades: sortPalette(brown) },
  { id: 'grey', shades: sortPalette(grey) },
  { id: 'blueGrey', shades: sortPalette(blueGrey) },
  { id: 'common', shades: sortPalette(common) },
]

export default materialPalettes
