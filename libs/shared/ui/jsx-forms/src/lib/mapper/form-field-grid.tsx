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

import { HelpTip, type HelpTipContent } from '@aglyn/shared-ui-jsx'
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
  /** Contextual help affordance at the field's top-right (AGL-601). */
  help?: HelpTipContent
}

export const FormFieldGrid = ({
  children,
  className,
  help,
  size = { xs: 12 },
  ...props
}: FormFieldGridProps) => (
  <StyledGrid size={size} className={clsx(classes.grid, className)} {...props}>
    {children}
    {help && (
      <HelpTip
        {...help}
        sx={{
          position: 'absolute',
          top: -6,
          right: 0,
          fontSize: '0.95em',
          zIndex: 1,
        }}
      />
    )}
  </StyledGrid>
)

export default FormFieldGrid
