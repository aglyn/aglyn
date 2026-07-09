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

/**
 * Ported from `@data-driven-forms/mui-component-mapper` (Apache-2.0) and
 * updated for the current MUI Grid API (`size` instead of `item`/`xs`).
 */

import type { ReactNode } from 'react'

import { Grid, type GridProps } from '@mui/material'
import { styled } from '@mui/material/styles'

import clsx from 'clsx'

const PREFIX = 'FormFieldGrid'

const classes = {
  grid: `${PREFIX}-grid`,
}

const StyledGrid = styled(Grid)({
  [`&.${classes.grid}`]: {
    position: 'relative',
  },
})

export interface FormFieldGridProps extends Omit<GridProps, 'size'> {
  children?: ReactNode
  className?: string
  size?: GridProps['size']
}

export const FormFieldGrid = ({
  children,
  className,
  size = { xs: 12 },
  ...props
}: FormFieldGridProps) => (
  <StyledGrid size={size} className={clsx(classes.grid, className)} {...props}>
    {children}
  </StyledGrid>
)

export default FormFieldGrid
