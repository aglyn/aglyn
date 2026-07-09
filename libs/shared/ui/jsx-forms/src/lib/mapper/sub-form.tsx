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
 * updated for the current MUI APIs (Grid `size`, no Typography `paragraph`).
 */

import type { ReactNode } from 'react'

import {
  Grid,
  type GridProps,
  Typography,
  type TypographyProps,
} from '@mui/material'
import { styled } from '@mui/material/styles'

import { type FieldSchema, useFormApi } from '../vendor/data-driven-forms'

const PREFIX = 'SubForm'

const classes = {
  grid: `${PREFIX}-grid`,
}

const StyledGrid = styled(Grid)(() => ({
  [`&.${classes.grid}`]: {
    paddingRight: 0,
    paddingLeft: 0,
  },
}))

export interface SubFormProps extends Omit<GridProps, 'component' | 'title'> {
  fields: FieldSchema[]
  title?: ReactNode
  description?: ReactNode
  component?: string
  TitleGridProps?: GridProps
  TitleProps?: TypographyProps
  DescriptionProps?: TypographyProps
  DescriptionGridProps?: GridProps
  ItemsGridProps?: GridProps
}

export const SubForm = ({
  fields,
  title,
  description,
  component: _component,
  TitleGridProps = {},
  TitleProps = {},
  DescriptionProps = {},
  DescriptionGridProps = {},
  ItemsGridProps = {},
  ...rest
}: SubFormProps) => {
  const { renderForm } = useFormApi()

  return (
    <StyledGrid size={{ xs: 12 }} container className={classes.grid} {...rest}>
      {title && (
        <Grid size={{ xs: 12 }} {...TitleGridProps}>
          <Typography variant="h5" {...TitleProps}>
            {title}
          </Typography>
        </Grid>
      )}
      {description && (
        <Grid size={{ xs: 12 }} {...DescriptionGridProps}>
          <Typography sx={{ mb: 2 }} {...DescriptionProps}>
            {description}
          </Typography>
        </Grid>
      )}
      <Grid size={{ xs: 12 }} container rowSpacing={2} {...ItemsGridProps}>
        {renderForm(fields)}
      </Grid>
    </StyledGrid>
  )
}

export default SubForm
