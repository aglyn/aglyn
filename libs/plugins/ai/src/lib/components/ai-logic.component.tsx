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
import { AI_LOGIC_RESOURCE, readAiLogicProposal, type AiLogicProposal } from '../model/ai-logic-job'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { openAiJobs } from './ai-jobs-store'
import type {
  ConsoleHostLogicZoneProps,
  ConsoleLogicFunctionEditorZoneProps,
  ConsoleLogicReferenceIssueZoneProps,
} from './ai-logic-zones'
import { aiJobProblem, useAiJobRun, useAiJobsVerdict, type AiJobRun } from './use-ai-job-run'

/**
 * Logic by AI (AGL-3603), in the zones the logic plugin hosts on its
 * Functions & Variables page:
 *
 *  - "Create with AI" in the Functions and the Variables card headers
 *    (`hostLogic`): a description becomes a `logic` job whose proposal opens
 *    in that card's editor, unsaved.
 *  - "Explain it", "Change with AI" and "Fix with AI" in a saved function's
 *    editor (`logicFunctionEditor`).
 *  - "Fix with AI" on a broken reference an ACTION holds
 *    (`logicReferenceIssue`): a changed copy of the action, drafted switched
 *    off by the workflow job's `revise` mode.
 *
 * Nothing here saves: a proposal is put in the editor only when the person
 * asks, and the editor's Save is the write.
 */

const BRIEF_MAX_CHARS = 4_000

export const AI_LOGIC_COPY = {
  create: 'Create with AI',
  title: { function: 'Describe a function', variable: 'Describe a variable' },
  label: { function: 'What should it work out?', variable: 'What should it hold?' },
  placeholder: {
    function: 'A shipping quote: free over our free-shipping amount, otherwise the flat rate plus 2 per kilo',
    variable: 'Our plan prices: starter 19, pro 49, business 99',
  },
  next: {
    function:
      'The function is written only from the expressions the editor runs and your site’s variables, checked, and run once. It opens in the editor for you to test and save.',
    variable: 'The variable opens in the editor for you to check and save.',
  },
  submit: { function: 'Write the function', variable: 'Write the variable' },
  running: 'Writing it. This usually takes under a minute.',
  ready: 'Ready',
  open: 'Open in the editor',
  notOpened: 'It could not be opened in the editor. Check the card for why, then try again.',
  failed: 'Nothing could be written from this description. Try again.',
  explain: 'Explain it',
  explaining: 'Reading the function.',
  again: 'Explain it again',
  explainFailed: 'The function could not be explained. Try again.',
  explainBrief: (name: string) => `Explain what ${name} works out, and anything in it worth checking.`,
  changeLabel: 'What should change?',
  changePlaceholder: 'Add a 10% discount when the order is over 200',
  change: 'Change with AI',
  fix: 'Fix with AI',
  fixBrief: (name: string) =>
    `Fix whatever in ${name} would stop it working — a name the site does not have, a condition that can never hold, a value it returns that nothing sets. Change nothing else.`,
  changeIntro:
    'Describe a change, or let AI fix what would stop it working. The changed function replaces what this editor holds only when you open it, and is saved only when you save.',
  replace: 'Put it in the editor',
  referenceFix: 'Fix with AI',
  referenceTitle: 'Fix this reference',
  referenceRunning: 'Drafting a changed copy of the automation. This can take a few minutes.',
  referenceDone:
    'A changed copy is drafted, switched off, beside the automation. Review it on the Automation page, then switch it on in place of the old one.',
  referenceFailed: 'The automation could not be changed. Try again.',
  referenceBrief: (issue: { refType: string; missing: string }) =>
    `A step names the ${issue.refType} “${issue.missing}”, which the site no longer has. Point that step at the site’s ${issue.refType} the name means, or leave it for me to pick. Change nothing else.`,
} as const

/** The proposal a finished logic job wrote, or `null`. */
function proposalOf(job: AiJobSummary | null): { proposal: AiLogicProposal; note: string | null } | null {
  if (job?.status !== 'done') return null
  const output = job.outputs.find((one) => one.resource === AI_LOGIC_RESOURCE)
  const proposal = readAiLogicProposal(output?.proposal)
  return proposal ? { proposal, note: output?.note ?? null } : null
}

function nameOf(proposal: AiLogicProposal): string {
  return proposal.kind === 'function' ? proposal.definition.name : proposal.variable.name
}

/** Progress and what went wrong, shared by every control here. */
function RunState({ run, running, failed, done }: { run: AiJobRun; running: string; failed: string; done: boolean }) {
  const problem = aiJobProblem(run.job, failed) ?? (run.job?.status === 'done' && !done ? failed : null)
  return (
    <>
      {run.running && run.job ? (
        <Alert
          severity="info"
          icon={<CircularProgress size={18} aria-label="Working" />}
          action={
            <Button color="inherit" size="small" variant="outlined" onClick={() => run.job && openAiJobs({ jobId: run.job.id })}>
              {'Open AI jobs'}
            </Button>
          }
        >
          {running}
        </Alert>
      ) : null}
      {problem ? <Alert severity={run.job?.status === 'failed' ? 'error' : 'warning'}>{problem}</Alert> : null}
      {run.notice ? <Alert severity="warning">{run.notice}</Alert> : null}
    </>
  )
}

/** "Create with AI" in the Functions or the Variables card's header. */
export function AiLogicCreateButton({ hostId, orgId, kind, propose }: ConsoleHostLogicZoneProps) {
  const copy = AI_LOGIC_COPY
  const help = pluginDocsHelp('aiLogic')
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const run = useAiJobRun(user, copy.failed)
  const { reset } = run
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [notOpened, setNotOpened] = useState(false)

  useEffect(() => {
    reset()
    setNotOpened(false)
  }, [open, reset])

  if (verdict !== 'ready') return null
  const ready = proposalOf(run.job)
  const asking = !run.job || Boolean(run.notice)
  const close = () => setOpen(false)

  const start = async () => {
    const trimmed = brief.trim()
    if (!orgId || !trimmed) return
    if (await run.start({ orgId, hostId, kind: 'logic', brief: trimmed, inputs: { mode: kind } })) setBrief('')
  }
  const apply = () => {
    if (!ready) return
    if (propose(ready.proposal)) close()
    else setNotOpened(true)
  }

  return (
    <>
      <Button size="small" variant="outlined" startIcon={<MdiIcon path={mdiCreation.path} />} onClick={() => setOpen(true)}>
        {copy.create}
      </Button>
      <Dialog open={open} onClose={run.starting ? undefined : close} fullWidth maxWidth="sm">
        <DialogTitle>{copy.title[kind]}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {asking ? (
              <>
                <TextField
                  label={copy.label[kind]}
                  placeholder={copy.placeholder[kind]}
                  multiline
                  minRows={3}
                  value={brief}
                  onChange={(event) => setBrief(event.target.value.slice(0, BRIEF_MAX_CHARS))}
                  disabled={run.starting}
                  autoFocus
                />
                <Typography variant="body2" color="text.secondary">
                  {copy.next[kind]}{' '}
                  <Link href={help.href} target="_blank" rel="noopener" title={help.excerpt}>
                    {'How it works'}
                  </Link>
                </Typography>
              </>
            ) : null}
            {ready ? (
              <Alert severity="success">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{`${copy.ready}: ${nameOf(ready.proposal)}`}</Typography>
                {ready.note ? <Typography variant="body2">{ready.note}</Typography> : null}
              </Alert>
            ) : null}
            <RunState run={run} running={copy.running} failed={copy.failed} done={Boolean(ready)} />
            {notOpened ? <Alert severity="warning">{copy.notOpened}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={run.starting}>
            {asking ? 'Cancel' : 'Close'}
          </Button>
          {asking ? (
            <Button variant="contained" onClick={() => void start()} disabled={run.starting || !orgId || !brief.trim()}>
              {copy.submit[kind]}
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

/** "Explain it", "Change with AI" and "Fix with AI" in a saved function's editor. */
export function AiLogicFunctionTools({ hostId, orgId, target, propose }: ConsoleLogicFunctionEditorZoneProps) {
  const copy = AI_LOGIC_COPY
  const help = pluginDocsHelp('aiLogic', { anchor: '#change' })
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const explain = useAiJobRun(user, copy.explainFailed)
  const change = useAiJobRun(user, copy.failed)
  const [brief, setBrief] = useState('')
  const [notOpened, setNotOpened] = useState(false)

  if (verdict !== 'ready') return null
  const explanation =
    explain.job?.status === 'done' ? explain.job.outputs.find((one) => one.resource === 'text')?.text ?? null : null
  const ready = proposalOf(change.job)
  const busy = change.starting || change.running

  const ask = () => {
    if (!orgId) return
    void explain.start({
      orgId,
      hostId,
      kind: 'logic',
      brief: copy.explainBrief(target.name),
      inputs: { mode: 'explain', functionId: target.id },
    })
  }
  const revise = async (text: string) => {
    const trimmed = text.trim()
    if (!orgId || !trimmed) return
    setNotOpened(false)
    if (
      await change.start({ orgId, hostId, kind: 'logic', brief: trimmed, inputs: { mode: 'function', functionId: target.id } })
    ) {
      setBrief('')
    }
  }

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }} aria-label="This function with AI">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {copy.changeIntro}{' '}
            <Link href={help.href} target="_blank" rel="noopener" title={help.excerpt}>
              {'How it works'}
            </Link>
          </Typography>
          <Button size="small" variant="outlined" disabled={explain.starting || explain.running || !orgId} onClick={ask}>
            {explanation ? copy.again : copy.explain}
          </Button>
        </Stack>
        {explanation ? (
          <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
            {explanation}
          </Typography>
        ) : null}
        <RunState run={explain} running={copy.explaining} failed={copy.explainFailed} done={Boolean(explanation)} />
        <TextField
          size="small"
          label={copy.changeLabel}
          placeholder={copy.changePlaceholder}
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
            onClick={() => void revise(brief)}
          >
            {copy.change}
          </Button>
          <Button
            size="small"
            variant="text"
            startIcon={<MdiIcon path={mdiCreation.path} />}
            disabled={busy || !orgId}
            onClick={() => void revise(copy.fixBrief(target.name))}
          >
            {copy.fix}
          </Button>
        </Stack>
        {ready ? (
          <Alert
            severity="success"
            action={
              <Button
                color="inherit"
                size="small"
                variant="outlined"
                onClick={() => {
                  if (!propose(ready.proposal)) setNotOpened(true)
                }}
              >
                {copy.replace}
              </Button>
            }
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{`${copy.ready}: ${nameOf(ready.proposal)}`}</Typography>
            {ready.note ? <Typography variant="body2">{ready.note}</Typography> : null}
          </Alert>
        ) : null}
        <RunState run={change} running={copy.running} failed={copy.failed} done={Boolean(ready)} />
        {notOpened ? <Alert severity="warning">{copy.notOpened}</Alert> : null}
      </Stack>
    </Box>
  )
}

/**
 * "Fix with AI" on a broken reference an automation holds: a changed copy of
 * the action, drafted switched off by the workflow job's `revise` mode. A
 * workflow's, a variable's and a page's references are not offered.
 */
export function AiLogicFixReference({ hostId, orgId, issue }: ConsoleLogicReferenceIssueZoneProps) {
  const copy = AI_LOGIC_COPY
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const run = useAiJobRun(user, copy.referenceFailed)
  const [open, setOpen] = useState(false)

  if (verdict !== 'ready' || issue.source !== 'action') return null
  const drafted = run.job?.status === 'done' ? run.job.outputs.find((one) => one.resource === 'workflow') : undefined

  const ask = () => {
    setOpen(true)
    if (run.job || !orgId) return
    void run.start({
      orgId,
      hostId,
      kind: 'workflow',
      brief: copy.referenceBrief(issue),
      inputs: { mode: 'revise', targetType: 'action', targetId: issue.sourceId },
    })
  }
  const close = () => {
    setOpen(false)
    if (run.notice) run.reset()
  }

  return (
    <>
      <Button size="small" variant="text" sx={{ px: 0.5, minWidth: 0 }} startIcon={<MdiIcon path={mdiCreation.path} />} onClick={ask}>
        {copy.referenceFix}
      </Button>
      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>{copy.referenceTitle}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {drafted ? (
              <Alert severity="success">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{drafted.label}</Typography>
                <Typography variant="body2">{drafted.note || copy.referenceDone}</Typography>
              </Alert>
            ) : null}
            <RunState run={run} running={copy.referenceRunning} failed={copy.referenceFailed} done={Boolean(drafted)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{'Close'}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
