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
import { mdiCreation } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useHostOrgId, useUser } from '@aglyn/tenant-feature-instance'
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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import {
  AI_OVERLAY_COPY_TASK,
  AI_OVERLAY_CURRENT_MAX_CHARS,
  aiOverlayLimitInputs,
  aiOverlayTriggersInput,
  readAiOverlayCopy,
  type AiOverlayCopyField,
  type AiOverlayCopyProposal,
  type AiOverlayKind,
  type AiOverlayTriggerRule,
} from '../model/ai-overlay-copy'
import { aiJobProblem, useAiJobRun, useAiJobsVerdict } from './use-ai-job-run'

/**
 * Overlays by AI in the console (AGL-3603): two widgets in the zones the
 * marketing plugin's overlays list hosts, each starting a `text` job asked for
 * overlay copy (`inputs.task: 'overlay'`).
 *
 * The overlay, its schedule, its targeting and its on-switch are the marketing
 * plugin's, and neither plugin imports the other: the props below restate the
 * halves of the zones' contracts these widgets read.
 *
 * ## Neither widget writes
 *
 * "Write with AI", in the overlay editor, fills the editor's fields unsaved;
 * the editor's Save is the write. "Create with AI", beside New bar and New
 * popup, hands the copy to the list's `createOverlayDraft`, which writes the
 * overlay switched off and opens it in the editor — a visitor sees nothing
 * until a person turns it on.
 */

const WRITE_FAILED_COPY = 'The copy could not be written. Try again.'

/** The longest brief a person types here. */
const BRIEF_MAX_CHARS = 1_000

/** The zone's rules, as the list hands them over. */
interface OverlayRules {
  limits: Readonly<Partial<Record<AiOverlayCopyField, number>>>
  triggers: readonly AiOverlayTriggerRule[]
}

/** What one proposal sets, as the zones' `proposeValues` and `createOverlayDraft` read it. */
export interface AiOverlayProposalValues {
  name?: string
  text?: string
  headline?: string
  body?: string
  ctaLabel?: string
  trigger?: string
  triggerValue?: number
}

/** The overlay editor's copy, as the `overlayEditor` zone hands it over. */
export interface AiOverlayEditorCopy {
  name: string
  text: string
  headline: string
  body: string
  ctaLabel: string
  ctaHref: string
  trigger: string
  triggerValue: number | null
}

/** What the `overlayEditor` zone hands this widget. */
export interface AiOverlayEditorCardProps extends OverlayRules {
  hostId: string
  overlayId: string
  kind: AiOverlayKind
  copy: AiOverlayEditorCopy
  proposeValues: (proposal: AiOverlayProposalValues, key: string) => void
}

/** What the `hostOverlays` zone hands this widget. */
export interface AiCreateOverlayButtonProps extends OverlayRules {
  hostId: string
  createOverlayDraft: (
    kind: AiOverlayKind,
    proposal: AiOverlayProposalValues,
  ) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
}

/** The proposal a finished overlay job carries. */
export function aiOverlayProposalOf(job: AiJobSummary | null): AiOverlayCopyProposal | null {
  if (job?.status !== 'done') return null
  for (const output of job.outputs) {
    const proposal = readAiOverlayCopy(output.proposal)
    if (proposal) return proposal
  }
  return null
}

/** A checked proposal as the values a zone's callback reads: only the fields it filled. */
export function aiOverlayProposalValues(proposal: AiOverlayCopyProposal): AiOverlayProposalValues {
  const values: AiOverlayProposalValues = {}
  if (proposal.name) values.name = proposal.name
  if (proposal.kind === 'bar') {
    if (proposal.text) values.text = proposal.text
    return values
  }
  if (proposal.headline) values.headline = proposal.headline
  if (proposal.body) values.body = proposal.body
  if (proposal.ctaLabel) values.ctaLabel = proposal.ctaLabel
  if (proposal.trigger) {
    values.trigger = proposal.trigger
    if (proposal.triggerValue !== null) values.triggerValue = proposal.triggerValue
  }
  return values
}

/** The editor's copy, as the job's `current` input reads it. */
export function aiOverlayCurrentCopy(kind: AiOverlayKind, copy: AiOverlayEditorCopy): string {
  const lines =
    kind === 'bar'
      ? [copy.text]
      : [copy.headline, copy.body, copy.ctaLabel ? `Button: ${copy.ctaLabel}` : '']
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, AI_OVERLAY_CURRENT_MAX_CHARS)
}

/** The job's inputs for one overlay. */
export function aiOverlayJobInputs(
  kind: AiOverlayKind,
  rules: OverlayRules,
  current: string,
): Record<string, string> {
  const inputs: Record<string, string> = {
    task: AI_OVERLAY_COPY_TASK,
    overlayKind: kind,
    triggers: aiOverlayTriggersInput(rules.triggers),
  }
  for (const [key, value] of Object.entries(aiOverlayLimitInputs(rules.limits))) {
    inputs[key] = String(value)
  }
  if (current) inputs['current'] = current
  return inputs
}

/** How a proposed trigger reads, in the zone's own words. */
function triggerText(
  proposal: AiOverlayCopyProposal,
  triggers: readonly AiOverlayTriggerRule[],
): string | null {
  if (!proposal.trigger) return null
  const rule = triggers.find((entry) => entry.id === proposal.trigger)
  const label = rule?.label ?? proposal.trigger
  if (proposal.triggerValue === null || !rule?.unit) return label
  return `${label}: ${proposal.triggerValue}${rule.unit === 'percent' ? '%' : ' seconds'}`
}

/** One proposal, drawn the same way in both widgets. */
export function AiOverlayProposal({
  proposal,
  triggers,
}: {
  proposal: AiOverlayCopyProposal
  triggers: readonly AiOverlayTriggerRule[]
}) {
  const opens = proposal.kind === 'popup' ? triggerText(proposal, triggers) : null
  return (
    <Box
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}
      aria-label="Proposed copy"
    >
      <Stack spacing={0.5}>
        {proposal.name ? (
          <Typography variant="caption" color="text.secondary">
            {proposal.name}
          </Typography>
        ) : null}
        {proposal.kind === 'bar' ? (
          <Typography variant="body2">{proposal.text}</Typography>
        ) : (
          <>
            {proposal.headline ? (
              <Typography variant="subtitle2">{proposal.headline}</Typography>
            ) : null}
            <Typography variant="body2" sx={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
              {proposal.body}
            </Typography>
            {proposal.ctaLabel ? (
              <Typography variant="body2">{`Button: ${proposal.ctaLabel}`}</Typography>
            ) : null}
            {opens ? (
              <Typography variant="body2" color="text.secondary">
                {`Opens: ${opens}`}
              </Typography>
            ) : null}
          </>
        )}
        {proposal.rationale ? (
          <Typography variant="caption" color="text.secondary">
            {proposal.rationale}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  )
}
AiOverlayProposal.displayName = 'AiOverlayProposal'

const overlayHelp = (anchor: '#write-overlay-copy' | '#create-an-overlay', excerpt: string) =>
  pluginDocsHelp('aiMarketing', { anchor, excerpt })

/**
 * "Write with AI", among the overlay editor's fields. It proposes the copy and,
 * for a popup, when it opens; it never proposes the link, the schedule, the
 * pages or the on-switch.
 */
export function AiOverlayEditorCard(props: AiOverlayEditorCardProps) {
  const { hostId, kind, copy, proposeValues, limits, triggers } = props
  const orgId = useHostOrgId(hostId) ?? undefined
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const run = useAiJobRun(user, WRITE_FAILED_COPY)
  const [brief, setBrief] = useState('')
  const [applied, setApplied] = useState<string | null>(null)
  const proposal = useMemo(() => aiOverlayProposalOf(run.job), [run.job])
  const problem =
    aiJobProblem(run.job, WRITE_FAILED_COPY) ??
    (run.job?.status === 'done' && !proposal ? WRITE_FAILED_COPY : null)

  if (verdict !== 'ready') return null

  const busy = run.starting || run.running
  const current = aiOverlayCurrentCopy(kind, copy)
  const noun = kind === 'bar' ? 'bar' : 'popup'
  const help = overlayHelp('#write-overlay-copy', 'Writes the copy for this overlay from a brief, and for a popup when it opens. It fills the fields above unsaved; nothing is saved until you save the overlay.')
  const write = () => {
    if (!orgId || !(brief.trim() || current)) return
    setApplied(null)
    void run.start({
      orgId,
      hostId,
      kind: 'text',
      brief: brief.trim() || `Improve the copy of this ${noun}.`,
      inputs: aiOverlayJobInputs(kind, { limits, triggers }, current),
    })
  }
  const apply = () => {
    if (!proposal || !run.job) return
    proposeValues(aiOverlayProposalValues(proposal), run.job.id)
    setApplied(run.job.id)
  }

  return (
    <Box
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
      aria-label="Write with AI"
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {'Write with AI'}
          </Typography>
          <Link href={help.href} target="_blank" rel="noopener" variant="caption" title={help.excerpt}>
            {'How it works'}
          </Link>
        </Stack>
        <TextField
          size="small"
          multiline
          minRows={2}
          label={`What is this ${noun} for?`}
          placeholder={
            kind === 'bar'
              ? 'Free delivery on orders over [amount] this weekend'
              : 'Invite first-time visitors to book a free consultation'
          }
          helperText={
            current
              ? 'The copy above is sent with this, so it can be improved rather than replaced.'
              : 'Name the offer or the news, and who it is for.'
          }
          value={brief}
          onChange={(event) => setBrief(event.target.value.slice(0, BRIEF_MAX_CHARS))}
          disabled={busy}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<MdiIcon path={mdiCreation.path} />}
            disabled={busy || !orgId || !(brief.trim() || current)}
            onClick={write}
          >
            {run.job && !busy ? 'Write it again' : 'Write with AI'}
          </Button>
          {busy ? <CircularProgress size={16} aria-label="Writing the copy" /> : null}
        </Stack>
        {run.notice ? <Alert severity="warning">{run.notice}</Alert> : null}
        {problem ? (
          <Alert severity={run.job?.status === 'failed' ? 'error' : 'warning'}>{problem}</Alert>
        ) : null}
        {proposal ? (
          <Stack spacing={1}>
            <AiOverlayProposal proposal={proposal} triggers={triggers} />
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                disabled={applied === run.job?.id}
                onClick={apply}
              >
                {'Put in the fields'}
              </Button>
            </Stack>
            {applied === run.job?.id ? (
              <Alert severity="success">
                {'In the fields above. Review them, add the link, then Save — or Cancel to leave the overlay as it was.'}
              </Alert>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  )
}
AiOverlayEditorCard.displayName = 'AiOverlayEditorCard'

/**
 * "Create with AI", beside New bar and New popup and in the list's empty
 * state: a brief becomes a new overlay, written switched off and opened in the
 * editor.
 */
export function AiCreateOverlayButton(props: AiCreateOverlayButtonProps) {
  const { hostId, createOverlayDraft, limits, triggers } = props
  const orgId = useHostOrgId(hostId) ?? undefined
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const run = useAiJobRun(user, WRITE_FAILED_COPY)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<AiOverlayKind>('popup')
  const [brief, setBrief] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** The job whose copy was handed to the list, so it is created once. */
  const createdRef = useRef<string | null>(null)
  const proposal = useMemo(() => aiOverlayProposalOf(run.job), [run.job])
  const problem =
    aiJobProblem(run.job, WRITE_FAILED_COPY) ??
    (run.job?.status === 'done' && !proposal ? WRITE_FAILED_COPY : null)

  // Once the copy arrives it becomes the overlay, switched off, and the list
  // opens it in the editor; this dialog has nothing more to show.
  useEffect(() => {
    const jobId = run.job?.id
    if (!proposal || !jobId || createdRef.current === jobId) return
    createdRef.current = jobId
    setSaving(true)
    setSaveError(null)
    void createOverlayDraft(proposal.kind, aiOverlayProposalValues(proposal))
      .then((result) => {
        if (result.ok === false) {
          setSaveError(result.error)
          return
        }
        setOpen(false)
        setBrief('')
        run.reset()
      })
      .catch(() => setSaveError('The overlay could not be saved. Try again.'))
      .finally(() => setSaving(false))
  }, [proposal, run, createOverlayDraft])

  if (verdict !== 'ready') return null

  const busy = run.starting || run.running || saving
  const help = overlayHelp('#create-an-overlay', 'Writes a new announcement bar or popup from a brief and saves it switched off, so no visitor sees it until you turn it on.')
  const start = () => {
    if (!orgId || !brief.trim()) return
    createdRef.current = null
    setSaveError(null)
    void run.start({
      orgId,
      hostId,
      kind: 'text',
      brief: brief.trim(),
      inputs: aiOverlayJobInputs(kind, { limits, triggers }, ''),
    })
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<MdiIcon path={mdiCreation.path} />}
        onClick={() => setOpen(true)}
      >
        {'Create with AI'}
      </Button>
      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{'Create an overlay with AI'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={kind}
              onChange={(_event, next: AiOverlayKind | null) => {
                if (next) setKind(next)
              }}
              aria-label="What to create"
              disabled={busy}
            >
              <ToggleButton value="popup">{'Popup'}</ToggleButton>
              <ToggleButton value="bar">{'Announcement bar'}</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              label={kind === 'bar' ? 'What should the bar announce?' : 'What is the popup for?'}
              placeholder={
                kind === 'bar'
                  ? 'Our spring sale: [discount] off everything until [date]'
                  : 'Ask visitors reading our services page to book a free consultation'
              }
              multiline
              minRows={3}
              value={brief}
              onChange={(event) => setBrief(event.target.value.slice(0, BRIEF_MAX_CHARS))}
              disabled={busy}
              autoFocus
            />
            <Typography variant="body2" color="text.secondary">
              {'The overlay is saved switched off and opened in the editor, where you add its link, ' +
                'its pages and its schedule. No visitor sees it until you turn it on.'}
              {' '}
              <Link href={help.href} target="_blank" rel="noopener" title={help.excerpt}>
                {'How it works'}
              </Link>
            </Typography>
            {busy ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <CircularProgress size={16} aria-label="Writing the overlay" />
                <Typography variant="body2" color="text.secondary">
                  {saving ? 'Saving the overlay.' : 'Writing the copy.'}
                </Typography>
              </Stack>
            ) : null}
            {run.notice ? <Alert severity="warning">{run.notice}</Alert> : null}
            {problem ? (
              <Alert severity={run.job?.status === 'failed' ? 'error' : 'warning'}>{problem}</Alert>
            ) : null}
            {saveError ? <Alert severity="error">{saveError}</Alert> : null}
            {proposal && saveError ? <AiOverlayProposal proposal={proposal} triggers={triggers} /> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" onClick={start} disabled={busy || !orgId || !brief.trim()}>
            {'Create the overlay'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
AiCreateOverlayButton.displayName = 'AiCreateOverlayButton'
