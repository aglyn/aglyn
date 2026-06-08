/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { Stack } from '@mui/material'
import { forwardRef } from 'react'
import ColorSwatch from './color-swatch'
import materialPalettes from './constants/material-palettes'

export interface ColorGridProps {}

export const ColorGrid = forwardRef<any, ColorGridProps>((props, ref) => {
  const { ...rest } = props

  return (
    <Stack
      ref={ref}
      direction="row"
      alignItems="stretch"
      justifyContent="flex-start"
      spacing={0}
      {...rest}
    >
      {materialPalettes.map(({ id, shades }) => (
        <Stack
          key={id}
          direction="column"
          alignItems="center"
          justifyContent="flex-start"
          spacing={0}
          {...rest}
        >
          {shades.map(([shade, color]) => (
            <Stack
              key={shade}
              title={`${id}/${shade}/${color}`}
              direction="column"
              alignItems="center"
              justifyContent="flex-start"
              spacing={0}
              {...rest}
            >
              <ColorSwatch color={color} />
            </Stack>
          ))}
        </Stack>
      ))}
    </Stack>
  )
})
ColorGrid.displayName = 'ColorGrid'
ColorGrid.aglyn = true

export default ColorGrid
