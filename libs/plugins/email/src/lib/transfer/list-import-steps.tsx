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
 * THE LIST IMPORT'S OWN WIZARD STEPS (AGL-3529), drawn inside the console's
 * import wizard (`registerPluginTransferResourceUi`, in `plugin.ts`).
 *
 * - "People already on this list", after Matching: whether the file may
 *   change the contact details of people the workspace already holds. The
 *   default is no — somebody already on the list is left exactly as they
 *   are — so this step is complete before anybody touches it.
 * - "Permission", after Conflicts: the statement of permission, under what
 *   the dry run found in the file. The evidence comes first and the act
 *   last, on purpose: an act offered above its own evidence is an act taken
 *   without it. The step is not complete until the operator has answered
 *   either way, and the answer is enforced by the server, which records who
 *   gave it — the browser only says which way they answered.
 *
 * Each answer rides in the wizard's `extras` under the step's id.
 */

import type { TransferWizardStepProps } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import {
  listIdOfResourceKey,
  type ListImportScreeningReport,
  readListConsentAnswer,
  readListExistingAnswer,
  LIST_CONSENT_STEP_ID,
  LIST_EXISTING_STEP_ID,
} from './email-transfer-catalog'

/** "People already on this list": leave them, or update their contact details. */
export function ListExistingStep(props: TransferWizardStepProps) {
  const { value, setValue, setComplete } = props
  const answer = readListExistingAnswer({ [LIST_EXISTING_STEP_ID]: value })
  useEffect(() => {
    // The default is an answer: nobody already held is changed.
    if (value === undefined || value === null) setValue({ updateContacts: false })
    setComplete(true)
  }, [value, setValue, setComplete])
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {'Somebody already on this list stays on it exactly as they are: the ' +
          'import never re-adds them or rewrites their membership. What the ' +
          'file can change is the contact record of people the workspace ' +
          'already holds — their name, phone, company and title.'}
      </Typography>
      <FormControl>
        <RadioGroup
          value={answer.updateContacts ? 'update' : 'leave'}
          onChange={(event) =>
            setValue({ updateContacts: event.target.value === 'update' })
          }
        >
          <FormControlLabel
            value="leave"
            control={<Radio />}
            label={
              'Leave them as they are. The file’s contact details fill in ' +
              'only a contact the import creates.'
            }
          />
          <FormControlLabel
            value="update"
            control={<Radio />}
            label={
              'Update their contact details from the file, under the field ' +
              'choices on the Conflicts step. A blank cell never empties one.'
            }
          />
        </RadioGroup>
      </FormControl>
    </Stack>
  )
}
ListExistingStep.displayName = 'ListExistingStep'

/** What the screening route answers. */
interface ScreeningAnswer {
  listName: string
  screening: ListImportScreeningReport | null
}

/** "Permission": what the file holds, then the statement. */
export function ListConsentStep(props: TransferWizardStepProps) {
  const { resource, hostId, jobId, value, setValue, setComplete } = props
  const listId = listIdOfResourceKey(resource)
  const { data: user } = useUser()
  const answer = readListConsentAnswer({ [LIST_CONSENT_STEP_ID]: value })
  const answered = answer === null ? null : answer.attest
  const [found, setFound] = useState<ScreeningAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setComplete(answered !== null)
  }, [answered, setComplete])

  useEffect(() => {
    if (!user || !hostId || !listId || !jobId) return undefined
    let live = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          '/api/email/list-import-screening',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostId, listId, jobId }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!live) return
        if (!response.ok) setError(payload?.error ?? 'What the file holds could not be read.')
        else setFound(payload as ScreeningAnswer)
      } catch {
        if (live) setError('What the file holds could not be read.')
      }
    })()
    return () => {
      live = false
    }
  }, [user, hostId, listId, jobId])

  const screening = found?.screening ?? null
  const sample = screening?.sample
  return (
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {screening?.purchaseTellColumns.length ? (
        <Alert severity="warning">
          <AlertTitle>{'This file looks bought or appended'}</AlertTitle>
          {`Its columns include ${screening.purchaseTellColumns.join(', ')}. ` +
            'Purchased, rented and appended lists are not allowed, and ' +
            'importing one puts every site sending through this domain at ' +
            'risk. If the column name is a coincidence, carry on.'}
        </Alert>
      ) : null}
      {screening?.roleAccounts ? (
        <Alert severity="warning">
          <AlertTitle>{`${screening.roleAccounts} shared mailboxes`}</AlertTitle>
          {`Addresses like ${screening.roleAccountSamples.slice(0, 3).join(', ')} ` +
            'reach a mailbox several people read, or nobody. They are a ' +
            'common sign of a list built by collecting addresses rather than ' +
            'by people signing up. They are added if you go ahead.'}
        </Alert>
      ) : null}
      {sample && sample.size ? (
        <Alert severity={sample.needAttestation ? 'warning' : 'success'}>
          <AlertTitle>
            {sample.size < sample.of
              ? `Checked the first ${sample.size} of ${sample.of} new addresses`
              : `Checked all ${sample.size} new addresses`}
          </AlertTitle>
          {`${sample.optedIn} already have an opt-in on record, ` +
            `${sample.needAttestation} have no opt-in on record, and ` +
            `${sample.refused} cannot be added at all. ` +
            (sample.size < sample.of
              ? 'The rest are checked the same way as they are added.'
              : '')}
        </Alert>
      ) : !error ? (
        <Typography variant="body2" color="text.secondary">
          {found
            ? 'Nobody new is added by this file.'
            : 'Reading what the file holds…'}
        </Typography>
      ) : null}
      <FormControl>
        <RadioGroup
          value={answered === null ? '' : answered ? 'attest' : 'only'}
          onChange={(event) => setValue({ attest: event.target.value === 'attest' })}
        >
          <FormControlLabel
            value="attest"
            control={<Radio />}
            label={
              <Typography variant="body2">
                {'I have these people’s permission to send them marketing ' +
                  'email, and I can produce the record of it if asked. This ' +
                  'statement is stored against my account, with today’s ' +
                  'date, on every address it admits.'}
                {screening?.declaresBasis
                  ? ' The opt-in source and date your file declares are kept with it.'
                  : ''}
              </Typography>
            }
          />
          <FormControlLabel
            value="only"
            control={<Radio />}
            label={
              <Typography variant="body2">
                {'Only add the people who already have an opt-in on record. ' +
                  'Nobody else is added, and nothing is deleted.'}
              </Typography>
            }
          />
        </RadioGroup>
      </FormControl>
      <Typography variant="body2" color="text.secondary">
        {'Whichever you choose, people who unsubscribed, bounced, marked a ' +
          'message as spam or said no are never added, and an import never ' +
          'sends a confirmation email.'}
      </Typography>
    </Stack>
  )
}
ListConsentStep.displayName = 'ListConsentStep'
