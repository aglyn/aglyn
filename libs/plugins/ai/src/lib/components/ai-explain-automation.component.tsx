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

import type {
  ConsoleAutomationEditorZoneProps,
  ConsoleAutomationRunZoneProps,
} from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { aiJobProblem, useAiJobRun, useAiJobsVerdict, type AiJobRun } from './use-ai-job-run'

/**
 * "Explain it" in the editor of a saved automation, and "Why did this fail?"
 * on a failed run in its run history (AGL-2919), through the
 * `automationEditor` and `automationRun` zones. Each starts a `workflow` job
 * that reads the automation as it is saved — and, for a run, what the run
 * history recorded — and answers in plain words. Nothing is changed.
 */

export const AI_AUTOMATION_EXPLAIN_COPY = {
  explain: {
    action: 'Explain it',
    intro: 'Get a plain-words account of what this automation does, and anything in it worth checking.',
    saved: 'It reads the automation as it is saved, not changes you have not saved yet.',
    running: 'Reading the automation. This can take a few minutes.',
    again: 'Explain it again',
    failed: 'The automation could not be explained. Try again.',
    brief: (name: string) => `Explain what “${name}” does, and anything in it worth checking.`,
  },
  diagnose: {
    action: 'Why did this fail?',
    title: 'Why this run failed',
    running: 'Reading the run and the automation. This can take a few minutes.',
    again: 'Ask again',
    failed: 'The run could not be explained. Try again.',
    brief: (name: string) => `Why did a run of “${name}” fail, and how can it be fixed?`,
  },
} as const

/** The explanation a finished job wrote. */
function explanationOf(job: AiJobSummary | null): string | null {
  if (job?.status !== 'done') return null
  return job.outputs.find((output) => output.resource === 'text' && output.text)?.text ?? null
}

/** Progress, the explanation, or why there is none. */
function Answer({ run, running, failed }: { run: AiJobRun; running: string; failed: string }) {
  const text = explanationOf(run.job)
  const problem =
    aiJobProblem(run.job, failed) ?? (run.job?.status === 'done' && !text ? failed : null)
  return (
    <>
      {run.running ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CircularProgress size={16} aria-label="Explaining" />
          <Typography variant="body2" color="text.secondary">
            {running}
          </Typography>
        </Stack>
      ) : null}
      {text ? (
        <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
          {text}
        </Typography>
      ) : null}
      {problem ? <Alert severity={run.job?.status === 'failed' ? 'error' : 'warning'}>{problem}</Alert> : null}
      {run.notice ? <Alert severity="warning">{run.notice}</Alert> : null}
    </>
  )
}

/** "Explain it", at the top of the editor of a saved action or workflow. */
export function AiExplainAutomation({ hostId, orgId, target }: ConsoleAutomationEditorZoneProps) {
  const copy = AI_AUTOMATION_EXPLAIN_COPY.explain
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const run = useAiJobRun(user, copy.failed)

  if (verdict !== 'ready') return null
  const asked = Boolean(run.job || run.notice)
  const busy = run.starting || run.running

  const explain = () => {
    if (!orgId) return
    void run.start({
      orgId,
      hostId,
      kind: 'workflow',
      brief: copy.brief(target.name),
      inputs: { mode: 'explain', targetType: target.type, targetId: target.id },
    })
  }

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }} aria-label="Explain this automation">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {asked ? copy.saved : copy.intro}
          </Typography>
          <Button size="small" variant="outlined" disabled={busy || !orgId} onClick={explain}>
            {asked && !busy ? copy.again : copy.action}
          </Button>
        </Stack>
        <Answer run={run} running={copy.running} failed={copy.failed} />
      </Stack>
    </Box>
  )
}

/** "Why did this fail?", on a failed run: the answer opens over the run history. */
export function AiExplainRunFailure({ hostId, orgId, target, runId }: ConsoleAutomationRunZoneProps) {
  const copy = AI_AUTOMATION_EXPLAIN_COPY.diagnose
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const run = useAiJobRun(user, copy.failed)
  const [open, setOpen] = useState(false)

  if (verdict !== 'ready') return null
  const busy = run.starting || run.running

  const ask = () => {
    if (!orgId) return
    void run.start({
      orgId,
      hostId,
      kind: 'workflow',
      brief: copy.brief(target.name),
      inputs: { mode: 'diagnose', targetType: target.type, targetId: target.id, runId },
    })
  }

  const openAndAsk = () => {
    setOpen(true)
    // A run already explained, or being explained, is shown again rather than asked again.
    if (!run.job) ask()
  }

  const close = () => {
    setOpen(false)
    // A refusal is not kept: asking again later should ask the route again.
    if (run.notice) run.reset()
  }

  return (
    <>
      <Button size="small" variant="text" sx={{ px: 0.5, minWidth: 0 }} onClick={openAndAsk}>
        {copy.action}
      </Button>
      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Answer run={run} running={copy.running} failed={copy.failed} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{'Close'}</Button>
          {!busy && (run.notice || aiJobProblem(run.job, copy.failed)) ? (
            <Button variant="outlined" onClick={ask} disabled={!orgId}>
              {copy.again}
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </>
  )
}
