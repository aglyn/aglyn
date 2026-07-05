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

import { Stack, type StackProps } from '@mui/material'
import { forwardRef } from 'react'
import ColorSwatch from './color-swatch'
import materialPalettes from './constants/material-palettes'

export interface ColorGridProps extends StackProps {}

export const ColorGrid = forwardRef<any, ColorGridProps>((props, ref) => {
  const { ...rest } = props

  return (
    <Stack
      ref={ref}
      direction="row"
      spacing={0}
      {...rest}
      sx={[{
        alignItems: "stretch",
        justifyContent: "flex-start"
      }, ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx])]}>
      {materialPalettes.map(({ id, shades }) => (
        <Stack
          key={id}
          direction="column"
          spacing={0}
          sx={{ alignItems: 'center', justifyContent: 'flex-start' }}>
          {shades.map(([shade, color]) => (
            <Stack
              key={shade}
              title={`${id}/${shade}/${color}`}
              direction="column"
              spacing={0}
              sx={{ alignItems: 'center', justifyContent: 'flex-start' }}>
              <ColorSwatch color={color} />
            </Stack>
          ))}
        </Stack>
      ))}
    </Stack>
  );
})
ColorGrid.displayName = 'ColorGrid'
ColorGrid.aglyn = true

export default ColorGrid
