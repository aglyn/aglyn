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
  consentGroupForHost,
  CRM_COLLECTIONS,
  createResourceUid,
  type CrmEmailTemplateRow,
  type CrmMergeContext,
  type CrmMergeFieldGroup,
  crmMergeUnresolvedMessage,
  hasCrmMergeFields,
  resolveCrmMergeFields,
} from '@aglyn/aglyn'
import { useSendingApi } from '@aglyn/plugins-email/components/use-sending-identity-api'
import { AppLink, useConfirmationContext } from '@aglyn/shared-ui-jsx'
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
import { collection, doc, getDoc, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCrmOrgMount } from '../hooks/use-crm-org-mount'
import { CrmSitePicker } from './crm-site-picker'
import { useCrmApi } from './use-crm-api'
import { useEmailsHubPath } from './use-emails-hub-path'
import {
  useCrmEmailTemplates,
  useCrmEmailTemplateScope,
} from '../hooks/use-crm-email-templates'
import {
  CrmInsertMenu,
  CrmSaveAsTemplateDialog,
  CrmTemplatePicker,
} from './crm-email-template-tools'

/**
 * The documents a merge-field preview reads (AGL-2658), fetched once per
 * open and only once the draft names a field: a letter with no fields
 * costs no reads. `site` is the sending site's name; `loaded` says the
 * fetch has answered, so the helper text can tell "no value" from "not
 * yet read".
 */
interface MergeRecords {
  contact: Record<string, unknown> | null
  deal: Record<string, unknown> | null
  lead: Record<string, unknown> | null
  site: string | null
  loaded: boolean
}

const NO_MERGE_RECORDS: MergeRecords = {
  contact: null,
  deal: null,
  lead: null,
  site: null,
  loaded: false,
}

/**
 * What the sending-identity route said about this site, as the dialog
 * needs it: an address to print, or the reason there is none — or, at the
 * organization level, that no site has been picked to ask about.
 */
type IdentityState =
  | { status: 'loading' }
  | { status: 'site' }
  | { status: 'ready'; from: string }
  | { status: 'refused'; message: string; canManage: boolean }
  | { status: 'error'; message: string }

export interface CrmSendEmailDialogProps {
  open: boolean
  onClose: () => void
  /**
   * The site the message leaves from — passed in, never assumed from the
   * URL. At the organization level the record's own capturing site, or
   * `null` for a record no site has captured (AGL-2634): the dialog then
   * offers the org's sites to send from, defaulting to the reader's pick.
   */
  hostId: string | null
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
  const mount = useCrmOrgMount()
  const { orgId } = useOrgDataScope({
    hostId: hostId ?? undefined,
    orgId: org?.$id ?? mount?.orgId,
  })
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const sendingApi = useSendingApi()
  /*
   * The site the message LEAVES FROM: the record's own, or at the
   * organization level — for a record no site captured — the site the
   * reader picked (AGL-2634). The identity, the suppression list and the
   * person's stated refusal are each that site's, which is why the org
   * level cannot do without one.
   */
  const sendHostId = hostId ?? mount?.createHostId ?? null
  const crmApi = useCrmApi(sendHostId)
  const emailsHub = useEmailsHubPath(sendHostId)
  // The Sending section of the Emails console — the page that fixes a
  // missing identity. `null` on a surface that cannot name the site's hub,
  // so the refusal prints the section's name instead of a link to nowhere.
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
   * TEMPLATES, SNIPPETS AND MERGE FIELDS (AGL-2658). The listener is the
   * dialog's own scope — the mounted site's tokens, or none at the org
   * level — and what a saved template is stamped with follows the same
   * rule. The message field's element is held so a snippet lands at the
   * caret rather than at the end.
   */
  const { confirm } = useConfirmationContext()
  const templateScope = useCrmEmailTemplateScope({ hostId, org })
  const { templates } = useCrmEmailTemplates({
    scope: templateScope.scope,
    visibleTo: templateScope.visibleTo,
    uid: user?.uid,
  })
  const pickable = useMemo(() => templates.filter((row) => row.kind === 'template'), [templates])
  const snippets = useMemo(() => templates.filter((row) => row.kind === 'snippet'), [templates])
  const [appliedTemplate, setAppliedTemplate] = useState<CrmEmailTemplateRow | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [records, setRecords] = useState<MergeRecords>(NO_MERGE_RECORDS)
  const messageRef = useRef<HTMLTextAreaElement | null>(null)
  const draftHasFields = hasCrmMergeFields(`${subject}\n${body}`)
  // The groups the Insert menu offers: what the record can answer.
  const fieldGroups = useMemo<CrmMergeFieldGroup[]>(
    () => [
      ...(contactId || dealId ? (['Contact'] as const) : []),
      ...(leadId && !contactId ? (['Lead'] as const) : []),
      ...(dealId ? (['Deal'] as const) : []),
      'You',
      'Site',
    ],
    [contactId, dealId, leadId],
  )

  /*
   * The identity, asked for on open. The route is the send path's own
   * resolver, so what it prints here is what the message will leave as; a
   * dialog that derived "verified" from the domain list would be a second
   * opinion that drifts from the send.
   */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    // The draft survives a change of sending site — the site is not the
    // letter — and is cleared only when the dialog opens.
    if (!sendHostId) {
      setIdentity({ status: 'site' })
      return undefined
    }
    setIdentity({ status: 'loading' })
    void (async () => {
      const { response, payload } = await sendingApi({
        path: 'sending-identity',
        method: 'GET',
        query: { hostId: sendHostId },
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
  }, [open, sendHostId, sendingApi])
  useEffect(() => {
    if (!open) return
    setSubject('')
    setBody('')
    setAppliedTemplate(null)
    setSaveOpen(false)
    setRecords(NO_MERGE_RECORDS)
  }, [open])

  /*
   * The documents a preview reads, fetched the first time the draft names
   * a merge field and kept for the rest of the open: the contact, the
   * deal, the lead, and the sending site's name — off the org mount when
   * it knows the site, off the host document otherwise. The route reads
   * the same documents again for the send; these are what the rep sees.
   */
  useEffect(() => {
    if (!open || !draftHasFields || records.loaded) return
    let cancelled = false
    const read = async (path: string[] | null): Promise<Record<string, unknown> | null> => {
      if (!path) return null
      const snapshot = await getDoc(doc(firestore, path[0], ...path.slice(1)))
      return snapshot.exists() ? ((snapshot.data() ?? null) as Record<string, unknown> | null) : null
    }
    const mountedSite = sendHostId
      ? (mount?.hosts ?? []).find((host) => host.id === sendHostId)
      : undefined
    void Promise.all([
      read(contactId && orgId ? ['orgs', orgId, 'contacts', contactId] : null),
      read(dealId && orgId ? ['orgs', orgId, CRM_COLLECTIONS.deals, dealId] : null),
      read(leadId && sendHostId ? ['hosts', sendHostId, 'leads', leadId] : null),
      mountedSite || !sendHostId ? null : read(['hosts', sendHostId]),
    ])
      .then(([contact, deal, lead, host]) => {
        if (cancelled) return
        // A deal's contact, when the page named only the deal.
        const dealContactId = String(deal?.['contactId'] ?? '').trim()
        const withContact =
          !contact && dealContactId && orgId
            ? read(['orgs', orgId, 'contacts', dealContactId])
            : Promise.resolve(contact)
        return withContact.then((resolvedContact) => {
          if (cancelled) return
          setRecords({
            contact: resolvedContact,
            deal,
            lead,
            site: mountedSite?.name ?? (host ? String(host['displayName'] ?? '') : null),
            loaded: true,
          })
        })
      })
      .catch((cause) => {
        console.error(cause)
        if (!cancelled) setRecords({ ...NO_MERGE_RECORDS, loaded: true })
      })
    return () => {
      cancelled = true
    }
  }, [
    open,
    draftHasFields,
    records.loaded,
    firestore,
    orgId,
    contactId,
    dealId,
    leadId,
    sendHostId,
    mount?.hosts,
  ])

  const mergeContext = useMemo<CrmMergeContext>(
    () => ({
      contact: records.contact,
      contactGroupId: sendHostId ? consentGroupForHost(org ?? null, sendHostId).groupId : null,
      deal: records.deal,
      lead: records.lead,
      sender: { name: user?.displayName ?? '', email: user?.email ?? '' },
      site: { name: records.site ?? '' },
    }),
    [records, sendHostId, org, user?.displayName, user?.email],
  )
  const preview = useMemo(
    () =>
      draftHasFields && records.loaded
        ? {
            subject: resolveCrmMergeFields(subject, mergeContext),
            body: resolveCrmMergeFields(body, mergeContext),
          }
        : null,
    [draftHasFields, records.loaded, subject, body, mergeContext],
  )
  const unresolved = useMemo(
    () =>
      preview
        ? [...new Set([...preview.subject.unresolved, ...preview.body.unresolved])]
        : [],
    [preview],
  )

  /** A template into both fields — asking first when a message is already written. */
  const applyTemplate = useCallback(
    async (template: CrmEmailTemplateRow | null) => {
      if (!template) {
        setAppliedTemplate(null)
        return
      }
      const written = body.trim().length > 0 && body !== appliedTemplate?.body
      if (written) {
        const accepted = await confirm({
          title: 'Replace the message?',
          description: `"${template.name}" replaces what you have written in the subject and the message.`,
          confirmationText: 'Replace',
        })
          .then(() => true)
          .catch(() => false)
        if (!accepted) return
      }
      if (template.subject) setSubject(template.subject)
      setBody(template.body)
      setAppliedTemplate(template)
    },
    [body, appliedTemplate, confirm],
  )

  /** A snippet or a field where the caret is, the caret moved past it. */
  const insertAtCaret = useCallback(
    (text: string) => {
      const element = messageRef.current
      const start = element?.selectionStart ?? body.length
      const end = element?.selectionEnd ?? body.length
      const next = `${body.slice(0, start)}${text}${body.slice(end)}`.slice(0, CRM_EMAIL_BODY_MAX)
      setBody(next)
      const caret = Math.min(start + text.length, next.length)
      window.setTimeout(() => {
        element?.focus()
        element?.setSelectionRange(caret, caret)
      }, 0)
    },
    [body],
  )

  /**
   * The draft kept as a template, stamped as this surface's scope stamps
   * every CRM record — the site's tokens under a site, the org token from
   * the organization's hub — and, when personal, owned by the writer.
   */
  const saveAsTemplate = useCallback(
    async (draft: { name: string; visibility: 'shared' | 'personal' }) => {
      const scope = templateScope.scope
      const uid = user?.uid
      if (!scope || !uid || templateScope.createTokens.length === 0) {
        throw new Error('a template needs an organization and a signed-in writer')
      }
      const now = Date.now()
      await setDoc(
        doc(collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.emailTemplates), createResourceUid()),
        {
          name: draft.name,
          subject: subject.trim(),
          body: body.trim(),
          kind: 'template',
          visibility: draft.visibility,
          ...(draft.visibility === 'personal' ? { ownerUid: uid } : {}),
          createdByUid: uid,
          createdAtMs: now,
          updatedAtMs: now,
          hostId: templateScope.createHostId,
          visibleTo: [...templateScope.createTokens],
          createdAt: new Date(now),
          updatedAt: new Date(now),
        },
      )
      enqueueSnackbar(`Template "${draft.name}" saved`, { variant: 'success', persist: false })
      setSaveOpen(false)
    },
    [templateScope, user?.uid, firestore, subject, body, enqueueSnackbar],
  )

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
        {!hostId ? (
          <CrmSitePicker
            hostId={hostId}
            label="Send from"
            helperText="The site whose sending address the email leaves on."
            disabled={sending}
          />
        ) : null}
        {identity.status === 'site' ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            {'Pick the site the email leaves from.'}
          </Alert>
        ) : identity.status === 'refused' ? (
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
          sx={{ mt: identity.status === 'ready' || identity.status === 'loading' ? 1 : 0 }}
        />
        <TextField
          size="small"
          label="From"
          value={
            identity.status === 'ready'
              ? identity.from
              : identity.status === 'loading'
                ? 'Resolving the site’s sending address…'
                : identity.status === 'site'
                  ? 'Pick a site to send from'
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
        {pickable.length ? (
          <CrmTemplatePicker
            templates={pickable}
            value={appliedTemplate}
            onChange={(template) => void applyTemplate(template)}
            disabled={sending}
          />
        ) : null}
        <TextField
          size="small"
          label="Subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          autoFocus
          slotProps={{ htmlInput: { maxLength: CRM_EMAIL_SUBJECT_MAX } }}
        />
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <CrmInsertMenu
            snippets={snippets}
            groups={fieldGroups}
            disabled={sending}
            onInsert={insertAtCaret}
          />
          <Button
            size="small"
            disabled={sending || !templateScope.scope || (!subject.trim() && !body.trim())}
            onClick={() => setSaveOpen(true)}
          >
            {'Save as template…'}
          </Button>
        </Stack>
        <TextField
          size="small"
          label="Message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          multiline
          minRows={6}
          inputRef={messageRef}
          helperText={
            unresolved.length
              ? crmMergeUnresolvedMessage(unresolved)
              : draftHasFields
                ? 'Plain text. Merge fields are filled in from this record when the email is sent.'
                : 'Plain text. A blank line starts a new paragraph.'
          }
          slotProps={{
            htmlInput: { maxLength: CRM_EMAIL_BODY_MAX },
            formHelperText: { sx: unresolved.length ? { color: 'warning.main' } : undefined },
          }}
        />
        {preview ? (
          <Stack spacing={0.5} data-testid="crm-email-preview">
            <Typography variant="caption" color="text.secondary">
              {'Preview — as it will be sent'}
            </Typography>
            <Typography variant="subtitle2">{preview.subject.text}</Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {preview.body.text}
            </Typography>
          </Stack>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </DialogContent>
      <CrmSaveAsTemplateDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={saveAsTemplate}
      />
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
