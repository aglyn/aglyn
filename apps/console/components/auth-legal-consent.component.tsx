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

import {
  Checkbox,
  FormControlLabel,
  FormHelperText,
  Link,
  Typography,
} from '@mui/material'
import { LEGAL_URLS } from '../constants/shared'

/**
 * The Terms/Privacy links. These are canonical documents on the marketing
 * domain, so they are external full-navigation anchors opened in a new tab —
 * intentionally MUI Link (not AppLink) so the user's in-progress auth flow is
 * preserved in this tab.
 */
function LegalLinks() {
  return (
    <>
      <Link
        href={LEGAL_URLS.TERMS}
        target="_blank"
        rel="noopener noreferrer"
        underline="always"
      >
        {'Terms of Service'}
      </Link>
      {' and '}
      <Link
        href={LEGAL_URLS.PRIVACY}
        target="_blank"
        rel="noopener noreferrer"
        underline="always"
      >
        {'Privacy Policy'}
      </Link>
    </>
  )
}

/**
 * Passive legal notice for the sign-in page. Existing users already have an
 * account/contract, so sign-in surfaces a notice rather than a required
 * checkbox.
 */
export function AuthLegalNotice() {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ display: 'block', mt: 2, textAlign: 'center' }}
    >
      {'By continuing, you agree to Aglyn’s '}
      <LegalLinks />
      {'.'}
    </Typography>
  )
}

export interface AuthConsentCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** When true, render the required-consent validation message. */
  error?: boolean
}

/**
 * Required consent checkbox for the sign-up page. Account creation is contract
 * formation, so consent is captured affirmatively (clickwrap) and gates both
 * the email/password and Google sign-up flows in the page handler.
 */
export function AuthConsentCheckbox({
  checked,
  onChange,
  error,
}: AuthConsentCheckboxProps) {
  return (
    <>
      <FormControlLabel
        sx={{ alignItems: 'flex-start', mt: 1, mr: 0 }}
        control={
          <Checkbox
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            size="small"
            color={error ? 'error' : 'primary'}
            sx={{ pt: 0 }}
            slotProps={{
              input: {
                'aria-label':
                  'Agree to the Terms of Service and Privacy Policy',
              },
            }}
          />
        }
        label={
          <Typography variant="body2" sx={{ mt: 0.25 }}>
            {'I agree to Aglyn’s '}
            <LegalLinks />
            {'.'}
          </Typography>
        }
      />
      {error ? (
        <FormHelperText error sx={{ mx: 0 }}>
          {'Please accept the Terms of Service and Privacy Policy to continue.'}
        </FormHelperText>
      ) : null}
    </>
  )
}

AuthConsentCheckbox.displayName = 'AuthConsentCheckbox'
AuthLegalNotice.displayName = 'AuthLegalNotice'
