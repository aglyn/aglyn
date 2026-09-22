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

import { HelpTip, type HelpTipContent } from '@aglyn/shared-ui-jsx'
import { createContext, useContext, type ReactNode } from 'react'

import {
  Grid,
  type GridProps,
  Typography,
  type TypographyProps,
} from '@mui/material'

import { type FieldSchema, useFormApi } from '../vendor/data-driven-forms'

/**
 * How deeply nested this sub-form is (AGL-3253).
 *
 * A section cannot be told apart from a SUBsection by anything in its own
 * schema — both are a `SUB_FORM` with a `title`, and the SEO card's Address
 * sits inside its Entity for a reason nobody wants to restate as a prop. So
 * the depth is read from the tree rather than declared, which means any
 * nesting added later inherits the same answer without being asked.
 */
const SubFormDepth = createContext(0)

export interface SubFormProps extends Omit<GridProps, 'component' | 'title'> {
  fields: FieldSchema[]
  title?: ReactNode
  description?: ReactNode
  component?: string
  /** Contextual help affordance rendered beside the section title (AGL-601). */
  help?: HelpTipContent
  TitleGridProps?: GridProps
  TitleProps?: TypographyProps
  DescriptionProps?: TypographyProps
  DescriptionGridProps?: GridProps
  ItemsGridProps?: GridProps
}

/**
 * A titled group of fields, with a rhythm of its own (AGL-3253).
 *
 * ## What was wrong with one gap for everything
 *
 * MUI v7's Grid spaces with `gap` and CSS custom properties, and custom
 * properties INHERIT. So the `spacing={2}` on a card's outer container
 * reached every container nested under it through the DOM, and this
 * component's title row, its description and its fields were one
 * undifferentiated 16px stack: a heading sat no closer to the fields it names
 * than to the field above it, and where the first field was a multiline text
 * box the heading landed flush against its floating label.
 *
 * Three numbers fix it, and they are declared here rather than inherited:
 *
 *  - **8px under a heading**, tighter than the 16px between fields, which is
 *    what makes a heading read as belonging to what follows it.
 *  - **16px between fields**, unchanged.
 *  - **16px (nested) or 32px (top level) above a section**, which is the only
 *    thing that says a new group has started.
 *
 * `columnSpacing` is declared for the same reason: a sub-form rendered under
 * a container that spaces differently would otherwise inherit that container's
 * column gap, so two `sm: 6` fields could sit flush in one card and apart in
 * the next.
 *
 * ## And the titles are sized against the card, not against each other
 *
 * `CardDisplay` renders its own title at `h6`. This component asked for `h5`,
 * which is LARGER — so a section heading outranked the card containing it,
 * and a nested section's heading was the same size again as its parent's.
 * Depth 0 is `subtitle1`, depth 1 and below is a small uppercase label: below
 * the card, above the fields, and in order among themselves.
 *
 * The heading stays a real heading ELEMENT at every depth. It is what a
 * screen reader navigates this form by, and the card's own title is a `div`,
 * so nothing here competes with it.
 */
export const SubForm = ({
  fields,
  title,
  description,
  component: _component,
  help,
  TitleGridProps = {},
  TitleProps = {},
  DescriptionProps = {},
  DescriptionGridProps = {},
  ItemsGridProps = {},
  ...rest
}: SubFormProps) => {
  const { renderForm } = useFormApi()
  const depth = useContext(SubFormDepth)
  const top = depth === 0

  return (
    <Grid
      size={{ xs: 12 }}
      container
      rowSpacing={1}
      columnSpacing={2}
      // On TOP of the parent's own gap, so a top-level section is separated
      // by 32px and a nested one by 24px. Before `rest`, so a schema that
      // needs a different separation can still say so.
      sx={{ mt: top ? 2 : 1 }}
      {...rest}
    >
      {title && (
        <Grid size={{ xs: 12 }} {...TitleGridProps}>
          <Typography
            variant={top ? 'subtitle1' : 'overline'}
            component={top ? 'h4' : 'h5'}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              fontWeight: 600,
              lineHeight: 1.6,
              ...(top
                ? {}
                : { color: 'text.secondary', letterSpacing: '0.06em' }),
            }}
            {...TitleProps}
          >
            {title}
            {help && <HelpTip {...help} sx={{ fontSize: '0.7em' }} />}
          </Typography>
        </Grid>
      )}
      {description && (
        <Grid size={{ xs: 12 }} {...DescriptionGridProps}>
          {/* No `mb` of its own: the row gap above owns the space now, and a
              margin on top of it put a described section's fields further
              from their heading than an undescribed one's. */}
          <Typography variant="body2" color="text.secondary" {...DescriptionProps}>
            {description}
          </Typography>
        </Grid>
      )}
      <SubFormDepth.Provider value={depth + 1}>
        <Grid
          size={{ xs: 12 }}
          container
          rowSpacing={2}
          columnSpacing={2}
          {...ItemsGridProps}
        >
          {renderForm(fields)}
        </Grid>
      </SubFormDepth.Provider>
    </Grid>
  )
}

export default SubForm
