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

import { styled } from '@aglyn/shared-ui-theme'
import type { BoxProps } from '@mui/material'

export interface EllipsisPulseProps extends BoxProps {
  color?:
    | 'primary'
    | 'secondary'
    | 'error'
    | 'info'
    | 'success'
    | 'warning'
    | 'inherit'
    | string
}

const EllipsisPulseComponent = styled('span', {
  name: 'AglynEllipsisPulse',
})<EllipsisPulseProps>(({ theme, color }) => {
  const clr =
    !color || color === 'inherit'
      ? theme.palette.primary.main
      : color === 'primary'
      ? theme.palette.primary.main
      : color === 'secondary'
      ? theme.palette.secondary.main
      : color === 'error'
      ? theme.palette.error.main
      : color === 'info'
      ? theme.palette.info.main
      : color === 'success'
      ? theme.palette.success.main
      : color === 'warning'
      ? theme.palette.warning.main
      : typeof color === 'string'
      ? color
      : theme.palette.primary.main

  return {
    position: 'absolute',

    '&:after': {
      display: 'inline-block',
      animation: 'dotPulseAfter steps(1, end) 2s infinite',
      content: '""',
      color: clr,
    },

    '@keyframes dotPulseAfter': {
      '0%': { content: '""' },
      '25%': { content: '"."' },
      '50%': { content: '".."' },
      '75%': { content: '"..."' },
      '100%': { content: '""' },
    },
  }
})
EllipsisPulseComponent.displayName = 'EllipsisPulseComponent'

export { EllipsisPulseComponent }
export default EllipsisPulseComponent
