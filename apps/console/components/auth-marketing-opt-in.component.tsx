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

import { PLATFORM_MARKETING_CONSENT_TEXT } from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import { Checkbox, FormControlLabel, Typography } from '@mui/material'

export interface AuthMarketingOptInProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

/**
 * The optional product-updates checkbox on the sign-up page (AGL-3185).
 *
 * A sibling of `AuthConsentCheckbox`, and deliberately not part of it: the
 * terms acceptance is required and gates the sign-up, this is optional and
 * gates nothing. It is never pre-ticked, never required, and never bundled
 * into the terms sentence — an opt-in that a person could not decline on its
 * own is not an opt-in. The label is the versioned consent wording, so what
 * the record says they agreed to is what this rendered.
 */
export function AuthMarketingOptIn({ checked, onChange }: AuthMarketingOptInProps) {
  return (
    <FormControlLabel
      sx={{ alignItems: 'flex-start', mt: 1, mr: 0 }}
      control={
        <Checkbox
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          size="small"
          color="primary"
          sx={{ pt: 0 }}
          slotProps={{
            input: { 'aria-label': 'Send me product updates' },
          }}
        />
      }
      label={
        <Typography variant="body2" sx={{ mt: 0.25 }}>
          {PLATFORM_MARKETING_CONSENT_TEXT}
        </Typography>
      }
    />
  )
}

AuthMarketingOptIn.displayName = 'AuthMarketingOptIn'
