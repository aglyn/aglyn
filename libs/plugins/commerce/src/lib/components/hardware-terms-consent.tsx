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

import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { POS_HARDWARE_TERMS_SECTIONS, posHardwareTermsUrl } from '../model/pos-hardware-terms'

/** The two answers a checkout of card reader hardware carries (AGL-4038). */
export interface HardwareTermsAnswer {
  accepted: boolean
  businessUse: boolean
}

export const NO_HARDWARE_TERMS_ANSWER: HardwareTermsAnswer = { accepted: false, businessUse: false }

/** Whether both boxes are ticked, so the checkout will be taken. */
export function hardwareTermsAnswered(answer: HardwareTermsAnswer): boolean {
  return answer.accepted && answer.businessUse
}

/**
 * THE TERMS OF SALE AT AN ONLINE CHECKOUT OF CARD READER HARDWARE (AGL-4038).
 *
 * Shown in the cart, and on a product page after its checkout asked for it,
 * when the store selling is the platform's own and the order holds a card
 * reader or an accessory: the buyer accepts the terms of sale (Terms,
 * Sections 4.26–4.32, linked) and confirms they are buying for use in their
 * business. The server refuses the checkout without both; these boxes are
 * how the buyer gives them.
 */
export function HardwareTermsConsent(props: {
  answer: HardwareTermsAnswer
  onChange: (answer: HardwareTermsAnswer) => void
}) {
  const { answer, onChange } = props
  return (
    <Stack data-testid="hardware-terms-consent">
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={answer.accepted}
            onChange={(event) => onChange({ ...answer, accepted: event.target.checked })}
          />
        }
        label={
          <Typography variant="body2">
            {'I accept the '}
            <Link href={posHardwareTermsUrl()} target="_blank" rel="noopener noreferrer">
              {`hardware terms of sale (Terms, Sections ${POS_HARDWARE_TERMS_SECTIONS})`}
            </Link>
            {'.'}
          </Typography>
        }
      />
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={answer.businessUse}
            onChange={(event) => onChange({ ...answer, businessUse: event.target.checked })}
          />
        }
        label={<Typography variant="body2">{'I am buying this hardware for use in my business.'}</Typography>}
      />
    </Stack>
  )
}
