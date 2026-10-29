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

import { FormControlLabel, Stack, Switch, Typography } from '@mui/material'

/**
 * "Start in preview" (AGL-4086): the choice every way of creating a site
 * offers — the plain Create site dialog, the starter, Start with AI and Bring
 * my site — of whether only the site's team can see it once it exists.
 *
 * Says what each answer means, so the default the start picked (on for a site
 * brought in, off otherwise) is a decision the person can read, not one made
 * for them.
 */
export function StartInPreviewSwitch(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const { checked, onChange, disabled } = props
  return (
    <Stack spacing={0.25}>
      <FormControlLabel
        control={
          <Switch
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
        }
        label="Start in preview"
      />
      <Typography variant="caption" color="text.secondary">
        {checked
          ? 'Only you and your team can see the site until you make it public ' +
            'in Admin → Error pages. Visitors see "Coming soon".'
          : 'Visitors can see the site as soon as it has a page.'}
      </Typography>
    </Stack>
  )
}
StartInPreviewSwitch.displayName = 'StartInPreviewSwitch'

export default StartInPreviewSwitch
