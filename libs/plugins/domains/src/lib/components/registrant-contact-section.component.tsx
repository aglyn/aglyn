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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import {
  DomainsRequestError,
  formatDay,
  useDomainsFetch,
  type ContactAnswer,
} from './domains-api'
import {
  badFieldsSentence,
  contactFormValue,
  RegistrantContactFields,
  type ContactFormValue,
} from './registrant-contact-fields.component'

/*
 * WHO THE DOMAIN IS REGISTERED TO (AGL-4040), on the Domains page.
 *
 * The registrar takes a contact change only with a renewal, so an edit is
 * stored and sent with the next one, and this section says so with the
 * date — it never claims the registrar has the change before then. ICANN's
 * email check is shown as last read.
 */

/** When an edited contact reaches the registrar, in a sentence. */
export function contactTakesEffectSentence(answer: Pick<ContactAnswer, 'takesEffectAtMs' | 'autoRenew' | 'expiresAtMs'>): string {
  if (answer.takesEffectAtMs) {
    return `Changes are sent to the registrar with the domain’s next renewal, around ${formatDay(answer.takesEffectAtMs)}. Until then the registrar keeps the current details.`
  }
  if (!answer.autoRenew && answer.expiresAtMs) {
    return `Changes are sent to the registrar when the domain is next renewed. Auto-renew is off, so that happens only if you renew it before ${formatDay(answer.expiresAtMs)}.`
  }
  return 'Changes are sent to the registrar when the domain is next renewed.'
}

export interface RegistrantContactSectionProps {
  orgId: string
  domain: string
  /** Editing is open once the name is registered here. */
  editable: boolean
}

export function RegistrantContactSection(props: RegistrantContactSectionProps) {
  const { orgId, domain, editable } = props
  const request = useDomainsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [answer, setAnswer] = useState<ContactAnswer | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<ContactFormValue>(contactFormValue())
  const [badFields, setBadFields] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setAnswer(await request<ContactAnswer>(DOMAINS_API_ROUTES.contact, { query: { orgId, domain } }))
      setLoadError(null)
    } catch (caught) {
      setLoadError((caught as Error).message)
    }
  }, [request, orgId, domain])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setBusy(true)
    setError(null)
    setBadFields([])
    try {
      setAnswer(
        await request<ContactAnswer>(DOMAINS_API_ROUTES.contact, {
          body: { orgId, domain, contact: form },
        }),
      )
      setOpen(false)
      enqueueSnackbar('Saved. It goes to the registrar with the next renewal.', { variant: 'success', persist: false })
    } catch (caught) {
      const fields = caught instanceof DomainsRequestError ? caught.payload['fields'] : null
      if (Array.isArray(fields)) setBadFields(fields.map(String))
      setError(Array.isArray(fields) && fields.length ? badFieldsSentence(fields.map(String)) : (caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <Alert severity="warning">{loadError}</Alert>
  if (!answer) return null
  const contact = answer.contact
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ')
  const address = [contact.address1, contact.city, contact.state, contact.zip, contact.country]
    .filter(Boolean)
    .join(', ')

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle1" component="h3">
          {'Registrant contact'}
        </Typography>
        <Button
          size="small"
          disabled={!editable}
          onClick={() => {
            setForm(contactFormValue(answer.contact))
            setBadFields([])
            setError(null)
            setOpen(true)
          }}
        >
          {'Edit contact'}
        </Button>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2">{[name, contact.companyName].filter(Boolean).join(' · ') || '—'}</Typography>
        {answer.verification ? (
          <Chip
            size="small"
            color={answer.verification.verified ? 'success' : 'warning'}
            label={answer.verification.verified ? 'Email confirmed with ICANN' : 'Email not confirmed yet'}
          />
        ) : null}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {[contact.email, contact.phone, address].filter(Boolean).join(' · ')}
      </Typography>
      {answer.verification && !answer.verification.verified ? (
        <Alert severity="warning">
          {`ICANN requires the registrant email to be confirmed${answer.verification.verifyByMs ? ` by ${formatDay(answer.verification.verifyByMs)}` : ''}. Open the registrar’s email sent to ${answer.verification.email ?? contact.email ?? 'the registrant'} and follow its link.`}
        </Alert>
      ) : null}
      {answer.rejectedAtMs ? (
        <Alert severity="error">
          {'The registrar didn’t accept the last contact change, so it still has the earlier details. Check them and save again.'}
        </Alert>
      ) : answer.pendingSinceMs ? (
        <Alert severity="info">
          {`Changed on ${formatDay(answer.pendingSinceMs)}. ${contactTakesEffectSentence(answer)}`}
        </Alert>
      ) : null}

      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{`Registrant contact for ${domain}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {contactTakesEffectSentence(answer)}
            </Typography>
            <RegistrantContactFields
              value={form}
              onChange={setForm}
              badFields={badFields}
              disabled={busy}
            />
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save for the next renewal'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
