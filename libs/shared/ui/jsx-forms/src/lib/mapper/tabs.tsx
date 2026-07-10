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
 * updated for the current MUI Grid API.
 */

import { useState } from 'react'

import {
  AppBar,
  type AppBarProps,
  Grid,
  type GridProps,
  Tab,
  type TabProps as MuiTabProps,
  Tabs,
  type TabsProps,
} from '@mui/material'

import { type FieldSchema, useFormApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'

interface TabField {
  fields: FieldSchema[]
  title?: string
  name?: string
}

export interface FormTabsProps {
  fields: TabField[]
  AppBarProps?: AppBarProps
  TabsProps?: TabsProps
  TabProps?: MuiTabProps
  FormFieldGridProps?: FormFieldGridProps
  GridItemProps?: GridProps
}

export const FormTabs = ({
  fields,
  AppBarProps = {},
  TabsProps = {},
  TabProps = {},
  FormFieldGridProps = {},
  GridItemProps = {},
}: FormTabsProps) => {
  const formOptions = useFormApi()
  const [activeTab, setActiveTab] = useState(0)

  return (
    <FormFieldGrid container {...FormFieldGridProps}>
      <AppBar position="static" {...AppBarProps}>
        <Tabs
          textColor="inherit"
          value={activeTab}
          onChange={(_e, tabIndex) => setActiveTab(tabIndex)}
          {...TabsProps}
        >
          {fields.map(({ title, name }, index) => (
            <Tab key={name || index} label={title} {...TabProps} />
          ))}
        </Tabs>
      </AppBar>
      {fields.map(({ fields, name }, index) => (
        <Grid
          key={name || index}
          container
          size={{ xs: 12 }}
          rowSpacing={2}
          sx={{ mt: 1, ...(index !== activeTab && { display: 'none' }) }}
          {...GridItemProps}
        >
          {formOptions.renderForm(fields)}
        </Grid>
      ))}
    </FormFieldGrid>
  )
}

export default FormTabs
