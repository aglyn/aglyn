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

/**
 * THE CONTACT IMPORT'S PERMISSION STEP (AGL-4245), drawn inside the console's
 * import wizard after Conflicts (`ui.ts`).
 *
 * A store's customer file records who agreed to marketing email. This is the
 * statement that carries those opt-ins: the default is no, so nobody is opted
 * in unless the person importing says these people agreed to hear from this
 * business. The step is complete with the default, because most contact files
 * hold no such column; the dry run then counts the opt-ins left out and says
 * where to bring them in.
 *
 * The answer rides in the wizard's `extras` under the step's id. The server
 * records who gave it from the dry run's own request, never from here.
 */

import type { TransferWizardStepProps } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { FormControl, FormControlLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material'
import { useEffect } from 'react'
import { CONTACT_CONSENT_STEP_ID, readContactConsentAnswer } from './customer-sources'

/** "Permission": whether the file's opt-ins come in. */
export function ContactConsentStep(props: TransferWizardStepProps) {
  const { value, setValue, setComplete } = props
  const { attest } = readContactConsentAnswer({ [CONTACT_CONSENT_STEP_ID]: value })
  useEffect(() => {
    // The default is an answer: nobody is opted in from the file.
    if (value === undefined || value === null) setValue({ attest: false })
    setComplete(true)
  }, [value, setValue, setComplete])
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {'A customer file from Shopify, Wix or Squarespace says who agreed to ' +
          'get marketing email from your store. Choose whether those opt-ins ' +
          'come in. A file without that column is not affected.'}
      </Typography>
      <FormControl>
        <RadioGroup
          value={attest ? 'attest' : 'none'}
          onChange={(event) => setValue({ attest: event.target.value === 'attest' })}
        >
          <FormControlLabel
            value="none"
            control={<Radio />}
            label={
              <Typography variant="body2">
                {'Don’t opt anyone in from this file. People can still sign up ' +
                  'on your site’s forms.'}
              </Typography>
            }
          />
          <FormControlLabel
            value="attest"
            control={<Radio />}
            label={
              <Typography variant="body2">
                {'The people this file says yes for agreed to hear from my ' +
                  'business, and I can show how if asked. Opt them in. This ' +
                  'statement is saved with my name, the date and the file it ' +
                  'came from on each person it opts in.'}
              </Typography>
            }
          />
        </RadioGroup>
      </FormControl>
      <Typography variant="body2" color="text.secondary">
        {'Whichever you choose, an unsubscribe in the file is always kept, ' +
          'and nobody who unsubscribed here is opted back in. Text message ' +
          'choices are not brought in. The dry run shows how many people each ' +
          'of these applies to.'}
      </Typography>
    </Stack>
  )
}
ContactConsentStep.displayName = 'ContactConsentStep'
