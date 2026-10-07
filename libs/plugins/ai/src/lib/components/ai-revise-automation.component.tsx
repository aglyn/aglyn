'use client'

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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { mdiCreation } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { openAiJobs } from './ai-jobs-store'
import type { ConsoleAutomationEditorZoneProps } from './ai-automation-zones'
import { aiJobProblem, useAiJobRun, useAiJobsVerdict } from './use-ai-job-run'

/**
 * "Fix with AI" and "Change with AI" in the editor of a saved ACTION
 * (AGL-3603), through the `automationEditor` zone. Each starts a `workflow`
 * job in `revise` mode: the action as it is saved, and the change asked of
 * it, become a NEW automation drafted switched off. The saved action is never
 * written; the person opens the copy, reads what changed, and switches it on
 * in place of the old one when it is right.
 *
 * A workflow of function calls is not offered either: the draft writer writes
 * actions, and a workflow is explained rather than revised.
 */

/** The longest change a job admits as its brief. */
const BRIEF_MAX_CHARS = 4_000

export const AI_AUTOMATION_REVISE_COPY = {
  intro: 'Describe a change, or let AI fix what would stop it working. You get a changed copy, switched off, to review — this one is left as it is.',
  label: 'What should change?',
  placeholder: 'Also tag them “newsletter”, and wait a day before the email',
  change: 'Change with AI',
  fix: 'Fix with AI',
  running: 'Drafting the changed copy. This can take a few minutes.',
  drafted: 'Changed copy drafted',
  review: 'Review the copy',
  notListed: 'The copy is saved. It appears in the list in a moment.',
  failed: 'The automation could not be changed. Try again.',
  fixBrief: (name: string) =>
    `Fix whatever in “${name}” would stop it working as intended — a record the site no longer has, a condition that can never match, a step in the wrong order. Change nothing else.`,
} as const

export function AiReviseAutomation({ hostId, orgId, target, openAction }: ConsoleAutomationEditorZoneProps) {
  const copy = AI_AUTOMATION_REVISE_COPY
  const help = pluginDocsHelp('aiAutomations', { anchor: '#change' })
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const run = useAiJobRun(user, copy.failed)
  const [brief, setBrief] = useState('')
  const [notListed, setNotListed] = useState(false)

  if (verdict !== 'ready' || target.type !== 'action') return null
  const { job } = run
  const busy = run.starting || run.running
  const draft = job?.status === 'done' ? job.outputs.find((output) => output.resource === 'workflow') : undefined
  const problem = aiJobProblem(job, copy.failed) ?? (job?.status === 'done' && !draft ? copy.failed : null)

  const start = async (text: string) => {
    const trimmed = text.trim()
    if (!orgId || !trimmed) return
    setNotListed(false)
    if (
      await run.start({
        orgId,
        hostId,
        kind: 'workflow',
        brief: trimmed,
        inputs: { mode: 'revise', targetType: 'action', targetId: target.id },
      })
    ) {
      setBrief('')
    }
  }

  const review = () => {
    if (!draft) return
    if (!openAction?.(draft.id)) setNotListed(true)
  }

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }} aria-label="Change this automation with AI">
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {copy.intro}{' '}
          <Link href={help.href} target="_blank" rel="noopener" title={help.excerpt}>
            {'How it works'}
          </Link>
        </Typography>
        <TextField
          size="small"
          label={copy.label}
          placeholder={copy.placeholder}
          value={brief}
          multiline
          maxRows={4}
          onChange={(event) => setBrief(event.target.value.slice(0, BRIEF_MAX_CHARS))}
          disabled={busy}
        />
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<MdiIcon path={mdiCreation.path} />}
            disabled={busy || !orgId || !brief.trim()}
            onClick={() => void start(brief)}
          >
            {copy.change}
          </Button>
          <Button
            size="small"
            variant="text"
            startIcon={<MdiIcon path={mdiCreation.path} />}
            disabled={busy || !orgId}
            onClick={() => void start(copy.fixBrief(target.name))}
          >
            {copy.fix}
          </Button>
        </Stack>
        {run.running && job ? (
          <Alert
            severity="info"
            icon={<CircularProgress size={18} aria-label="Drafting" />}
            action={
              <Button color="inherit" size="small" variant="outlined" onClick={() => openAiJobs({ jobId: job.id })}>
                {'Open AI jobs'}
              </Button>
            }
          >
            {copy.running}
          </Alert>
        ) : null}
        {draft ? (
          <Alert
            severity="success"
            action={
              openAction ? (
                <Button color="inherit" size="small" variant="outlined" onClick={review}>
                  {copy.review}
                </Button>
              ) : undefined
            }
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {`${copy.drafted}: ${draft.label}`}
            </Typography>
            {draft.note ? <Typography variant="body2">{draft.note}</Typography> : null}
          </Alert>
        ) : null}
        {problem ? <Alert severity={job?.status === 'failed' ? 'error' : 'warning'}>{problem}</Alert> : null}
        {run.notice ? <Alert severity="warning">{run.notice}</Alert> : null}
        {notListed ? <Alert severity="info">{copy.notListed}</Alert> : null}
      </Stack>
    </Box>
  )
}

export default AiReviseAutomation
