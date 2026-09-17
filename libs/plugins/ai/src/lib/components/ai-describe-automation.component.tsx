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
import type { ConsoleHostAutomationsZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { aiJobProblem, useAiJobRun, useAiJobsVerdict } from './use-ai-job-run'

/**
 * "Describe it" on the Automation page's Actions (AGL-2919), beside Add action
 * and Recipes through the `hostAutomations` zone: a description becomes a
 * `workflow` job that drafts one automation, switched off.
 *
 * The dialog follows the shared brief dialog's shape — one text box, what
 * happens next, and the action that starts the job — and then follows the
 * job, because an automation's draft needs no plan to confirm: when it is
 * written, the dialog says what to fill in and opens it in the Actions editor.
 */

/** The longest description a job admits. */
const BRIEF_MAX_CHARS = 4_000

export const AI_AUTOMATION_BRIEF_COPY = {
  title: 'Describe an automation',
  briefLabel: 'What should happen, and when?',
  placeholder:
    'When someone submits the newsletter form, add them to the newsletter list, make them ' +
    'a lead and send them a welcome email',
  next:
    'The automation is drafted switched off, using only the triggers and steps your plan ' +
    'includes. Anything it needs that your site does not have yet is left for you to fill in.',
  submit: 'Draft the automation',
  started:
    'The automation is being drafted. This can take a few minutes. You can close this ' +
    'window: the draft appears in the list, switched off, when it is ready.',
  drafted: 'Drafted',
  review: 'Review it',
  notListed: 'The draft is saved. It appears in the list in a moment.',
  failed: 'The automation could not be drafted. Try again.',
} as const

export interface AiAutomationBriefDialogProps {
  open: boolean
  onClose: () => void
  orgId: string | undefined
  hostId: string
  /** Who is signed in, whose token the requests carry. */
  user: Parameters<typeof useAiJobRun>[0]
  /** Opens a listed action in the Actions editor; `false` when the list has not read it yet. */
  openAction: (actionId: string) => boolean
}

export function AiAutomationBriefDialog(props: AiAutomationBriefDialogProps) {
  const { open, onClose, orgId, hostId, user, openAction } = props
  const copy = AI_AUTOMATION_BRIEF_COPY
  const help = pluginDocsHelp('aiAutomations')
  const [brief, setBrief] = useState('')
  const [notListed, setNotListed] = useState(false)
  const run = useAiJobRun(user, copy.failed)
  const { job, starting, running, notice, reset } = run

  // Opening or closing starts over and stops following: a job still drafting
  // carries on in AI jobs, and its draft appears in the list when it is written.
  useEffect(() => {
    reset()
    setNotListed(false)
  }, [open, reset])

  const draft = job?.status === 'done' ? job.outputs.find((output) => output.resource === 'workflow') : undefined
  const problem = aiJobProblem(job, copy.failed) ?? (job?.status === 'done' && !draft ? copy.failed : null)
  const asking = !job || Boolean(notice)

  const start = async () => {
    const trimmed = brief.trim()
    if (!orgId || !trimmed) return
    setNotListed(false)
    if (await run.start({ orgId, hostId, kind: 'workflow', brief: trimmed, inputs: { mode: 'draft' } })) {
      setBrief('')
    }
  }

  const review = () => {
    if (!draft) return
    if (openAction(draft.id)) onClose()
    else setNotListed(true)
  }

  return (
    <Dialog open={open} onClose={starting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogContent>
        {asking ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={copy.briefLabel}
              placeholder={copy.placeholder}
              multiline
              minRows={4}
              value={brief}
              onChange={(event) => setBrief(event.target.value.slice(0, BRIEF_MAX_CHARS))}
              helperText={`${brief.length.toLocaleString('en-US')} / ${BRIEF_MAX_CHARS.toLocaleString('en-US')}`}
              disabled={starting}
              autoFocus
            />
            <Typography variant="body2" color="text.secondary">
              {copy.next}{' '}
              <Link href={help.href} target="_blank" rel="noopener" title={help.excerpt}>
                {'How it works'}
              </Link>
            </Typography>
            {notice ? <Alert severity="warning">{notice}</Alert> : null}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {running ? (
              <Alert severity="info" icon={<CircularProgress size={18} aria-label="Drafting" />}>
                {copy.started}
              </Alert>
            ) : null}
            {draft ? (
              <Alert severity="success">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {`${copy.drafted}: ${draft.label}`}
                </Typography>
                {draft.note ? <Typography variant="body2">{draft.note}</Typography> : null}
              </Alert>
            ) : null}
            {problem ? <Alert severity={job?.status === 'failed' ? 'error' : 'warning'}>{problem}</Alert> : null}
            {notListed ? <Alert severity="info">{copy.notListed}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={starting}>
          {asking ? 'Cancel' : 'Close'}
        </Button>
        {asking ? (
          <Button
            variant="contained"
            onClick={() => void start()}
            disabled={starting || !orgId || !brief.trim()}
          >
            {copy.submit}
          </Button>
        ) : draft ? (
          <Button variant="contained" onClick={review}>
            {copy.review}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}

/**
 * Renders nothing until the jobs route has answered for this workspace, and
 * nothing when it says the feature is not this workspace's.
 */
export function AiDescribeAutomationButton({ hostId, orgId, openAction }: ConsoleHostAutomationsZoneProps) {
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const [open, setOpen] = useState(false)

  if (verdict !== 'ready') return null
  return (
    <>
      <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
        {'Describe it'}
      </Button>
      <AiAutomationBriefDialog
        open={open}
        onClose={() => setOpen(false)}
        orgId={orgId}
        hostId={hostId}
        user={user}
        openAction={openAction}
      />
    </>
  )
}

export default AiDescribeAutomationButton
