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
  FormRenderer,
  GridFormTemplateComponent,
  simpleComponentMapper,
} from '@aglyn/shared-ui-jsx-forms'
import { Alert, Button, IconButton, Typography } from '@mui/material'

export interface CampaignCreateDrawerProps {
  open: boolean
  onClose: () => void
  /** The org's email lists, offered as the campaign's audience. */
  lists: Array<{ $id: string; name?: string }>
  /** Receives the collected values; closing is the caller's job. */
  onSubmit: (values: Record<string, any>) => void | Promise<void>
  /** Rendered under the form when a submit is refused. */
  error?: string | null
}

/**
 * NAMING A CAMPAIGN, before there is anything in it.
 *
 * The same shape every other create in the console has — a right-hand drawer
 * carrying a data-driven form, `Cancel` in the app bar and in the template —
 * built from the two shared primitives that make one rather than from the
 * console's own `CreateArtifactDrawer` wrapper. That wrapper lives in
 * `apps/console`, and a plugin is a library: the dependency would run from a
 * lib to an app, which is the one direction the module boundaries do not
 * have. So the drawer chrome and the form renderer are shared; the wrapper
 * is not, and cannot be.
 *
 * A drawer rather than a dialog, matching the rule the artifact creates
 * follow: creating is a drawer, picking is a dialog.
 */
export function CampaignCreateDrawer(props: CampaignCreateDrawerProps) {
  const { open, onClose, lists, onSubmit, error } = props
  const schema = {
    fields: [
      {
        component: 'text-field',
        name: 'name',
        label: 'Campaign name',
        helperText: 'What this campaign is for — “Spring sale”, “Welcome”',
        isRequired: true,
        validate: [
          { type: 'required', message: 'Name the campaign' },
          {
            type: 'max-length',
            threshold: 60,
            message: 'Must not exceed 60 characters',
          },
        ],
      },
      {
        component: 'text-field',
        name: 'startAt',
        label: 'Starts',
        type: 'date',
        helperText: 'When the campaign window opens',
        // The label would otherwise sit on top of the browser's own date
        // placeholder, which a date input paints whether or not it is focused.
        InputLabelProps: { shrink: true },
      },
      {
        component: 'text-field',
        name: 'endAt',
        label: 'Ends',
        type: 'date',
        helperText: 'Leave empty for an open-ended campaign',
        InputLabelProps: { shrink: true },
      },
      {
        component: 'select',
        name: 'listIds',
        label: 'Lists',
        multiple: true,
        initialValue: [],
        // A campaign with no list is legitimate: its emails can go to leads,
        // to site members, or to a segment. The lists are what it is AIMED at.
        helperText: 'The lists this campaign is aimed at',
        disableDefaultOption: true,
        options: lists.map((list) => ({
          value: list.$id,
          label: list.name || list.$id,
        })),
      },
    ],
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
            {'Create campaign'}
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
          FormTemplate={GridFormTemplateComponent}
          componentMapper={simpleComponentMapper}
          onSubmit={onSubmit}
          onCancel={onClose}
          schema={schema}
          subscription={{ values: true }}
          clearOnUnmount
        />
        {error ? (
          <Alert severity="error" sx={{ mt: 2, mb: 1 }}>
            {error}
          </Alert>
        ) : null}
      </Container>
    </NavigationDrawerComponent>
  )
}
CampaignCreateDrawer.displayName = 'CampaignCreateDrawer'

export default CampaignCreateDrawer
