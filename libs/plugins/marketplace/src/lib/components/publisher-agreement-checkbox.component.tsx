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
  Alert,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useId, useMemo, useState } from 'react'
import {
  PUBLISHER_AGREEMENT_TITLE,
  publisherAgreementConsent,
  publisherAgreementConsentPresentation,
  type PublisherAgreementConsent,
} from '../model/publisher-agreement'

export interface PublisherAgreementCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Held still while the save it belongs to is running. */
  disabled?: boolean
  /** Why the last save was refused for the box, when it was. */
  error?: string | null
}

/**
 * "I agree to the Marketplace Publisher Agreement" (AGL-4105): the box every
 * publisher save carries, directly above its button.
 *
 * Unticked until the person ticks it, and unticked again after each save, so
 * each save is its own agreement; the button it sits above stays disabled
 * until it is ticked. The agreement's title is the link to the document, read
 * from `publisherAgreementConsentPresentation` and never from the URL
 * constant: while the document has no published page there is no link, the
 * box cannot be ticked, and the reason is said in its place (AGL-1660).
 *
 * One component for every publisher form and dialog in the console, the
 * publish dialog drawn through the `hostArtifactPublish` zone included, so
 * the sentence and the link never differ between them.
 */
export function PublisherAgreementCheckbox(props: PublisherAgreementCheckboxProps) {
  const { checked, onChange, disabled = false, error } = props
  const errorId = useId()
  const presentation = publisherAgreementConsentPresentation()
  if (!presentation.canAgree) {
    return <Alert severity="warning">{presentation.unavailableNotice}</Alert>
  }
  return (
    <Stack spacing={0.5}>
      <FormControlLabel
        disableTypography
        disabled={disabled}
        sx={{ alignItems: 'flex-start', mr: 0 }}
        control={
          <Checkbox
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            size="small"
            color="primary"
            sx={[
              { mt: -0.75 },
              Boolean(error) && !checked && { color: 'error.main' },
            ]}
            slotProps={{
              input: {
                'aria-label': `Agree to the ${PUBLISHER_AGREEMENT_TITLE}`,
                ...(error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {}),
              },
            }}
          />
        }
        label={
          <Typography component="span" variant="body2">
            {'I agree to the '}
            <Link
              href={presentation.documentUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              underline="always"
            >
              {PUBLISHER_AGREEMENT_TITLE}
            </Link>
          </Typography>
        }
      />
      {error ? (
        <FormHelperText id={errorId} error sx={{ m: 0 }}>
          {error}
        </FormHelperText>
      ) : null}
    </Stack>
  )
}

PublisherAgreementCheckbox.displayName = 'PublisherAgreementCheckbox'

/** One save form's box: its state, what the save sends, and the reset after it. */
export interface PublisherAgreementConsentState {
  agreed: boolean
  setAgreed: (agreed: boolean) => void
  /** The `agreement` the save sends: present only while the box is ticked. */
  consent: PublisherAgreementConsent | undefined
  /** Unticks the box. Called after every save, so the next save asks again. */
  reset: () => void
}

/** The state behind one {@link PublisherAgreementCheckbox}, unticked to start. */
export function usePublisherAgreementConsent(): PublisherAgreementConsentState {
  const [agreed, setAgreed] = useState(false)
  const reset = useCallback(() => setAgreed(false), [])
  return useMemo(
    () => ({
      agreed,
      setAgreed,
      consent: agreed ? publisherAgreementConsent() : undefined,
      reset,
    }),
    [agreed, reset],
  )
}

export default PublisherAgreementCheckbox
