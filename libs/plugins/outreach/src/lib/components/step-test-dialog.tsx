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

import { crmMergeUnresolvedMessage } from '@aglyn/aglyn/app-utils/crm-email-templates'
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { isInThreadEmailStep } from '../engine/sequence-validation'
import type { OutreachStepTestResponse } from '../model/outreach-api'
import { OUTREACH_PERSONAL_LINE_MAX, type OutreachSequence } from '../model/outreach.types'
import { OUTREACH_SAMPLE_PERSON } from '../model/step-preview'
import type { OutreachApi } from './use-outreach-api'
import {
  type OutreachContactOption,
  useOutreachContactSearch,
  useOutreachLeadSearch,
} from './use-outreach-crm'

/** Whose record fills the tokens: the sample person, or an open lead or contact. */
interface PersonChoice extends OutreachContactOption {
  kind: 'sample' | 'lead' | 'contact'
}

const SAMPLE: PersonChoice = {
  kind: 'sample',
  id: '',
  name: `${OUTREACH_SAMPLE_PERSON.name} (sample)`,
  email: OUTREACH_SAMPLE_PERSON.email,
}

const GROUP_LABELS: Record<PersonChoice['kind'], string> = {
  sample: 'Sample',
  lead: 'Leads',
  contact: 'Contacts',
}

type Outcome =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; answer: OutreachStepTestResponse & { unresolvedFields?: string[] } }
  | { status: 'failed'; message: string }

export interface OutreachStepTestDialogProps {
  open: boolean
  onClose(): void
  orgId: string
  /** The stored sequence: the test is sent from what is saved. */
  sequence: OutreachSequence
  stepIndex: number
  /** The consent group of the sequence's site: whose names a contact search shows. */
  contactGroupId: string
  /** The member's own address, where the test goes unless they type another. */
  selfEmail: string | null
  /** True while the editor holds edits the stored sequence does not. */
  unsaved: boolean
  api: OutreachApi
}

/**
 * Send a test of one step (AGL-3325): the step as the sequence stores it,
 * rendered for a chosen person — the sample person the preview uses, or an
 * open lead or contact of the sequence's site — with the personal line the
 * member types, sent through the sequence's mailbox to the member's own
 * address or one they name. The route prefixes the subject with `[Test]`,
 * counts it on nothing but the mailbox's test tally, and never enrolls the
 * person whose record filled the tokens.
 */
export function OutreachStepTestDialog(props: OutreachStepTestDialogProps) {
  const { open, orgId, sequence, stepIndex, api } = props
  const [person, setPerson] = useState<PersonChoice>(SAMPLE)
  const [text, setText] = useState('')
  const [personalLine, setPersonalLine] = useState<string>(OUTREACH_SAMPLE_PERSON.personalLine)
  const [to, setTo] = useState('')
  const [outcome, setOutcome] = useState<Outcome>({ status: 'idle' })

  // A fresh dialog for each step: the last test's answer belongs to it.
  useEffect(() => {
    if (open) setOutcome({ status: 'idle' })
  }, [open, stepIndex])

  const leads = useOutreachLeadSearch({
    orgId,
    hostId: sequence.hostId,
    text,
    enabled: open,
  })
  const contacts = useOutreachContactSearch({
    orgId: open ? orgId : null,
    hostId: sequence.hostId,
    contactGroupId: props.contactGroupId,
    text,
  })
  const options: PersonChoice[] = [
    SAMPLE,
    ...leads.data.map((lead) => ({ ...lead, kind: 'lead' as const })),
    ...contacts.data.map((contact) => ({ ...contact, kind: 'contact' as const })),
  ]
  const choose = (next: PersonChoice | null) => {
    const chosen = next ?? SAMPLE
    setPerson(chosen)
    // The sample person comes with a line; a real person waits for one.
    setPersonalLine(chosen.kind === 'sample' ? OUTREACH_SAMPLE_PERSON.personalLine : '')
  }

  const step = sequence.steps[stepIndex]
  const inThread = isInThreadEmailStep(sequence.steps, stepIndex)
  const line = personalLine.trim()
  const tooLong = line.length > OUTREACH_PERSONAL_LINE_MAX
  const sending = outcome.status === 'sending'

  const send = async () => {
    setOutcome({ status: 'sending' })
    try {
      const answer = await api.sendStepTest({
        sequenceId: sequence.id,
        stepIndex,
        ...(person.kind === 'lead'
          ? { leadId: person.id }
          : person.kind === 'contact'
            ? { contactId: person.id }
            : {}),
        personalLine: line,
        ...(to.trim() ? { to: to.trim() } : {}),
      })
      setOutcome({ status: 'sent', answer })
    } catch (error) {
      setOutcome({ status: 'failed', message: (error as Error).message })
    }
  }

  const title = `Send a test of step ${stepIndex + 1}`
  return (
    <Dialog open={open} onClose={sending ? undefined : props.onClose} fullWidth maxWidth="sm" aria-label={title}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {`The email goes through ${sequence.name}’s mailbox, exactly as a recipient would get it — the footer, the links, ` +
              (inThread ? 'the “Re:” subject of a reply — ' : '') +
              'with “[Test]” in front of the subject. It counts toward nothing, and nobody is enrolled.'}
          </Typography>
          {props.unsaved ? (
            <Alert severity="info">You have unsaved changes. The test sends the step as it was last saved.</Alert>
          ) : null}
          {step?.kind !== 'email' ? (
            <Alert severity="warning">This step does not send an email.</Alert>
          ) : null}
          <Autocomplete<PersonChoice, false, true>
            options={options}
            value={person}
            disableClearable
            inputValue={text}
            onInputChange={(_event, next, reason) => {
              if (reason === 'input') setText(next)
              else if (reason === 'clear') setText('')
            }}
            onChange={(_event, next) => choose(next)}
            // The search is the CRM's own; nothing is filtered again here.
            filterOptions={(list) => list}
            groupBy={(option) => GROUP_LABELS[option.kind]}
            getOptionLabel={(option) => option.name || option.email || option.id}
            isOptionEqualToValue={(option, value) => option.kind === value.kind && option.id === value.id}
            loading={leads.status === 'loading' || contacts.status === 'loading'}
            disabled={sending}
            renderOption={(itemProps, option) => (
              <li {...itemProps} key={`${option.kind}:${option.id}`}>
                <Stack>
                  <Typography variant="body2">{option.name || option.email || option.id}</Typography>
                  {option.email && option.email !== option.name ? (
                    <Typography variant="caption" color="text.secondary">
                      {option.email}
                    </Typography>
                  ) : null}
                </Stack>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Fill the tokens from"
                helperText="A sample person, or type a name or address to pick an open lead or contact of this sequence’s site. Their record fills the merge fields; the test still goes to you."
              />
            )}
          />
          <TextField
            label="Personal line"
            placeholder="One sentence on why you're writing to this person now."
            value={personalLine}
            onChange={(event) => setPersonalLine(event.target.value)}
            disabled={sending}
            error={tooLong}
            helperText={
              tooLong
                ? `Keep it to one sentence, under ${OUTREACH_PERSONAL_LINE_MAX} characters.`
                : 'Goes where the emails say {{enrollment.personalLine}}.'
            }
            fullWidth
            size="small"
          />
          <TextField
            label="Send to"
            type="email"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            disabled={sending}
            helperText={
              props.selfEmail
                ? `Leave empty to send it to yourself (${props.selfEmail}).`
                : 'Leave empty to send it to your own address.'
            }
            fullWidth
            size="small"
          />
          {outcome.status === 'failed' ? <Alert severity="error">{outcome.message}</Alert> : null}
          {outcome.status === 'sent' ? (
            <Alert severity="success">
              {`Sent to ${outcome.answer.sentTo} as “${outcome.answer.subject}”. Check that inbox.`}
              {outcome.answer.unresolvedFields?.length
                ? ` ${crmMergeUnresolvedMessage(outcome.answer.unresolvedFields)}; they were sent empty.`
                : ''}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={sending}>
          {outcome.status === 'sent' ? 'Done' : 'Cancel'}
        </Button>
        <Button
          variant="contained"
          onClick={() => void send()}
          disabled={sending || tooLong || step?.kind !== 'email'}
        >
          {sending ? 'Sending…' : outcome.status === 'sent' ? 'Send again' : 'Send the test'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
OutreachStepTestDialog.displayName = 'OutreachStepTestDialog'

export default OutreachStepTestDialog
