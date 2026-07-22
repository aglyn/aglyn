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
'use client'

import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import {
  Container,
  MdiIcon,
  NavigationDrawerComponent,
  SrOnly,
} from '@aglyn/shared-ui-jsx'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import { Button, IconButton, Typography } from '@mui/material'
import AuthErrorAlertComponent from './auth-error-alert.component'
import AuthFormTemplateComponent from './auth-form-template.component'

export interface CreateArtifactDrawerProps {
  open: boolean
  onClose: () => void
  /** Drawer heading, e.g. "Create new component". */
  title: string
  /** Receives the collected field values; closing is the caller's job. */
  onSubmit: (values: Record<string, any>) => void | Promise<void>
  /** Extra fields appended after name and description. */
  extraFields?: any[]
  /** Rendered under the form when a submit fails. */
  error?: unknown
}

/**
 * The naming step in front of Create (AGL-700).
 *
 * Components and templates used to write an `Untitled …` document and
 * navigate straight to it, so a library filled with rows nobody could tell
 * apart and every one of them needed a rename afterwards. Layouts already
 * collected a name first; this is that drawer, lifted out of the layouts
 * list so all three surfaces share one implementation rather than three
 * copies that drift.
 *
 * A drawer rather than a dialog on purpose: creating is a drawer, picking is
 * a dialog (AGL-699).
 */
export function CreateArtifactDrawer(props: CreateArtifactDrawerProps) {
  const { open, onClose, title, onSubmit, extraFields, error } = props
  const schema = {
    fields: [...BASE_FIELDS, ...(extraFields ?? [])],
  }
  return (
    <NavigationDrawerComponent
      open={open}
      anchor="right"
      variant="temporary"
      onClose={onClose}
      AppBarProps={{ color: 'surface' }}
      appBarLeft={
        <>
          <IconButton
            color="inherit"
            edge="start"
            onClick={onClose}
            sx={{ mr: 2 }}
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>close drawer</SrOnly>
          </IconButton>
          <Typography variant="h6" component="div">
            {title}
          </Typography>
        </>
      }
      appBarRight={
        <Button variant="outlined" color="inherit" onClick={onClose}>
          {'Cancel'}
        </Button>
      }
    >
      <Container gutterY>
        <FormRenderer
          FormTemplate={AuthFormTemplateComponent}
          componentMapper={simpleComponentMapper}
          onSubmit={onSubmit}
          schema={schema}
          subscription={{ values: true }}
          clearOnUnmount
        />
        <AuthErrorAlertComponent error={error as any} sx={{ mt: 2, mb: 1 }} />
      </Container>
    </NavigationDrawerComponent>
  )
}

/**
 * Same shape and limits the layouts drawer has used since AGL-473, so the
 * three creates validate identically.
 */
const BASE_FIELDS = [
  {
    component: 'text-field',
    name: 'displayName',
    helperText: 'Friendly name for internal reference',
    type: 'text',
    label: 'Display name',
    isRequired: true,
    validate: [
      { type: 'required', message: 'Provide a display name' },
      {
        type: 'max-length',
        threshold: 25,
        message: 'Must not exceed 25 characters',
      },
    ],
  },
  {
    component: 'textarea',
    name: 'description',
    label: 'Description',
    helperText: 'Brief description for internal reference',
    validate: [
      {
        type: 'max-length',
        threshold: 80,
        message: 'Must not exceed 80 characters',
      },
    ],
  },
]

CreateArtifactDrawer.displayName = 'CreateArtifactDrawer'

export default CreateArtifactDrawer
