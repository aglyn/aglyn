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
  type AglynOrgBilling,
  CRM_EMAIL_BODY_MAX,
  CRM_EMAIL_SUBJECT_MAX,
  normalizeContactEmail,
} from '@aglyn/aglyn'
import { useSendingApi } from '@aglyn/plugins-email/components/use-sending-identity-api'
import { useEmailsHubPath } from '@aglyn/plugins-marketing/components/use-emails-hub-path'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useOrgDataScope,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useCrmApi } from './use-crm-api'

/**
 * What the sending-identity route said about this site, as the dialog
 * needs it: an address to print, or the reason there is none.
 */
type IdentityState =
  | { status: 'loading' }
  | { status: 'ready'; from: string }
  | { status: 'refused'; message: string; canManage: boolean }
  | { status: 'error'; message: string }

export interface CrmSendEmailDialogProps {
  open: boolean
  onClose: () => void
  /** The site the message leaves from — passed in, never assumed from the URL. */
  hostId: string
  /** The org the shell passed; lets a deal's contact be read without a lookup. */
  org?: Partial<AglynOrgBilling> | null
  contactId?: string
  leadId?: string
  dealId?: string
  /**
   * The recipient as the record shows it. A deal's page holds no address,
   * so a caller with only a `contactId` may leave this out and the dialog
   * reads it off the contact when it opens.
   */
  email?: string | null
  /** What the dialog says it is writing to, beside the address. */
  name?: string | null
  /** Told once the route has accepted the message. */
  onSent?: (result: { activityId: string }) => void
}

/**
 * One email to one person, from their record (AGL-2615).
 *
 * ## What the reader sees, and what they cannot change
 *
 * To is the record's address and is read-only: the route resolves the
 * recipient off the record again, so an editable field here would be a
 * promise the server does not keep. From is the site's sending identity as
 * the sending-identity route reports it — the same answer the campaign
 * composer prints — and when that route refuses, the dialog says why and
 * points at **Emails › Sending** rather than offering a Send button that
 * 409s. Reply-to is the signed-in user's own address, because a reply to a
 * relationship email belongs in the inbox of the person who wrote it, not
 * the site's shared mailbox. Subject and Body are the whole of what a
 * person writes; the body is plain paragraphs, and the email design system
 * is deliberately not here — this is a letter, not a campaign.
 *
 * ## A refusal stays on screen
 *
 * The route's refusals — the daily cap, a suppressed address, a stated
 * refusal, the ceiling — are answers the rep should read, so they render
 * inside the dialog with the draft intact rather than as a toast over a
 * closed one. Only a send the provider accepted closes it.
 *
 * Mounted on open by its button, so the identity request and the contact
 * read happen when somebody asks and not on every record page paint.
 */
export function CrmSendEmailDialog(props: CrmSendEmailDialogProps) {
  const { open, onClose, hostId, org, contactId, leadId, dealId, onSent } = props
  const firestore = useFirestore()
  const { orgId } = useOrgDataScope({ hostId, orgId: org?.$id })
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const sendingApi = useSendingApi()
  const crmApi = useCrmApi(hostId)
  const emailsHub = useEmailsHubPath()
  // The Sending section of the Emails console — the page that fixes a
  // missing identity. `null` on a surface with no site in its URL, so the
  // refusal prints the section's name instead of a link to nowhere.
  const sendingPath = emailsHub ? `${emailsHub}/sending` : null

  const [identity, setIdentity] = useState<IdentityState>({ status: 'loading' })
  const [recipient, setRecipient] = useState<string | null>(
    normalizeContactEmail(props.email) ?? null,
  )
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * The identity, asked for on open. The route is the send path's own
   * resolver, so what it prints here is what the message will leave as; a
   * dialog that derived "verified" from the domain list would be a second
   * opinion that drifts from the send.
   */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setIdentity({ status: 'loading' })
    setError(null)
    setSubject('')
    setBody('')
    void (async () => {
      const { response, payload } = await sendingApi({
        path: 'sending-identity',
        method: 'GET',
        query: { hostId },
      })
      if (cancelled) return
      if (!response.ok) {
        setIdentity({
          status: 'error',
          message: String(payload['error'] ?? 'The sending identity could not be read.'),
        })
        return
      }
      const refusal = payload['refusal'] as { message?: string } | null
      if (refusal) {
        setIdentity({
          status: 'refused',
          message: String(refusal.message ?? 'This site has no verified sending identity.'),
          canManage: payload['canManage'] === true,
        })
        return
      }
      const senders = Array.isArray(payload['senders'])
        ? (payload['senders'] as { isDefault?: boolean; from?: string | null }[])
        : []
      const from =
        senders.find((sender) => sender.isDefault && sender.from)?.from ??
        senders.find((sender) => sender.from)?.from ??
        null
      setIdentity(
        from
          ? { status: 'ready', from }
          : {
              status: 'error',
              message: String(payload['identity'] ?? 'No sending address is in effect.'),
            },
      )
    })()
    return () => {
      cancelled = true
    }
  }, [open, hostId, sendingApi])

  /*
   * The address, when the caller had none: one read of the contact, on
   * open. The route reads it again for itself; this one is what the To
   * field prints, and a field that printed nothing until the send answered
   * would ask the rep to write to somebody unnamed.
   */
  useEffect(() => {
    if (!open) return
    const given = normalizeContactEmail(props.email)
    if (given) {
      setRecipient(given)
      return
    }
    if (!contactId || !orgId) return
    let cancelled = false
    void getDoc(doc(firestore, 'orgs', orgId, 'contacts', contactId))
      .then((snapshot) => {
        if (cancelled) return
        setRecipient(normalizeContactEmail(snapshot.get('email')) ?? null)
      })
      .catch((cause) => {
        console.error(cause)
        if (!cancelled) setRecipient(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, props.email, contactId, orgId, firestore])

  const replyTo = normalizeContactEmail(user?.email) ?? ''
  const canSend =
    identity.status === 'ready' &&
    Boolean(recipient) &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    !sending

  const handleSend = useCallback(async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      const { response, payload } = await crmApi('email-send', {
        ...(contactId ? { contactId } : {}),
        ...(leadId ? { leadId } : {}),
        ...(dealId ? { dealId } : {}),
        subject: subject.trim(),
        body: body.trim(),
      })
      if (!response.ok) {
        setError(String(payload['error'] ?? 'The email could not be sent.'))
        return
      }
      enqueueSnackbar('Email sent', { variant: 'success', persist: false })
      onSent?.({ activityId: String(payload['activityId'] ?? '') })
      onClose()
    } catch (cause) {
      console.error(cause)
      setError('The email could not be sent.')
    } finally {
      setSending(false)
    }
  }, [canSend, crmApi, contactId, leadId, dealId, subject, body, enqueueSnackbar, onSent, onClose])

  const toLabel = props.name && recipient ? `${props.name} <${recipient}>` : (recipient ?? '')

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{'Send email'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {identity.status === 'refused' ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            <Typography variant="body2">{identity.message}</Typography>
            {sendingPath ? (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                <AppLink href={sendingPath}>
                  {identity.canManage ? 'Set up sending' : 'See sending'}
                </AppLink>
              </Typography>
            ) : (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {'An admin sets this up under Emails › Sending.'}
              </Typography>
            )}
          </Alert>
        ) : identity.status === 'error' ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {identity.message}
          </Alert>
        ) : null}
        {open && !recipient && (identity.status === 'ready' || identity.status === 'loading') ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {'This record has no email address.'}
          </Alert>
        ) : null}
        <TextField
          size="small"
          label="To"
          value={toLabel}
          slotProps={{ input: { readOnly: true }, inputLabel: { shrink: true } }}
          sx={{ mt: identity.status === 'refused' || identity.status === 'error' ? 0 : 1 }}
        />
        <TextField
          size="small"
          label="From"
          value={
            identity.status === 'ready'
              ? identity.from
              : identity.status === 'loading'
                ? 'Resolving the site’s sending address…'
                : ''
          }
          slotProps={{ input: { readOnly: true }, inputLabel: { shrink: true } }}
        />
        <TextField
          size="small"
          label="Reply-to"
          value={replyTo}
          helperText="Replies come to you, not to the site's mailbox."
          slotProps={{ input: { readOnly: true }, inputLabel: { shrink: true } }}
        />
        <TextField
          size="small"
          label="Subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          autoFocus
          slotProps={{ htmlInput: { maxLength: CRM_EMAIL_SUBJECT_MAX } }}
        />
        <TextField
          size="small"
          label="Message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          multiline
          minRows={6}
          helperText="Plain text. A blank line starts a new paragraph."
          slotProps={{ htmlInput: { maxLength: CRM_EMAIL_BODY_MAX } }}
        />
        {error ? <Alert severity="error">{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>
          {'Cancel'}
        </Button>
        <Button variant="contained" color="primary" disabled={!canSend} onClick={handleSend}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
CrmSendEmailDialog.displayName = 'CrmSendEmailDialog'

export default CrmSendEmailDialog
