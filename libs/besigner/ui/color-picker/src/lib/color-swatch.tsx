/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { styled } from '@mui/material'
import type { ComponentProps } from 'react'
import { forwardRef } from 'react'

interface SwatchProps {
  color?: string
}

const Swatch = styled('div', {
  name: 'Swatch',
  shouldForwardProp(propName) {
    return propName !== 'color'
  },
})<SwatchProps>(({ theme, color }) => {
  const tv = (theme as any).vars || theme
  return {
    backgroundColor: color || '#FFF',
    height: 20,
    width: 20,
    overflow: 'hidden',
    border: `1px inset`,
    borderStyle: 'solid',
    borderColor: tv.palette.divider,
  }
})

export interface ColorSwatchProps extends ComponentProps<typeof Swatch> {}

export const ColorSwatch = forwardRef<any, ColorSwatchProps>((props, ref) => {
  const { children, ...rest } = props

  return <Swatch ref={ref} {...rest} />
})
ColorSwatch.displayName = 'ColorSwatch'
ColorSwatch.aglyn = true

export default ColorSwatch
