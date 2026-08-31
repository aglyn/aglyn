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

import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import {
  Alert,
  Button,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type { CampaignSendApiResult } from './use-campaign-send-api'

/** One address a test may be delivered to, as the route reports it. */
interface ProofRecipient {
  email: string
  label: string
  self: boolean
}

/** One person a test may be RENDERED as. Receives nothing. */
interface ProofPersona {
  email: string
  name: string
  source: 'lead' | 'member' | 'contact'
}

const SOURCE_LABEL: Record<ProofPersona['source'], string> = {
  lead: 'Lead',
  member: 'Site user',
  contact: 'Contact',
}

export interface CampaignTestSendDrawerProps {
  open: boolean
  onClose: () => void
  /** The one authorized POST to the campaign API. */
  post: (payload: Record<string, unknown>) => Promise<CampaignSendApiResult>
  /** Everything about the message, so the test mails what is composed. */
  message: Record<string, unknown>
  /** What the composer says this send will leave as, for the summary. */
  identity: string
}

/**
 * PROOF ONE EMAIL — as somebody, to somebody, from an identity.
 *
 * ## The two pickers are different kinds of thing, and the screen says so
 *
 * The whole risk in this drawer is a person reading the persona picker as an
 * address book. Choosing a contact fills the merge tags with THEIR data and
 * mails them nothing; the only address anything is delivered to is the one in
 * the second field. Those two facts are stated next to the controls rather
 * than in help text, and the summary at the bottom restates both in one
 * sentence before the button.
 *
 * ## Why the recipient is a list and not a text box
 *
 * A test send is exempt from the marketing-consent rule, so the server only
 * accepts an address belonging to an account on this workspace. Offering a
 * free-text box would mean every other address a person could type is a
 * refusal they had no way to predict — the rule is the same either way, and a
 * picker is the honest way to show it.
 *
 * ## What a test does not do
 *
 * It writes no campaign record, moves no counter, and joins no reach record,
 * so proofing an email six times does not make its report say seven. It still
 * runs both suppression lists and still refuses an address with a recorded
 * opt-out: neither of those is relaxed for a test, because a suppressed
 * address is suppressed for a reason that has nothing to do with who is
 * asking.
 */
export function CampaignTestSendDrawer(props: CampaignTestSendDrawerProps) {
  const { open, onClose, post, message, identity } = props

  const [recipients, setRecipients] = useState<ProofRecipient[] | null>(null)
  const [personas, setPersonas] = useState<ProofPersona[]>([])
  const [to, setTo] = useState('')
  const [personaEmail, setPersonaEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')

  /*
   * ASKED ON OPEN, not on mount.
   *
   * The composer mounts on every campaign page; this drawer is opened
   * deliberately. Loading the roster and an audience sample behind the
   * composer would spend those reads for everybody who never proofs anything,
   * which is most people most of the time.
   */
  useEffect(() => {
    if (!open) return
    let active = true
    setError('')
    setSentTo('')
    void (async () => {
      const { response, payload } = await post({ action: 'proofOptions' })
      if (!active) return
      if (!response.ok) {
        setRecipients([])
        return setError(payload?.error ?? 'Could not load who a test can go to')
      }
      const list = (payload?.recipients ?? []) as ProofRecipient[]
      setRecipients(list)
      setPersonas((payload?.personas ?? []) as ProofPersona[])
      // Yourself, because that is the answer nine times in ten and it is the
      // one choice that needs no thought.
      setTo((current) => current || list.find((one) => one.self)?.email || '')
    })().catch(() => {
      if (active) setError('Could not load who a test can go to')
    })
    return () => {
      active = false
    }
  }, [open, post])

  const handleSend = useCallback(async () => {
    if (busy || !to) return
    setBusy(true)
    setError('')
    const { response, payload } = await post({
      ...message,
      action: 'test',
      to,
      ...(personaEmail ? { personaEmail } : {}),
    })
    setBusy(false)
    if (!response.ok) {
      return setError(payload?.error ?? 'The test send was refused')
    }
    setSentTo(String(payload?.to ?? to))
  }, [busy, post, message, to, personaEmail])

  const persona = personas.find((one) => one.email === personaEmail)

  return (
    <NavigationDrawerComponent
      open={open}
      anchor="right"
      variant="temporary"
      onClose={onClose}
      AppBarProps={{ color: 'surface' }}
      appBarLeft={
        <>
          <IconButton color="inherit" edge="start" onClick={onClose} sx={{ mr: 2 }}>
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>close drawer</SrOnly>
          </IconButton>
          <Typography variant="h6" component="div">
            {'Send a test'}
          </Typography>
        </>
      }
    >
      <Container gutterY>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'A test mails one copy of this email and records nothing — no ' +
              'recipient count, no report figures, and nobody is marked as ' +
              'having received it.'}
          </Typography>

          <TextField
            select
            label="Fill the merge tags with"
            value={personaEmail}
            onChange={(event) => setPersonaEmail(event.target.value)}
            size="small"
            disabled={busy}
            helperText={
              persona
                ? `The email will read as if addressed to ${
                    persona.name || persona.email
                  }. ${persona.email} is not sent anything.`
                : 'Leave this alone to see the fallbacks — {{firstName|there}} and the rest — as somebody with no stored name would.'
            }
          >
            <MenuItem value="">{'Nobody in particular'}</MenuItem>
            {personas.map((one) => (
              <MenuItem key={one.email} value={one.email}>
                {`${one.name || one.email} · ${SOURCE_LABEL[one.source]}`}
              </MenuItem>
            ))}
          </TextField>

          <Divider />

          <TextField
            select
            label="Deliver it to"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            size="small"
            disabled={busy || !recipients?.length}
            helperText={
              'The only address this test is sent to. A test can go to you or ' +
              'to someone with an account on this workspace — never to a ' +
              'contact, who has not agreed to receive it.'
            }
          >
            {(recipients ?? []).map((one) => (
              <MenuItem key={one.email} value={one.email}>
                {one.self ? `${one.email} (you)` : `${one.label} · ${one.email}`}
              </MenuItem>
            ))}
          </TextField>

          {/*
            THE SUMMARY, before the button that mails something.

            Three facts in one sentence, because the whole failure this drawer
            could produce is somebody believing the first field addresses the
            email. Restating it here means the last thing read before the
            click is the correct reading.
           */}
          <Alert severity="info">
            <Typography variant="body2">
              {to
                ? `We will send one copy to ${to}, from ${identity || 'this site’s sending address'}${
                    persona
                      ? `, written as if it were going to ${persona.name || persona.email}`
                      : ''
                  }.`
                : 'Choose an address to send the test to.'}
            </Typography>
          </Alert>

          {error ? <Alert severity="warning">{error}</Alert> : null}
          {sentTo ? (
            <Alert severity="success">{`Sent to ${sentTo}.`}</Alert>
          ) : null}

          <Button
            variant="contained"
            disabled={busy || !to}
            onClick={() => void handleSend()}
          >
            {busy ? 'Sending…' : 'Send test'}
          </Button>
        </Stack>
      </Container>
    </NavigationDrawerComponent>
  )
}
CampaignTestSendDrawer.displayName = 'CampaignTestSendDrawer'

export default CampaignTestSendDrawer
