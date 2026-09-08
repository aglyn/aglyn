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
  CRM_EMAIL_BODY_MAX,
  CRM_EMAIL_SUBJECT_MAX,
  CRM_EMAIL_TEMPLATE_KIND_LABELS,
  CRM_EMAIL_TEMPLATE_KINDS,
  CRM_EMAIL_TEMPLATE_NAME_MAX,
  CRM_EMAIL_TEMPLATE_VISIBILITIES,
  CRM_EMAIL_TEMPLATE_VISIBILITY_LABELS,
  CRM_MERGE_FIELDS,
  type CrmEmailTemplateKind,
  type CrmEmailTemplateRow,
  type CrmEmailTemplateVisibility,
  crmMergeFieldToken,
  isCrmEmailTemplateKind,
  isCrmEmailTemplateVisibility,
} from '@aglyn/aglyn'
import {
  Button,
  Drawer,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'

/** What the drawer hands back — the template's editable half. */
export interface EmailTemplateDraft {
  name: string
  kind: CrmEmailTemplateKind
  visibility: CrmEmailTemplateVisibility
  /** `''` on a snippet. */
  subject: string
  body: string
}

export interface EmailTemplateDrawerProps {
  open: boolean
  onClose: () => void
  /** The template being edited, or `null` to create one. */
  template: CrmEmailTemplateRow | null
  /** Receives the draft; closing on success is the caller's job. */
  onSubmit: (draft: EmailTemplateDraft) => Promise<void> | void
}

/** The fields, as a caption lists them: `{{contact.firstName}}, …`. */
const FIELD_TOKENS = CRM_MERGE_FIELDS.map((field) => crmMergeFieldToken(field.key)).join(', ')

/**
 * The one form an email template or snippet is created and edited through
 * (AGL-2658).
 *
 * A template has a subject; a snippet is a paragraph and has none, so the
 * Subject field comes and goes with the kind. Both are plain text with
 * merge fields, which the caption spells out in full because a rep writing
 * a template is not on the record page where the Insert menu lives, and
 * the fields are the whole point of writing one.
 */
export function EmailTemplateDrawer(props: EmailTemplateDrawerProps) {
  const { open, onClose, template, onSubmit } = props
  const editing = Boolean(template)

  const [name, setName] = useState('')
  const [kind, setKind] = useState<CrmEmailTemplateKind>('template')
  const [visibility, setVisibility] = useState<CrmEmailTemplateVisibility>('shared')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seeded on every open, from the template when there is one: a drawer
  // that kept the previous draft would offer it as the next template.
  useEffect(() => {
    if (!open) return
    setName(template?.name ?? '')
    setKind(template?.kind ?? 'template')
    setVisibility(template?.visibility ?? 'shared')
    setSubject(template?.subject ?? '')
    setBody(template?.body ?? '')
    setBusy(false)
    setError(null)
  }, [open, template])

  const canSubmit = !busy && name.trim().length > 0 && body.trim().length > 0

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim().slice(0, CRM_EMAIL_TEMPLATE_NAME_MAX),
        kind,
        visibility,
        subject: kind === 'template' ? subject.trim().slice(0, CRM_EMAIL_SUBJECT_MAX) : '',
        body: body.trim().slice(0, CRM_EMAIL_BODY_MAX),
      })
    } catch (caught) {
      console.error(caught)
      setError('Could not save the template. Try again.')
    } finally {
      setBusy(false)
    }
  }, [canSubmit, onSubmit, name, kind, visibility, subject, body])

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Stack spacing={2} sx={{ width: 420, maxWidth: '100vw', p: 3 }}>
        <Typography variant="h6">{editing ? 'Edit template' : 'New template'}</Typography>
        <TextField
          size="small"
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus={!editing}
          slotProps={{ htmlInput: { maxLength: CRM_EMAIL_TEMPLATE_NAME_MAX } }}
          fullWidth
        />
        <TextField
          select
          size="small"
          label="Kind"
          value={kind}
          onChange={(event) => {
            const next = event.target.value
            if (isCrmEmailTemplateKind(next)) setKind(next)
          }}
          helperText={
            kind === 'template'
              ? 'Fills in the subject and the message of an email.'
              : 'A paragraph inserted where the cursor is.'
          }
          fullWidth
        >
          {CRM_EMAIL_TEMPLATE_KINDS.map((option) => (
            <MenuItem key={option} value={option}>
              {CRM_EMAIL_TEMPLATE_KIND_LABELS[option]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Who it is for"
          value={visibility}
          onChange={(event) => {
            const next = event.target.value
            if (isCrmEmailTemplateVisibility(next)) setVisibility(next)
          }}
          helperText={
            visibility === 'shared'
              ? 'Every CRM editor can use and change it.'
              : 'Listed for you alone.'
          }
          fullWidth
        >
          {CRM_EMAIL_TEMPLATE_VISIBILITIES.map((option) => (
            <MenuItem key={option} value={option}>
              {CRM_EMAIL_TEMPLATE_VISIBILITY_LABELS[option]}
            </MenuItem>
          ))}
        </TextField>
        {kind === 'template' ? (
          <TextField
            size="small"
            label="Subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            helperText="Optional. An email keeps its own subject when this is blank."
            slotProps={{ htmlInput: { maxLength: CRM_EMAIL_SUBJECT_MAX } }}
            fullWidth
          />
        ) : null}
        <TextField
          size="small"
          label="Message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          multiline
          minRows={6}
          helperText="Plain text. A blank line starts a new paragraph."
          slotProps={{ htmlInput: { maxLength: CRM_EMAIL_BODY_MAX } }}
          fullWidth
        />
        <Typography variant="caption" color="text.secondary">
          {`Merge fields are filled in from the record when the email is sent: ${FIELD_TOKENS}.`}
        </Typography>
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="primary" disabled={!canSubmit} onClick={handleSubmit}>
            {editing ? 'Save' : 'Create template'}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {'Cancel'}
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  )
}
EmailTemplateDrawer.displayName = 'EmailTemplateDrawer'

export default EmailTemplateDrawer
