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
import type { ConsoleRecordInsightsZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import type { ConsoleProposedTask } from '@aglyn/aglyn/plugin-manager/record-zone-props'
import { useHostOrgId } from '@aglyn/tenant-feature-instance'
import { Alert, Box, Button, CircularProgress, Link, Stack, Typography } from '@mui/material'
import { useMemo } from 'react'
import {
  AI_CRM_RECORD_KINDS,
  type AiCrmAnswerWanted,
  type AiCrmNextStep,
  type AiCrmRecordKind,
} from '../model/ai-crm'
import { useAiCrmAnswer } from './use-ai-crm-answer'

const TASK_KIND_WORDS: Record<AiCrmNextStep['kind'], string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  todo: 'To-do',
}

/** When a suggested task is due, in words. */
export function aiCrmDueWords(dueInDays: number): string {
  if (dueInDays <= 0) return 'due today'
  if (dueInDays === 1) return 'due tomorrow'
  return `due in ${dueInDays} days`
}

/** A suggested next step as the task form takes it. */
export function aiCrmTaskOf(step: AiCrmNextStep): ConsoleProposedTask {
  return { title: step.title, notes: step.reason, kind: step.kind, priority: step.priority, dueInDays: step.dueInDays }
}

const recordKindOf = (kind: string): AiCrmRecordKind | null =>
  (AI_CRM_RECORD_KINDS as readonly string[]).includes(kind) ? (kind as AiCrmRecordKind) : null

/**
 * "Summarize this contact" (AGL-2917), on a CRM record's page through the
 * `recordInsights` zone: a contact's, company's, deal's or lead's summary,
 * with a suggested next step, a deal's suggested stage and a lead's standing.
 *
 * The card writes nothing. A next step goes to the page's own task form
 * through `proposeTask`, whose Save is the write, and a stage to the page's
 * stage move through `proposeStage`, which asks the member first. A summary
 * any member asked for is shown to every member who can open the record, and
 * asking again for an unchanged record reuses it at no cost.
 *
 * It renders nothing until the jobs route has answered for this workspace:
 * the shell decided the plan and the permission, but the release flag is the
 * route's, and a 404 there is this card staying absent.
 */
export function AiCrmRecordCard(props: ConsoleRecordInsightsZoneProps) {
  const { hostId, record, proposeTask, stages, stageId, proposeStage } = props
  // A record page may not know the org yet; its site does.
  const hostOrgId = useHostOrgId(props.orgId || !hostId ? undefined : hostId)
  const orgId = props.orgId ?? hostOrgId ?? undefined
  const kind = recordKindOf(record.kind)
  const recordId = record.id
  const wanted = useMemo<AiCrmAnswerWanted | null>(
    () => (kind ? { kind: 'record', record: { kind, id: recordId } } : null),
    [kind, recordId],
  )
  const run = useAiCrmAnswer({ orgId, hostId, wanted, recall: 'any' })

  if (!kind || run.verdict !== 'ready') return null

  const proposal = run.answer?.proposal.kind === 'record' ? run.answer.proposal : null
  const jobId = run.answer?.jobId ?? ''
  const working = run.busy || run.running
  const nextStep = proposal?.nextStep && proposeTask ? proposal.nextStep : null
  const offeredStage =
    proposal?.stage && proposeStage && proposal.stage.stageId !== stageId
      ? (stages ?? []).find((stage) => stage.id === proposal.stage?.stageId) ?? null
      : null
  const help = pluginDocsHelp('aiCrm', {
    anchor: '#summarize-a-record',
    excerpt: 'A short summary of this record and a suggested next step, from its timeline. Nothing is saved until you save it.',
  })

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }} aria-label="AI summary">
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {'AI summary'}
          </Typography>
          <Link href={help.href} target="_blank" rel="noopener" variant="caption" title={help.excerpt}>
            {'How it works'}
          </Link>
        </Stack>

        {proposal ? (
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {proposal.summary}
            </Typography>
            {proposal.standing ? (
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                {proposal.standing}
              </Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary">
              {`Written from the timeline on ${proposal.asOf}.`}
            </Typography>
          </Stack>
        ) : null}

        {nextStep && proposeTask ? (
          <Stack spacing={0.5} aria-label="Suggested next step">
            <Typography variant="caption" color="text.secondary">
              {'Suggested next step'}
            </Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {`${nextStep.title} (${TASK_KIND_WORDS[nextStep.kind]}, ${nextStep.priority} priority, ${aiCrmDueWords(nextStep.dueInDays)})`}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
              {nextStep.reason}
            </Typography>
            <Button
              size="small"
              variant="contained"
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => proposeTask(aiCrmTaskOf(nextStep), jobId)}
            >
              {'Create task'}
            </Button>
          </Stack>
        ) : null}

        {offeredStage && proposal?.stage && proposeStage ? (
          <Stack spacing={0.5} aria-label="Suggested stage">
            <Typography variant="caption" color="text.secondary">
              {'Suggested stage'}
            </Typography>
            <Typography variant="body2">{offeredStage.name}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
              {proposal.stage.reason}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => proposeStage(offeredStage.id, jobId)}
            >
              {`Move to ${offeredStage.name}`}
            </Button>
          </Stack>
        ) : null}

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            disabled={working || !orgId}
            onClick={() => void run.ask(`Summarize this ${kind}`, { task: 'record', record: kind, recordId })}
          >
            {proposal ? 'Summarize again' : `Summarize this ${kind}`}
          </Button>
          {working ? <CircularProgress size={16} aria-label="Summarizing" /> : null}
        </Stack>
        {run.notice ? <Alert severity="warning">{run.notice}</Alert> : null}
        {run.job?.error && !proposal ? (
          <Alert severity={run.job.status === 'failed' ? 'error' : 'warning'}>{run.job.error}</Alert>
        ) : null}
      </Stack>
    </Box>
  )
}
AiCrmRecordCard.displayName = 'AiCrmRecordCard'

export default AiCrmRecordCard
