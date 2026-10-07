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
import type { AiJobSummary } from '../model/ai-jobs.types'
import {
  AI_ORG_AUTOMATION_RESOURCE,
  aiOrgAutomationInputs,
  readAiOrgAutomationProposal,
  type AiOrgAutomationProposal,
} from '../model/ai-workflow-job'
import type { ConsoleOrgAutomationsZoneProps } from './ai-automation-zones'
import { openAiJobs } from './ai-jobs-store'
import { aiJobProblem, useAiJobRun, useAiJobsVerdict } from './use-ai-job-run'

/**
 * "Create with AI" on the workspace's Org automations (AGL-3603), in that
 * section's card header through the `orgAutomations` zone: a description
 * becomes a `workflow` job drafting one of the WORKSPACE's automations, held
 * to the triggers and steps the zone says an org automation may use.
 *
 * Nothing is written. The job's proposal opens in the section's editor as a
 * new automation, unsaved and switched off; the person picks the sites it
 * runs on and saves it with the editor's own Save, through the section's
 * route — or closes the editor, and nothing changes.
 */

const BRIEF_MAX_CHARS = 4_000

export const AI_ORG_AUTOMATION_COPY = {
  create: 'Create with AI',
  title: 'Describe an org automation',
  label: 'What should happen, and when?',
  placeholder:
    'When someone books on any of our sites, make them a contact, tag them booked and send them a welcome email',
  next:
    'It is drafted from what an org automation can start on and do, and opens in the editor switched off, where you choose its sites and save it. Lists, campaigns or datasets your workspace does not have are left for you to pick.',
  submit: 'Draft the automation',
  running: 'Drafting it. This can take a few minutes.',
  ready: 'Drafted',
  open: 'Open in the editor',
  notOpened: 'It could not be opened in the editor. Check the page for why, then try again.',
  failed: 'The automation could not be drafted. Try again.',
} as const

/** The proposal a finished job wrote, with what to decide, or `null`. */
function proposalOf(job: AiJobSummary | null): { automation: AiOrgAutomationProposal; label: string; note: string | null } | null {
  if (job?.status !== 'done') return null
  const output = job.outputs.find((one) => one.resource === AI_ORG_AUTOMATION_RESOURCE)
  const automation = readAiOrgAutomationProposal(output?.proposal)
  return automation && output ? { automation, label: output.label, note: output.note ?? null } : null
}

export function AiDescribeOrgAutomationButton({ orgId, triggers, steps, propose }: ConsoleOrgAutomationsZoneProps) {
  const copy = AI_ORG_AUTOMATION_COPY
  const help = pluginDocsHelp('aiAutomations', { anchor: '#org-automations' })
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const run = useAiJobRun(user, copy.failed)
  const { job, starting, running, notice, reset } = run
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [notOpened, setNotOpened] = useState(false)

  // Opening or closing starts over and stops following: a job still drafting
  // carries on in AI jobs.
  useEffect(() => {
    reset()
    setNotOpened(false)
  }, [open, reset])

  if (verdict !== 'ready') return null
  const ready = proposalOf(job)
  const problem = aiJobProblem(job, copy.failed) ?? (job?.status === 'done' && !ready ? copy.failed : null)
  const asking = !job || Boolean(notice)
  const close = () => setOpen(false)

  const start = async () => {
    const trimmed = brief.trim()
    if (!orgId || !trimmed) return
    setNotOpened(false)
    const inputs = aiOrgAutomationInputs({ triggers, steps })
    if (await run.start({ orgId, hostId: null, kind: 'workflow', brief: trimmed, inputs })) setBrief('')
  }
  const apply = () => {
    if (!ready) return
    if (propose(ready.automation)) close()
    else setNotOpened(true)
  }

  return (
    <>
      <Button size="small" variant="outlined" startIcon={<MdiIcon path={mdiCreation.path} />} onClick={() => setOpen(true)}>
        {copy.create}
      </Button>
      <Dialog open={open} onClose={starting ? undefined : close} fullWidth maxWidth="sm">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogContent>
          {asking ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label={copy.label}
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
              {running && job ? (
                <Alert
                  severity="info"
                  icon={<CircularProgress size={18} aria-label="Drafting" />}
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        openAiJobs({ jobId: job.id })
                        close()
                      }}
                    >
                      {'Open AI jobs'}
                    </Button>
                  }
                >
                  {copy.running}
                </Alert>
              ) : null}
              {ready ? (
                <Alert severity="success">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {`${copy.ready}: ${ready.label}`}
                  </Typography>
                  {ready.note ? <Typography variant="body2">{ready.note}</Typography> : null}
                </Alert>
              ) : null}
              {problem ? <Alert severity={job?.status === 'failed' ? 'error' : 'warning'}>{problem}</Alert> : null}
              {notOpened ? <Alert severity="warning">{copy.notOpened}</Alert> : null}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={starting}>
            {asking ? 'Cancel' : 'Close'}
          </Button>
          {asking ? (
            <Button variant="contained" onClick={() => void start()} disabled={starting || !orgId || !brief.trim()}>
              {copy.submit}
            </Button>
          ) : ready ? (
            <Button variant="contained" onClick={apply}>
              {copy.open}
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </>
  )
}
AiDescribeOrgAutomationButton.displayName = 'AiDescribeOrgAutomationButton'

export default AiDescribeOrgAutomationButton
