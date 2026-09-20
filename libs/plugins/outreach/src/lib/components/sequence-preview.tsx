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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { crmMergeUnresolvedMessage } from '@aglyn/aglyn/app-utils/crm-email-templates'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type {
  OutreachComplianceSettingsDocument,
  OutreachSequenceStep,
} from '../model/outreach.types'
import {
  OUTREACH_SAMPLE_PERSON,
  outreachSampleMergeContext,
  previewOutreachStep,
} from '../model/step-preview'
import { OutreachLoading } from './outreach-ui'
import type { OutreachTemplateOption } from './use-outreach-crm'
import type { OutreachLoadStatus } from './use-outreach-data'

export interface OutreachSequencePreviewProps {
  steps: readonly OutreachSequenceStep[]
  /** The organization's footer fields; `null` until they are read. */
  orgSettings: OutreachComplianceSettingsDocument | null
  orgSettingsStatus: OutreachLoadStatus
  templates: readonly OutreachTemplateOption[]
  /** Who the email is from, as the mailbox says it. */
  sender: { name: string; email: string } | null
  siteName: string
}

/**
 * The editor's live preview (AGL-2980): each email as it would reach a
 * sample contact, written by the engine's own composer as the rep types —
 * merge fields filled, the sample's personal line in place, and the real
 * footer from the organization's compliance settings at the end.
 */
export function OutreachSequencePreview(props: OutreachSequencePreviewProps) {
  const emails = props.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.kind === 'email')
  const [chosen, setChosen] = useState(0)
  const selected = emails[Math.min(chosen, emails.length - 1)]

  const result = useMemo(() => {
    if (!selected) return null
    const step = selected.step
    return previewOutreachStep({
      steps: props.steps,
      stepIndex: selected.index,
      orgSettings: props.orgSettings,
      merge: outreachSampleMergeContext({
        sender: props.sender,
        siteName: props.siteName,
      }),
      email: OUTREACH_SAMPLE_PERSON.email,
      personalLine: OUTREACH_SAMPLE_PERSON.personalLine,
      templateBody:
        step.kind === 'email' && step.templateId
          ? (props.templates.find((template) => template.id === step.templateId)
              ?.body ?? null)
          : null,
    })
  }, [
    selected,
    props.steps,
    props.orgSettings,
    props.sender,
    props.siteName,
    props.templates,
  ])

  return (
    <CardDisplay
      header="Preview"
      subheader={`As ${OUTREACH_SAMPLE_PERSON.name} of ${OUTREACH_SAMPLE_PERSON.companyName} would get it`}
      help={pluginDocsHelp('sequences', { anchor: '#build-a-sequence' })}
      contentGutterX
      contentGutterY
    >
      {!selected ? (
        <Typography variant="body2" color="text.secondary">
          Add an email step to preview it.
        </Typography>
      ) : props.orgSettingsStatus === 'loading' ? (
        <OutreachLoading label="Loading your footer…" />
      ) : props.orgSettingsStatus !== 'ready' ? (
        <Alert severity="info">
          The preview needs your compliance settings, which couldn’t be read. It
          shows once they can be.
        </Alert>
      ) : (
        <Stack spacing={1.5}>
          {emails.length > 1 ? (
            <TextField
              select
              size="small"
              label="Email"
              value={Math.min(chosen, emails.length - 1)}
              onChange={(event) => setChosen(Number(event.target.value))}
            >
              {emails.map((entry, position) => (
                <MenuItem key={entry.step.id} value={position}>
                  {`Email ${position + 1} · step ${entry.index + 1}`}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {result?.email ? (
            <Paper
              variant="outlined"
              sx={{ p: 1.5 }}
              aria-label="Email preview"
            >
              <Stack spacing={1}>
                <Typography variant="body2">
                  <Typography
                    component="span"
                    variant="body2"
                    color="text.secondary"
                  >
                    Subject:{' '}
                  </Typography>
                  {result.email.subject}
                </Typography>
                <Divider />
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {result.email.text}
                </Typography>
              </Stack>
            </Paper>
          ) : (
            <Alert severity="info">
              {result?.error?.message ?? 'This email can’t be previewed yet.'}
            </Alert>
          )}
          {result?.email && result.unresolvedFields.length ? (
            <Typography variant="caption" color="text.secondary">
              {`${crmMergeUnresolvedMessage(result.unresolvedFields)}. They're sent empty.`}
            </Typography>
          ) : null}
        </Stack>
      )}
    </CardDisplay>
  )
}
OutreachSequencePreview.displayName = 'OutreachSequencePreview'

export default OutreachSequencePreview
