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

import { Chip, MenuItem, Stack, TextField, Typography } from '@mui/material'

/** One campaign a resource may be put in. */
export interface CampaignPickerOption {
  value: string
  label: string
}

export interface CampaignPickerProps {
  /** The campaigns this site has, newest window first is the caller's job. */
  options: readonly CampaignPickerOption[]
  /** The campaign ids currently selected. */
  value: readonly string[]
  onChange: (next: string[]) => void
  /** Overrides the default label — a contact says "filed under", not "in". */
  label?: string
  /** Overrides the default helper line. */
  helperText?: string
  disabled?: boolean
  /**
   * The site has no campaigns at all, so the picker has nothing to offer.
   *
   * Distinct from "still loading": an empty select with no explanation reads
   * as a control that is broken, and the two states look identical.
   */
  empty?: boolean
  /** What to say in place of the picker when {@link empty}. */
  emptyText?: string
}

/**
 * WHICH CAMPAIGNS THIS RECORD IS PART OF.
 *
 * The one control behind every campaign assignment in the console — a form's
 * page, a screen's page and a contact's drawer — so that three surfaces
 * editing one stored field cannot come to present it three ways.
 *
 * ## It renders ids as NAMES and stores ids
 *
 * The chips read the label out of {@link CampaignPickerProps.options}, and an
 * id with no option left falls back to the id itself rather than
 * disappearing. A campaign that has been deleted is exactly that case, and
 * a chip that vanished would tell a merchant the assignment was gone when the
 * document still carries it.
 *
 * ## Presentational, deliberately
 *
 * It reads no campaign collection of its own. The three callers already hold
 * a site scope and their own read budget — a screen's page is in the console
 * app, which may not import a feature plugin at all — and a control that
 * opened a listener per placement is the unrequested read on mount this
 * console refuses.
 */
export function CampaignPicker(props: CampaignPickerProps) {
  const {
    options,
    value,
    onChange,
    label = 'Campaigns',
    helperText = 'The campaigns this belongs to. Clearing them all takes it out of every campaign.',
    disabled,
    empty,
    emptyText = 'This site has no campaigns yet. Create one from Marketing to file records under it.',
  } = props

  if (empty) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    )
  }

  const labels = new Map(options.map((option) => [option.value, option.label]))

  return (
    <TextField
      select
      size="small"
      label={label}
      value={value as string[]}
      disabled={disabled}
      onChange={(event) =>
        onChange(
          // A multiple select hands back an array; the change event's typing
          // does not know that.
          (event.target.value as unknown as string[]).map(String),
        )
      }
      helperText={helperText}
      fullWidth
      slotProps={{
        select: {
          multiple: true,
          displayEmpty: true,
          renderValue: (selected: unknown) => {
            const ids = (selected as string[]) ?? []
            if (!ids.length) {
              return (
                <Typography variant="body2" color="text.secondary">
                  {'No campaign'}
                </Typography>
              )
            }
            return (
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                {ids.map((id) => (
                  <Chip key={id} size="small" label={labels.get(id) ?? id} />
                ))}
              </Stack>
            )
          },
        },
      }}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  )
}
CampaignPicker.displayName = 'CampaignPicker'

export default CampaignPicker
