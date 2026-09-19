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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import type { ConsoleRecordEmailZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { useHostOrgId } from '@aglyn/tenant-feature-instance'
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import {
  AI_CRM_EMAIL_RECORD_KINDS,
  AI_CRM_EMAIL_REQUEST_MAX_CHARS,
  type AiCrmAnswerWanted,
  type AiCrmRecordKind,
} from '../model/ai-crm'
import { useAiCrmAnswer } from './use-ai-crm-answer'

const emailKindOf = (kind: string): AiCrmRecordKind | null =>
  (AI_CRM_EMAIL_RECORD_KINDS as readonly string[]).includes(kind) ? (kind as AiCrmRecordKind) : null

/**
 * "Draft the message" (AGL-2917), in the CRM's one-to-one composer through
 * the `recordEmail` zone: the member says what the email should say, a `crm`
 * job drafts a subject and a message from that and the record's timeline, and
 * the draft goes into the composer through `proposeDraft`, which asks before
 * it replaces a written message.
 *
 * Nothing here sends anything, and nothing can: the composer's Send is the
 * member's. A draft is asked afresh each time, so the card recalls no earlier
 * one, and the answer door serves a draft only to the member who asked.
 */
export function AiCrmEmailDraft(props: ConsoleRecordEmailZoneProps) {
  const { hostId, record, proposeDraft } = props
  const hostOrgId = useHostOrgId(props.orgId || !hostId ? undefined : hostId)
  const orgId = props.orgId ?? hostOrgId ?? undefined
  const kind = emailKindOf(record.kind)
  const recordId = record.id
  const wanted = useMemo<AiCrmAnswerWanted | null>(
    () => (kind ? { kind: 'email', record: { kind, id: recordId } } : null),
    [kind, recordId],
  )
  const run = useAiCrmAnswer({ orgId, hostId, wanted, recall: 'none' })
  const [request, setRequest] = useState('')

  if (!kind || run.verdict !== 'ready') return null

  const working = run.busy || run.running
  const help = pluginDocsHelp('aiCrm', {
    anchor: '#draft-an-email',
    excerpt: 'Describe the email and a draft goes into the message. Nothing is sent until you press Send.',
  })

  const draft = async () => {
    const answer = await run.ask(request.trim(), { task: 'email', record: kind, recordId })
    if (answer?.proposal.kind !== 'email') return
    proposeDraft({ subject: answer.proposal.subject, body: answer.proposal.body }, answer.jobId)
  }

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }} aria-label="Draft with AI">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {'Draft with AI'}
          </Typography>
          <Link href={help.href} target="_blank" rel="noopener" variant="caption" title={help.excerpt}>
            {'How it works'}
          </Link>
        </Stack>
        <TextField
          size="small"
          multiline
          minRows={2}
          label="What should the email say?"
          placeholder="Follow up on the quote and offer a call next week"
          helperText="Written from what you ask and this record's timeline. Nothing is sent until you press Send."
          value={request}
          onChange={(event) => setRequest(event.target.value.slice(0, AI_CRM_EMAIL_REQUEST_MAX_CHARS))}
          disabled={working}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            disabled={working || !orgId || !request.trim()}
            onClick={() => void draft()}
          >
            {'Draft the message'}
          </Button>
          {working ? <CircularProgress size={16} aria-label="Drafting the message" /> : null}
        </Stack>
        {run.notice ? <Alert severity="warning">{run.notice}</Alert> : null}
        {run.job?.error && !run.answer ? (
          <Alert severity={run.job.status === 'failed' ? 'error' : 'warning'}>{run.job.error}</Alert>
        ) : null}
      </Stack>
    </Box>
  )
}
AiCrmEmailDraft.displayName = 'AiCrmEmailDraft'

export default AiCrmEmailDraft
