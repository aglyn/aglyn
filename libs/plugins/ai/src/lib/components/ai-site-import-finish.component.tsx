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

import { HelpTip } from '@aglyn/shared-ui-jsx'
import {
  Card,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useId, type ComponentProps } from 'react'
import { aiSiteImportFinishOf, type AiSiteImportFinish } from '../model/ai-site-import'
import { AI_SITE_IMPORT_FINISH_COPY, type AiSiteImportFinishField } from '../model/ai-site-import-view'

export interface AiSiteImportFinishProps {
  value: AiSiteImportFinishField
  onChange: (value: AiSiteImportFinishField) => void
  /** What Also improve my wording adds, in credits: a main page's before the site is read, the wave's after. */
  wordingCredits: string
  /** The guide's section on the choice, beside the question. */
  help?: ComponentProps<typeof HelpTip>
  disabled?: boolean
}

/**
 * "How should your new site look?" (AGL-4152): Keep my site, a light polish
 * with every word kept, or Improve it, with its Also improve my wording
 * switch. Bring my site asks it at the read, and an import's page asks it
 * again before each wave; both draw this one field.
 *
 * The switch sits outside the radio group, so the group holds its two radios
 * and nothing else, and it shows only under Improve it.
 */
export function AiSiteImportFinish({ value, onChange, wordingCredits, help, disabled }: AiSiteImportFinishProps) {
  const id = useId()
  const labelId = `${id}-label`
  const wordingId = `${id}-wording`
  const copy = AI_SITE_IMPORT_FINISH_COPY

  const option = (finish: AiSiteImportFinish) => {
    const text = copy[finish]
    const chosen = value.finish === finish
    return (
      <Card variant="outlined" sx={{ borderRadius: 2, borderColor: chosen ? 'primary.main' : 'divider' }}>
        <FormControlLabel
          value={finish}
          control={<Radio />}
          label={
            <Stack spacing={0.25} component="span" sx={{ py: 1, pr: 2 }}>
              <Typography variant="subtitle2" component="span">
                {text.label}
              </Typography>
              <Typography variant="body2" color="text.secondary" component="span">
                {text.description}
              </Typography>
            </Stack>
          }
          sx={{ alignItems: 'flex-start', m: 0, width: '100%', '& .MuiRadio-root': { mt: 0.5 } }}
        />
      </Card>
    )
  }

  return (
    <FormControl disabled={disabled} sx={{ m: 0 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 1 }}>
        <FormLabel
          id={labelId}
          sx={{ typography: 'subtitle1', color: 'text.primary', '&.Mui-focused': { color: 'text.primary' } }}
        >
          {copy.heading}
        </FormLabel>
        {help ? <HelpTip {...help} /> : null}
      </Stack>
      <RadioGroup
        aria-labelledby={labelId}
        value={value.finish}
        onChange={(event) => onChange({ ...value, finish: aiSiteImportFinishOf(event.target.value) })}
      >
        <Stack spacing={1}>
          {option('keep')}
          {option('improve')}
        </Stack>
      </RadioGroup>
      {value.finish === 'improve' ? (
        <Stack spacing={0.5} sx={{ mt: 1.5, pl: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={value.wording}
                onChange={(event) => onChange({ ...value, wording: event.target.checked })}
                slotProps={{ input: { 'aria-describedby': wordingId } }}
              />
            }
            label={copy.wording.label}
          />
          <Stack id={wordingId} spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {copy.wording.description}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {wordingCredits}
            </Typography>
          </Stack>
        </Stack>
      ) : null}
      <FormHelperText sx={{ mx: 0, mt: 1 }}>{copy.helper}</FormHelperText>
    </FormControl>
  )
}

export default AiSiteImportFinish
