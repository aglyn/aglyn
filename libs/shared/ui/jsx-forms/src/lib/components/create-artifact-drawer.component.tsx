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
import { Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import {
  Box,
  Button,
  FormControl,
  Grid,
  IconButton,
  Typography,
} from '@mui/material'
import { forwardRef, type ReactNode } from 'react'
import {
  FormRenderer,
  FormSpy,
  type FormTemplateRenderProps,
  useFormApi,
} from '../vendor/data-driven-forms'
import { simpleComponentMapper } from '../constants/component-mappers'

/**
 * THE naming step in front of Create (AGL-700), shared by every console list
 * surface that creates a record.
 *
 * ## Why it lives in a library
 *
 * It began in `apps/console`, which put it out of reach of the console pages
 * that plugins ship — a plugin's console card cannot import from the app that
 * renders it. So a plugin adding a create button had two options, both bad:
 * an inline form stacked above its table, or a second drawer that looks
 * almost but not quite like this one. Both are how a console comes to have
 * three ways of creating a record.
 *
 * The console keeps a thin wrapper at its old path so its four existing call
 * sites are untouched; it passes its own auth form template through
 * {@link CreateArtifactDrawerProps.FormTemplate}.
 *
 * A drawer rather than a dialog on purpose: creating is a drawer, picking is
 * a dialog (AGL-699). Editing is neither — it is the record's own page.
 */
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
  errorSlot?: ReactNode
  /**
   * Whether to offer the shared Description box (AGL-2498).
   *
   * True for every artifact whose document stores one. Content collections do
   * not: `/api/hosts/collections` filters `data` through a per-kind allowlist
   * of `displayName` + `slug`, so a description typed here would be dropped
   * without a word. A field the writer silently discards is worse than a field
   * that was never offered.
   */
  includeDescription?: boolean
  /**
   * The form's own chrome — the submit button and how the fields are laid out.
   *
   * Injectable because the console's version renders an auth-aware template
   * that lives in the app and depends on the console's session hook. Defaults
   * to {@link ArtifactFormTemplate}, which is the same layout without that
   * dependency.
   */
  FormTemplate?: any
  /** Label on the submit button. */
  submitLabel?: string
}

/**
 * The default chrome: the fields in a grid and one submit button.
 *
 * No Cancel button of its own — the drawer's app bar already carries one, and
 * a second Cancel inside the form is the shape a reader has to think about.
 */
export const ArtifactFormTemplate = forwardRef<any, FormTemplateRenderProps>(
  (props, ref) => {
    const { formFields, schema, ...rest } = props
    const { handleSubmit } = useFormApi()
    return (
      <form ref={ref} onSubmit={handleSubmit} noValidate {...rest}>
        {schema.title}
        <Grid spacing={2} container>
          {formFields as any}
        </Grid>
        <FormSpy>
          {({ submitting }) => (
            <Box sx={{ mt: 2 }}>
              <FormControl margin="normal" fullWidth>
                <Button
                  color="primary"
                  disabled={submitting}
                  type="submit"
                  variant="contained"
                  fullWidth
                >
                  {(schema as { submitLabel?: string }).submitLabel ?? 'Next'}
                </Button>
              </FormControl>
            </Box>
          )}
        </FormSpy>
      </form>
    )
  },
)
ArtifactFormTemplate.displayName = 'ArtifactFormTemplate'
;(ArtifactFormTemplate as any).aglyn = true

export function CreateArtifactDrawer(props: CreateArtifactDrawerProps) {
  const {
    open,
    onClose,
    title,
    onSubmit,
    extraFields,
    errorSlot,
    includeDescription = true,
    FormTemplate = ArtifactFormTemplate,
    submitLabel,
  } = props
  const schema = {
    fields: [
      ...(includeDescription
        ? BASE_FIELDS
        : BASE_FIELDS.filter((field) => field.name !== 'description')),
      ...(extraFields ?? []),
    ],
    ...(submitLabel ? { submitLabel } : {}),
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
          FormTemplate={FormTemplate}
          componentMapper={simpleComponentMapper}
          onSubmit={onSubmit}
          schema={schema}
          subscription={{ values: true }}
          clearOnUnmount
        />
        {errorSlot}
      </Container>
    </NavigationDrawerComponent>
  )
}

/**
 * Same shape and limits the layouts drawer has used since AGL-473, so the
 * creates across the console validate identically.
 */
export const BASE_FIELDS = [
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
